// Seeker profile contracts (cross-sprint stabilization). REST surface:
// GET /v1/me/profile + PATCH /v1/me/profile. Avatar upload, password
// change, and account-status updates are explicitly out of scope.
export * from './request/update-profile.request';
export * from './response/get-profile.response';
export * from './response/profile-summary';
export * from './response/update-profile.response';
