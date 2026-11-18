# Configurable authentication channel — 18 November 2026

## Scope and UX decisions

The requested change applies to customer, professional and administrator authentication. An administrator selects the default OTP channel in Settings. Email stays the default until an administrator saves WhatsApp after provider configuration and verification of their own number. The existing role-specific shells remain: customer orange, professional blue/purple, administrator slate. The shared channel notice, identity field, recovery and OTP destination change according to server policy.

The previous country card inferred United States from browser locale even when the dial code was different. Country selection now starts empty. Selecting a country shows its flag and calling code; location lookup runs only after the user chooses the disclosed location action. Manual selection and country search remain available when permission is denied or lookup fails. No locale or timezone is treated as location.

The UI waits for public authentication configuration before showing credential forms. Loading and retry states avoid rendering the wrong channel while policy is unknown. Existing accounts retain a compatible login route during a channel transition; new registration follows the selected policy. A challenge retains its original channel and masked destination even if the administrator subsequently changes policy.

## Implementation boundaries

- `infrastructure/auth-channel` owns policy, public configuration, transport selection and the Meta adapter. WhatsApp credentials exist only in deployment secrets.
- Shared contracts describe nullable email, verified account phone, channel configuration and challenge destination. Phone-only accounts have no fabricated email.
- Authentication and verification services enforce ownership, purpose, account locks, token expiry, attempt limits and contact binding. Linking either contact requires an authenticated session, current password and proof sent to the new destination.
- The encrypted durable delivery queue is reused for both transports. WhatsApp authentication does not fall back to SMTP. Anonymous recovery requests enqueue after commit without awaiting provider latency; throttled requests do not invalidate usable OTPs or reset their attempt budget.
- Provider onboarding, review and administrator-access eligibility accept a verified authentication email or phone. A provider-profile phone proof remains a separate fact. Historical review snapshots remain compatible, while actual profile changes and live eligibility checks still block unsafe approvals.
- Profile edit state uses immutable account identity so phone-only users and later email attachment cannot leak or discard another account's drafts.

Three additive Prisma migrations expand account identity, delivery binding and purpose/audit enums. They were applied from scratch on a real PostgreSQL 16 test database. Existing email accounts and unbound legacy email tokens remain supported. Rolling back application code after creating phone-only users requires a compatible build; do not restore the old non-null email constraint over those users.

## Verification evidence

Runtime: Node 24.21.0 and pnpm 10.32.1, matching the repository pins.

| Check                                                       | Observed result                                                                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Prisma generation and fresh PostgreSQL migration deployment | Passed                                                                                                                  |
| Four authentication/database integration suites             | 54 passed; 3 existing SMTP/Mailpit-only cases skipped because that service was not available                            |
| Authentication/admin-access unit suites                     | 165 passed                                                                                                              |
| Provider onboarding/verification regressions                | 377 passed                                                                                                              |
| Provider review policy/service regressions                  | 40 passed                                                                                                               |
| Delivery/channel/settings suites                            | 104 passed                                                                                                              |
| Complete web suite                                          | 249 files, 3,187 tests passed                                                                                           |
| API and web TypeScript and production compilation           | Passed; web compilation used a synthetic API URL, not a deployment                                                      |
| Scoped changed-code lint and whitespace checks              | Passed                                                                                                                  |
| Browser presentation matrix                                 | 72 layout observations: 2 channels × 3 applications × 2 languages × 6 requested viewport widths; no horizontal overflow |

These counts refer to overlapping scoped runs and must not be summed into a total. Full-suite and remote CI results are recorded separately in the pull request.

### Browser observations

The actual Vite application was served through a temporary presentation fixture. `/auth/config` and anonymous legal/me responses were mocked; no account was created, no credential was submitted and no message was sent. The fixture and its public helper page were removed after inspection.

Requested iframe viewport widths were 320, 390, 430, 768, 1024 and 1440 CSS pixels. Chromium's vertical scrollbar reduces recorded content width by 15 pixels; every document scroll width equalled its available content width. Arabic rendered RTL and English LTR. See [layout-results.json](./visual/layout-results.json). All 12 captured login variants were visually inspected, along with Arabic sign-up and manual country selection. A keyboard Tab transition produced visible focus on the Apps action. This limited keyboard observation is not full keyboard or accessibility acceptance.

The local Playwright runner could not launch its browser because the execution environment disallowed its required Unix socket. The supported browser preview provided the presentation evidence instead. The automated presentation spec is committed for execution in an environment that supports Playwright. Native 200% browser zoom was attempted but not verified; it is not claimed as passed.

Screenshots show only presentation fixtures. They do not prove backend persistence, authentication or live delivery.

- [Customer, WhatsApp, Arabic](./visual/customer-whatsapp-ar.jpg)
- [Professional, WhatsApp, English](./visual/provider-whatsapp-en.jpg)
- [Administrator, email, Arabic](./visual/admin-email-ar.jpg)
- [Arabic registration and selected country](./visual/signup-whatsapp-ar.jpg)

## Remaining acceptance

1. Configure Meta sender credentials and an approved authentication template securely on independent staging; see [operations](./WHATSAPP_OPERATIONS.md).
2. Run the hosted recipient journey: delivery, expiry, resend, wrong-code rejection, one-time consumption, recovery and policy switching with existing and new accounts.
3. Exercise authenticated administrator settings through the real hosted API, reload and sign-out/sign-in. Component/API tests cover these boundaries locally, but do not replace this journey.
4. Run final-head remote CI and the committed Playwright matrix, plus full keyboard, 200% zoom and accessibility review.

No production deployment, live WhatsApp delivery or universal defect-free guarantee is asserted by this evidence.
