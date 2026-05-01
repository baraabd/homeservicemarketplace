// POST /v1/me/provider/upgrade — empty body. The deliberate upgrade
// path takes its userId only from the authenticated session; no
// client-supplied data is accepted. Kept as a distinct type so future
// onboarding fields (e.g. accepted-terms timestamp) can be added
// without shape-breaking the wire.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface UpgradeToProviderRequest {}
