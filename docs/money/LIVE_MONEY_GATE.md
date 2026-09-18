# Live Money Gate

Production/live payment execution is forbidden unless all conditions are evidenced on the final release SHA: Sprints 1–12 exit gates complete; no open High/Critical security finding; ADR 0014 accepted; Sprint 13 persistence/domain/API/UX gates complete; Sprint 14 sandbox payment/evidence/webhook/refund/recovery gates complete; migration rehearsal and rollback/recovery procedure verified; CodeQL/dependency/secret/container gates green; least-privilege production secrets configured outside source control; reconciliation and operator runbooks approved.

Feature/config defaults must fail closed: absence of an explicit production enablement keeps live rails disabled. A successful CI run alone is not evidence that the prerequisites above are satisfied.