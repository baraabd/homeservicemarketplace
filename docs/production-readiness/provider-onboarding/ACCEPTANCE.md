# S06 — flag authority and truthful route evidence

Base: `66e336cb4823802aabacc536584972aa43056d23`; final head/checks are in the PR. Status: PARTIAL IMPLEMENTATION; V2 remains gated under decision B. No API, schema, contracts, map/hours UI, dependency, workflow, flag default or approved design is changed.

Implemented one runtime resolution path for V2's boolean/source/key, preserving current override and fallback semantics. The real phase5 route marker writer no longer presents a caller-supplied string as observed build provenance. It retains the original declaration, explicitly marks its source unverified and sets deploymentDefaultProven=false. Existing route/persistence observations are preserved; their interpretation is bounded, not their test assertions weakened.

Local TypeScript syntax/transpilation and pure unobserved-provenance assertions were executed. Added unit tests for default/build/override/storage-blocked resolution and rejection of unsupported evidence inferences. Real persistence/default-build acceptance is not inferred from those tests. Existing CI/CodeQL/real-route/persistence/visual/RTL/mobile/accessibility jobs must run on the final head.

Outstanding: remove overrides from a dedicated deployment-default acceptance path, capture browser-observed source, enforce promotion checks, cover every required field and all save/correction/lifecycle cases. The old persistence suite still uses overrides; this report explicitly says so. No complete S06 or production-default certification is claimed. See ROLLOUT_DECISION.md for conditions and rollback limitations.

Coordination: S06 owns the V2 entry in shared feature-flags.ts and phase5 evidence helpers for this wave; S07/S08 do not edit those paths. Root App.tsx synchronization belongs to S09. No merge or deployment performed.
