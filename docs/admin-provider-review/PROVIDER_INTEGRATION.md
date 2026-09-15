# Provider application snapshots and correction loop

The Admin workspace reads the same application persisted by the Provider wizard. The Provider changes are integration and product-feature work (Modes A/C); existing Provider form design, autosave and capability policy remain authoritative.

## Submission evidence

`POST /v1/me/provider/onboarding/submit` writes two separate immutable JSON documents on the new submission:

- `snapshot`: the policy candidate and counts judged by the pinned onboarding policy version.
- `reviewSnapshot`: versioned, allowlisted application metadata for human review. It includes identity/contact metadata, service selections and experience, work area, weekly intervals, profile/portfolio metadata, and the accepted consent version/time.

The full snapshot is captured within the same transaction as the lifecycle claim and audit event. Wizard edits, submission and withdrawal acquire a profile row lock before reading state. This prevents an autosave that started concurrently from changing the form after submission or making the policy candidate disagree with the captured answers.

The snapshot stores portfolio item IDs, media asset IDs and revisions. It does not store evidence objects, storage keys, read credentials, signed URLs or private reviewer notes. Identity content remains behind the existing authenticated evidence endpoint. A legacy submission without `reviewSnapshot` has no recoverable historical full snapshot; the Admin must distinguish that absence from current profile data.

An empty portfolio remains optional. The review read model now reports actual non-deleted pending items as `PORTFOLIO_REVIEW`, without turning moderation into a provider submission blocker. Submission still grants neither the verified badge nor work access.

## Requested changes

The latest submission's `RETURNED` decision may carry this provider-safe projection:

```ts
{
  requestedAt: string;
  items: Array<{
    id: string;
    taskId: ProviderReviewTaskId;
    field?: string;
    itemId?: string;
    reasonCode: string;
    providerMessage: string;
  }>;
}
```

`GET /v1/me/provider/onboarding/draft`, `/hub` and `/review` expose it as `reviewFeedback` while the application is `RETURNED`. The projection copies only the public fields and never forwards an internal note. Hub and review feedback reads write nothing; the draft endpoint retains its pre-existing draft initialization/defaults behavior.

Corrections remain visible through autosave. They are not silently marked resolved by opening a task. Submitting again creates a new submission/snapshot and supersedes the old feedback; it preserves the original answers and reviewer instructions as history. The normal server completeness, consent and version checks still decide whether resubmission is allowed.

The V2 hub lists all requested tasks and offers review/resubmit when the server makes the review task available. Individual tasks display their relevant messages. Navigation out of an edited task uses the existing autosave exit coordinator.

## Reachable identity review

`/provider/verification` is an authenticated route outside the workspace's ACTIVE-only operational routes. It reuses `ProviderVerificationScreen`; applicants can reach identity upload before activation and reopen a case after an explicit re-verification decision. Its controls continue to come from the existing capabilities and verification API. The route is available with either onboarding UI flag value.

The V2 status centre links to this route when verification needs provider attention: not started, draft, requested corrections, rejection or expiry. A submitted or reviewed case keeps the approved waiting layout without an additional task button. The dedicated route remains directly reachable in every state. `BASICS_IDENTITY` corrections offer the document link as well as the form task. Corrections with `field` equal to `identityDocument`, `verificationDocuments` or `categoryLicense` link directly to verification. Portfolio item corrections link to the existing gallery sub-screen; experience corrections use the existing experience sub-screen.

## Verification evidence

- Unit tests cover snapshot completeness, independent captured metadata, protected URL exclusion, public feedback allowlisting, latest-submission precedence and real portfolio counts.
- Provider component tests cover bilingual correction rendering, task navigation, absent feedback and text escaping.
- `onboarding-review-submit.integration.spec.ts` adds real Postgres coverage for a returned application, autosave, retained history, resubmission and a concurrent autosave blocked behind submission.
- `provider-verification.spec.ts` adds English/Arabic browser coverage of an applicant reaching the standalone route and retaining it after reload.

Real database and browser suites require their usual CI services. Unit and static checks do not substitute for those runtime gates.
