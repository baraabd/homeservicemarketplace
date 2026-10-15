import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

// R21 — sealing for EmailDelivery.envelope.
//
// An AUTH intent carries a one-time code or reset token until the provider
// accepts it, so it must not sit in Postgres in clear text: a database backup,
// a read replica or an operator query would otherwise be an account-takeover
// kit. AES-256-GCM with the row's messageKey as associated data: a ciphertext
// copied onto another row does not open.
//
// Format: 0x01 | iv(12) | tag(16) | ciphertext.

const VERSION = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SealedEnvelope {
  to: string;
  vars: unknown;
}

export class MailEnvelopeCipher {
  private constructor(private readonly key: Buffer) {}

  /** Key from base64 (32 bytes). Throws on anything else: a short or
   *  malformed key must stop boot, not silently weaken sealing. */
  static fromBase64(value: string): MailEnvelopeCipher {
    const key = Buffer.from(value.trim(), 'base64');
    if (key.length !== 32) {
      throw new Error('MAIL_INTENT_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    }
    return new MailEnvelopeCipher(key);
  }

  /** HKDF-SHA256 subkey of another deployment secret, under a label no other
   *  use shares. Fallback for deployments that have not provisioned a
   *  dedicated key: it survives restarts, but rotating the parent secret
   *  strands queued envelopes (they close as "undecryptable"). */
  static derived(parentSecret: string): MailEnvelopeCipher {
    const key = Buffer.from(hkdfSync('sha256', parentSecret, 'hsm.mail-envelope', 'v1', 32));
    return new MailEnvelopeCipher(key);
  }

  /** Process-local key for development and tests. Rows sealed with it cannot
   *  be opened after a restart; they fail as "undecryptable", which is the
   *  correct outcome for a disposable environment. */
  static ephemeral(): MailEnvelopeCipher {
    return new MailEnvelopeCipher(randomBytes(32));
  }

  seal(messageKey: string, envelope: SealedEnvelope): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(messageKey, 'utf8'));
    const body = Buffer.concat([cipher.update(JSON.stringify(envelope), 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
  }

  /** Returns null for any failure (wrong key, tampering, wrong row, bad
   *  version). The caller records a low-cardinality class, never the error. */
  open(messageKey: string, sealed: Uint8Array): SealedEnvelope | null {
    try {
      const buf = Buffer.from(sealed);
      if (buf.length < 1 + IV_BYTES + TAG_BYTES || buf[0] !== VERSION) return null;
      const iv = buf.subarray(1, 1 + IV_BYTES);
      const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAAD(Buffer.from(messageKey, 'utf8'));
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([
        decipher.update(buf.subarray(1 + IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');
      const parsed = JSON.parse(plain) as SealedEnvelope;
      if (typeof parsed?.to !== 'string') return null;
      return parsed;
    } catch {
      return null;
    }
  }
}

/** Recipient identity for suppression and feedback joins. The address itself
 *  lives only inside the sealed envelope. */
export function recipientHash(address: string): string {
  return createHash('sha256').update(address.trim().toLowerCase(), 'utf8').digest('hex');
}
