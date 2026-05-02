// Provider available-jobs feed contracts (Sprint 5 slice 5.2).
//
// Read-only feed. Provider-side authenticated; the gate
// (ProviderActiveGuard) restricts visibility to ACTIVE providers, so
// DRAFT / PENDING_REVIEW / SUSPENDED / REJECTED accounts get a 403
// before any data is shaped. The wire deliberately omits seeker
// identity / precise address — those become available only after a
// bid is accepted (Conversation surface).
export * from './request/list-available-jobs.query';
export * from './response/available-job-summary';
export * from './response/list-available-jobs.response';
