# K06 visual review

Real route, real API, production bundle (`VITE_PROVIDER_ONBOARDING_V2=true`,
same build-time flags as the CI browser-to-API job), Chromium. Each screen was
captured at 320, 390, 430, 768, 1024 and 1440 CSS px in English (LTR) and
Arabic (RTL), plus 200% zoom at 390. All content is synthetic. No email,
token, identity document or receipt appears in any image.

Automated per capture: `<html dir>` matches the language; no page-level
horizontal overflow; every visible button is at least 44×44 CSS px.
Screenshots were **inspected**, not just generated. The 17 committed images in
`screens/` are a representative subset of the 44 captured.

## Findings and their disposition

| #   | Screen                           | Finding                                                                                                      | Disposition                                                                                       |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| V1  | `/provider/support` ticket, 1440 | Conversation spanned the full window; lines too long to read                                                 | Fixed: readable centred column (`max-w-3xl`). Customer route is unaffected inside its phone frame |
| V2  | Ticket, AR                       | Timestamps in the browser default locale (`PM 9:14:13 ,11/3/2026`)                                           | Fixed: `Intl.DateTimeFormat(lang, medium/short)`; unit-tested                                     |
| V3  | Ticket, AR 390                   | Arabic timestamp scrambled inside an English reply bubble; bubble alignment followed each message's language | Fixed: `dir="auto"` moved to the message text; bubble and time follow the page direction          |
| V4  | Suspended status, all            | Body said "contact support through the official channels" beside the new in-app action                       | Fixed: "Contact support for details." / «تواصل مع الدعم لمعرفة التفاصيل.»                         |
| V5  | Support header, 320              | Back button squeezed to 29 px wide; icon tile distorted                                                      | Fixed: `shrink-0`; the journey now asserts 44×44 at all widths                                    |

No open visual findings remain on the K06 surfaces.

## Reviewed states

| State                                                                          | Evidence                                                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Denied provider (suspended) with Contact support                               | `provider-status-suspended-{en,ar}-{320,768,1440}.png`                          |
| Support home: FAQ, form, empty ticket list                                     | `provider-support-home-ar-320.png`, `provider-support-home-en-1024.png`         |
| Loading                                                                        | Captured in run (`provider-support-home-en-320`, "Loading…"); not committed     |
| Open ticket with a support reply (from a notification deep link, after reload) | `provider-support-ticket-{en,ar}-{320,768,1440}.png`                            |
| 200% zoom                                                                      | `provider-support-ticket-{en,ar}-zoom200.png`: text wraps, nothing clipped      |
| Closed ticket: status as text, no composer                                     | `customer-support-closed-en-390.png`                                            |
| Load error for an unknown ticket                                               | vitest `SupportPage` (alert text plus a usable support home); not screenshotted |

## Keyboard and focus

Verified in the journey: "Contact support" takes focus and activates with
Enter. Header Back keeps a visible 44×44 target. A full keyboard walk-through,
screen-reader pass, dark mode and real mobile browsers were **not** done
(BLOCKED_INPUTS B-8).

## Unchanged surfaces

No admin screen, provider workspace, onboarding or dispute workspace layout
changed. The dispute "not enabled" notice gained one link with the existing
`case-button` style. It was not screenshotted, because reaching the intake form needs a
real booking fixture this journey does not create. Its behaviour is covered by
`IntakeForm.support.test.tsx` (EN/AR × customer/provider link targets; red without the link).
