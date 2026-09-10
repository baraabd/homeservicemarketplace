# Sprint 09B.29 Phase 5 — Deviation register

Every deliberate difference between the shipped product and the approved
prototype, with the authority that permits it.

**A deviation may only be entered here with a recorded product-owner decision.**
I may not authorise one, and an entry without an authority is a defect rather
than a deviation.

---

## D5-01 — Market discovery substates on prototype state 6

| Field                        | Value                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| **Status**                   | Approved                                                                                  |
| **Authority**                | Product-owner decision, "Phase 5 Continuation — Multi-Country Market Resolution Decision" |
| **Affected reference state** | 6 (`area`, Work area)                                                                     |
| **Reference modified?**      | **No.** All four reference hashes are unchanged and re-verified after every commit.       |

### What differs

The approved prototype has no country control on state 6, because it was drawn
against a single-market assumption. The platform is now multi-country from
launch, so a provider whose market is not already known has to be asked.

Six **interaction substates** are added to state 6. They are substates, not new
primary states: the 18-state registry is unchanged and still holds exactly the
integer ids 0–17.

| Substate                       | Purpose                                                           |
| ------------------------------ | ----------------------------------------------------------------- |
| `6.market-suggestion`          | an unconfirmed suggestion, shown with a way to confirm or correct |
| `6.market-confirmation`        | the explicit confirmation that makes a market persistable         |
| `6.market-manual-selection`    | the picker, listing only server-enabled markets                   |
| `6.location-permission-denied` | denial recovery — offers manual selection at once                 |
| `6.location-unavailable`       | timeout, unsupported, or an unresolvable fix                      |
| `6.unsupported-market`         | a real country the operator has not enabled                       |

### What does NOT differ

- **The main state-6 capture is taken after market confirmation** and must
  match the approved prototype at 390×844 within the unchanged 0.005 threshold.
  The substates are captured separately as approved interaction evidence.
- No prototype file, expected image, threshold, crop, mask, font rule or
  viewport definition is altered.
- The substates carry the full Phase 5 bar in their own right: semantic,
  responsive, EN/AR + RTL, accessibility and product-owner visual review.

### Why it is a deviation rather than a defect

The prototype is authoritative for appearance, and it does not depict a
question the product must now ask. Suppressing the question to preserve pixel
identity would make the screen unusable for any provider outside a single
assumed country; drawing it without authority would be inventing design. The
decision supplies the authority, and this entry records it so the difference is
visible in review rather than discovered.

### Verification status

**Not yet implemented.** No substate has been built, captured or reviewed. This
entry reserves and authorises the deviation; it does not claim it is delivered.

---

## Entries requiring authority that does not yet exist

None. No other difference from the approved prototype is planned or shipped.

If implementation reveals that a state cannot reach pixel parity without
altering the reference, the threshold, a mask or the application's semantics,
that is a **hard stop** under the original mandate — it is reported, not entered
here.
