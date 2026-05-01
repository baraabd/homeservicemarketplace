// Body DTO for POST /v1/me/provider/upgrade.
//
// Deliberately empty: the upgrade contract takes ZERO client-supplied
// fields. Identity comes from the authenticated session (@CurrentUser).
// A class with no @-decorated properties combined with the global
// ValidationPipe's `forbidNonWhitelisted: true` causes ANY body field
// (userId, email, role, roles, isAdmin, admin, status, providerProfile,
// availability, …) to be rejected with 400 VALIDATION_ERROR before the
// service is called.
//
// This is the second layer of defence on top of `@CurrentUser`: the
// service layer would already source userId from the session, but
// rejecting at the DTO surface gives operators a clear audit trail
// (the request never even reaches the service) and removes any
// future risk from a refactor that accidentally reads from `@Body()`.
export class UpgradeToProviderDto {}
