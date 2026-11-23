# K10 — Blocked-input handoff

Ordered by dependency. K10 cannot advance past BLOCKED until items 1–4 are
complete. Items 5–12 are owner decisions that can proceed in parallel now.

| #   | Missing input                                                                                                                            | Who supplies it        | Unblocks             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------- |
| 1   | Develop CI green: scans, R18 acceptance, CI gate, Windows dev startup (failing on `92770ea`)                                             | K01 lane               | G-01, G-02           |
| 2   | Accepted K02–K09 evidence under `ksa-launch/K0x/`, published (none exists; K08/K09 not started)                                          | K02–K09 lanes          | G-04…G-08, G-12–G-15 |
| 3   | G3 acceptance and publication: 14 external sandbox scenarios, refund policy and consequence bindings                                     | G3 coordinator + owner | G-09, R34–R38 start  |
| 4   | R34–R37 implementation on their official branches; R38 writer assignment; coordinator join; G4 scope approval                            | Wave 4 owners + owner  | G-10, G-21           |
| 5   | Approved Saudi domain, registrant entity, SaudiNIC-accredited registrar account                                                          | Owner                  | G-16, G-17           |
| 6   | Hosting target: account, region (in-Kingdom data residency decision under PDPL), registry, managed Postgres/Redis/storage/ClamAV, budget | Owner                  | G-08, G-14, G-18     |
| 7   | Topology decision: same-origin `www` (recommended), or a sibling `api.` host as a new K03 change request                                 | Owner + K03            | G-17                 |
| 8   | Mail provider and sending subdomain; monitored test mailboxes                                                                            | Owner                  | G-15                 |
| 9   | Published AR/EN terms, privacy, refund and provider agreement                                                                            | Owner / legal counsel  | G-19                 |
| 10  | Alert contacts, on-call rota, support owner, release operator, rollback authority                                                        | Owner                  | G-14, G-20           |
| 11  | Launch load (concurrent users, RPS) and accepted thresholds                                                                              | Owner                  | G-13                 |
| 12  | R16 payout policy; live-money authorization (merchant, amount, refund/reconciliation plan), or a written non-money pilot scope           | Owner                  | G-11, G-22           |
| 13  | Migration-free application rollback path (R36 CR-001)                                                                                    | R36 / K09              | G-12, cutover §5     |

Not done, deliberately:

- no domain, hosting or certificate purchase;
- no DNS change;
- no deployment;
- no mail sent;
- no merge;
- no live-money action;
- no edits to another lane's worktree or allowlist.

**Safest next action:** finish item 1 (K01) and owner items 5–12 in parallel. Then
version this matrix to v2 against the first frozen candidate.
