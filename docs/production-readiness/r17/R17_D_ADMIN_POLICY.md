# R17-D — Admin operations policy sources

Sprint R17, unit D. Base `develop@aaf30aa0ee53c3a33e08c28226d8c6209df2204c`.

This file records where each admin-operations rule comes from. It does not
create policy. Classes:

- **CONFIRMED**: an approved or accepted source states the rule.
- **APPLIED_ENGINEERING_RULE**: a security, data-integrity or honesty rule
  that follows from existing authority and needs no product choice.
- **DECISION_NEEDED**: a product, security or operations owner must decide.
  No default is guessed.

## Rules

| #   | Topic                             | Rule in force after R17-D                                                                                                                                    | Class                                     | Source                                                                                                                   |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A1  | Who may read users                | `admin` role + fresh `user:read:any`                                                                                                                         | CONFIRMED                                 | existing controller (Phase 4)                                                                                            |
| A2  | Who may change a user's status    | `admin` role + fresh `user:write:any` ("Update any user profile (admin)"). Writes were role-only while reads already needed a permission                     | APPLIED_ENGINEERING_RULE                  | seeded permission catalogue; the admin role already holds it, so no admin loses access                                   |
| A3  | Self-disable                      | An admin cannot suspend or lock their own account                                                                                                            | CONFIRMED                                 | Sprint 6.1                                                                                                               |
| A4  | Suspension revokes sessions       | SUSPENDED/LOCKED revokes every session in the same transaction; restore does not resurrect them                                                              | CONFIRMED                                 | Sprint 01 / D-2 hardening                                                                                                |
| A5  | Last active admin                 | No rule exists for status changes. Two admins can still suspend each other at the same time, leaving no active admin                                         | DECISION_NEEDED                           | Sprint 6.1 claims the invariant only for role mutation, which is not exposed                                             |
| A6  | Suspension reason                 | The API accepts an optional reason; there is no approved reason model. The audit row records `reasonLength`, never the text; nothing user-facing shows it    | DECISION_NEEDED (model) / APPLIED (audit) | R17-B decision 3; R17-C P19 (audit carries identifiers, not free text)                                                   |
| A7  | Concurrent status changes         | One at a time per user (row lock); each audit row's previous status is the state the prior change left                                                       | APPLIED_ENGINEERING_RULE                  | audit truthfulness                                                                                                       |
| S1  | Writable settings                 | One registry: the Settings screen's typed fields, plus three structured operator policies validated by their consumer's own parser. Anything else is refused | APPLIED_ENGINEERING_RULE                  | D-1; the documented operator path for `platform_supported_markets` (Phase 5) and the dispute policies needs a write path |
| S2  | Who may write structured policies | `admin` role (unchanged)                                                                                                                                     | DECISION_NEEDED                           | dispute pilot activation and market registry are commercial/legal decisions; no dedicated permission exists              |
| S3  | Inert settings                    | `platform_fee_bps`, `default_currency`, `support_email` and `feature_show_hourly_rate` are shown read-only with an honest note and cannot be written         | APPLIED_ENGINEERING_RULE                  | no reader (code search); R15/R16: fee and currency settings are inert and money authority is blocked                     |
| S4  | Wiring an inert setting           | Not done. A fee, platform currency, support address or hourly-rate switch is a product decision                                                              | DECISION_NEEDED                           | R16 P10 (no fee approved)                                                                                                |
| S5  | Setting history                   | One history row per actual change, in the same transaction; same-value writes audit intent but add no history                                                | CONFIRMED                                 | Sprint 8                                                                                                                 |
| S6  | Setting audit content             | Key, previous and new value, source. Values are operator settings, not secrets; no secret is admin-editable                                                  | CONFIRMED                                 | Sprint 6.5                                                                                                               |
| N1  | Analytics money                   | Booked value of completed bookings per currency; never summed across currencies; no fee or net figure                                                        | APPLIED_ENGINEERING_RULE                  | R15 money matrix (BOOKING_DERIVED_ESTIMATE); R16 P10 (no fee approved); no conversion authority exists                   |
| N2  | Analytics time                    | A completion or cancellation is dated by its booking event, not `updatedAt`. Undated completions are counted separately                                      | APPLIED_ENGINEERING_RULE                  | same time authority as dispute intake (Sprint 12A)                                                                       |
| N3  | Analytics money unit              | Admin screens divide `priceAmount` by 100 (unchanged)                                                                                                        | DECISION_NEEDED                           | R16 records the unit as ambiguous (whole units in bid UI, minor units in wallet)                                         |
| N4  | Admin notifications               | Server-owned inbox scoped by `experience=admin`. No approved producer writes admin notifications, so an empty inbox is the honest state                      | CONFIRMED                                 | R17-B (B-9, decision 5)                                                                                                  |
| N5  | Audit log                         | Read-only, admin role, keyset paging (≤100 per page), stable `createdAt desc, id desc`, sensitive metadata keys redacted                                     | CONFIRMED                                 | Sprint 6.6                                                                                                               |
| N6  | Audit read permission             | `admin` role only (no permission)                                                                                                                            | DECISION_NEEDED                           | no `audit:read` permission exists                                                                                        |

## Consolidated owner decision request

None of these blocks the R17-D merge. Each keeps an operational release gap
open until it is decided.

1. **Minimum active admins (A5).** Should status changes refuse to leave the
   platform with no active admin? If yes, define "admin" (role only, or role
   plus `admin:access:grant`) and whether a break-glass path exists.
2. **Suspension reason model (A6).** Should a reason be stored? If so, where,
   who may read it, and is any of it shown to the user?
3. **Structured policy writes (S2).** Should dispute pilot activation and the
   market registry need a dedicated permission instead of the `admin` role?
4. **Inert settings (S4).** Wire, retire or keep `platform_fee_bps`,
   `default_currency`, `support_email` and `feature_show_hourly_rate`? The
   first two depend on R16.
5. **Money unit (N3)** for booking amounts across bid, wallet and admin.
6. **Audit read permission (N6).**
