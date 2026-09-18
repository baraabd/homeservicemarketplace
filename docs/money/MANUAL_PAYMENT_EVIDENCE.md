# Manual payment evidence lifecycle — Sprint 14 contract

Sham Cash and Syriatel Cash instructions/QR are admin-managed payment-method configuration, versioned or snapshotted into the PaymentIntent so later configuration changes do not rewrite history. Cash-office intents similarly snapshot the selected office/reference/instructions needed for reconciliation.

Receipt lifecycle: prepare restricted upload → receive bytes → enforce server byte limit → detect actual type/magic bytes → decode/re-encode supported images → strip metadata → SHA-256 fingerprint → malware scan → CLEAN only becomes reviewable → bind immutable original to PaymentIntent → generate separate review derivative/watermark → authorized audited admin review.

Review signals may include exact duplicate hash, perceptual similarity, reused reference, amount/currency/date mismatch and suspicious metadata. Signals trigger review; they do not claim that an image is authentic or forged.

Approval command locks/rechecks the pending payment, records reviewer/reason, posts balanced ledger entries and activates exactly one subscription period atomically. Reject/request-resubmission never grants entitlement. Every retry is idempotent.