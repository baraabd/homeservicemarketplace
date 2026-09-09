# HomeServiceMarketplace — Provider Onboarding V2

This delivery contains a mobile-first, bilingual provider onboarding prototype and an editable SVG user-flow map.

## Files

- `provider-onboarding-prototype.html` — standalone interactive prototype with 18 screens and Arabic/English switching.
- `provider-onboarding-user-flow.svg` — editable vector flow map that can be imported into Figma, Penpot, Sketch, Illustrator, or diagrams.net.

## Prototype coverage

1. Provider account activation.
2. Provider-role/session synchronization before navigation.
3. Six-task onboarding hub.
4. Basic details and direct photo upload.
5. Service search and selection.
6. Experience stepper and transport choices.
7. Automatic work radius with map and reward state.
8. Multi-day availability editor.
9. Public profile preview.
10. Portfolio upload, crop/reorder concept, and moderation state.
11. Completed hub with moderation separated from user completion.
12. Final review.
13. Terms and sticky submission action.
14. Submission confirmation.
15. Status centre with four independent axes.
16. Returned/action-required recovery.
17. Correct 401 session-expired state.
18. Activated account and workspace unlock.

## Product rules captured

- A `401` means the session is missing or expired and can lead to sign-in.
- A `403` immediately after upgrade is treated as a role/session synchronization failure, not as an expired session.
- A pending specialty application completes the provider's input task; platform moderation remains a separate status.
- Pending moderation can delay activation but must not deadlock final submission.
- Onboarding has no workspace bottom navigation.
- Successful server persistence is the only condition that may display “Saved”.
- Every important touch target is designed around a 44 px minimum.
- The phone canvas is 390 px first; wider screens should centre a focused column instead of stretching the form.

## Using the SVG with free Figma

1. Open a Figma design file.
2. Drag `provider-onboarding-user-flow.svg` onto the canvas.
3. Ungroup imported layers when individual text and shapes need editing.
4. Ensure Cairo and Inter are available for correct Arabic/English rendering.

## Validation completed

- All 18 prototype screens render through the JavaScript smoke harness without runtime exceptions.
- The English rendering contains no accidental Arabic UI copy.
- The SVG is well-formed XML and was rasterized for visual inspection.
- The prototype uses semantic native controls, keyboard focus, RTL/LTR direction switching, reduced-motion support, and mobile reflow down to 320 px.
