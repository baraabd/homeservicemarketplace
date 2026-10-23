/**
 * Read a one-time code out of the mail catcher.
 *
 * The OTP is never persisted in plaintext, so the mailbox is the only place it
 * can be read — which is exactly how a real provider gets it. Read the TEXT
 * part rather than the serialised envelope: mailpit's own metadata contains
 * six-digit runs, and matching those yields codes that were never OTPs.
 */
export async function readOtpFromMailbox(mailpit: string, email: string): Promise<string> {
  const wanted = email.toLowerCase();
  for (let attempt = 0; attempt < 75; attempt += 1) {
    const response = await fetch(`${mailpit}/api/v1/messages?limit=50`);
    if (!response.ok) throw new Error(`OTP mailbox listing failed (${response.status})`);
    const list = (await response.json()) as {
      messages?: { ID: string; To?: { Address?: string }[] }[];
    };
    const hits = (list.messages ?? []).filter((m) =>
      (m.To ?? []).some((t) => t.Address?.toLowerCase() === wanted),
    );
    // Notifications can arrive after the OTP. Inspect all matching messages,
    // newest first, instead of repeatedly waiting on a newer non-OTP email.
    for (const hit of hits) {
      const message = await fetch(`${mailpit}/api/v1/message/${hit.ID}`);
      if (!message.ok) throw new Error(`OTP mailbox message failed (${message.status})`);
      const full = (await message.json()) as { Text?: string };
      const code = (full.Text ?? '').match(/code is (\d{6})/)?.[1];
      if (code) {
        // Consume only this OTP. Keep notifications and other workers' mail.
        const consumed = await fetch(`${mailpit}/api/v1/messages`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ IDs: [hit.ID] }),
        });
        if (!consumed.ok) throw new Error(`OTP mailbox consume failed (${consumed.status})`);
        return code;
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`no OTP mail arrived for ${email}`);
}
