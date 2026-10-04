# R14 — Budget authority matrix

| Surface                          | Before R14                                                            | After R14                               | Evidence                                               |
| -------------------------------- | --------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| `ServiceRequest` schema          | no budget column                                                      | unchanged (no column)                   | `schema.prisma`                                        |
| Seeker request wizard            | no budget input                                                       | unchanged                               | web source                                             |
| `POST/PATCH /v1/me/requests`     | budget property rejected (whitelist)                                  | unchanged; now asserted                 | `r14-budget-authority.real-api.spec.ts`                |
| Provider feed list/detail wire   | `budget: {amountMin:null, amountMax:null, currency:null, label:null}` | no `budget` field                       | `available-requests.service.spec.ts`, R14 browser spec |
| Shared contract                  | `ProviderAvailableRequestBudget` (all nullable) on the summary        | type and field removed                  | `packages/contracts/src/provider/requests/index.ts`    |
| Provider job card                | chip hidden when empty                                                | chip removed                            | R14 browser spec                                       |
| Provider detail overlay          | tile hidden when empty                                                | tile and label removed                  | `ProviderApp.test.tsx`, R14 browser spec               |
| Offer form (BiddingModal)        | **always showed "Budget:" with no value**                             | note removed                            | `ProviderApp.test.tsx`, R14 browser spec               |
| Map marker popup                 | **showed "0km · " (legacy zero distance, empty budget)**              | shows real `distanceKm` only when known | source                                                 |
| `EcosystemContext` seed requests | invented budgets such as "$30–50/hr" (unused seed state)              | removed with the legacy `budget` field  | source                                                 |
| Deprecated-route notice          | advertised "budget"                                                   | wording corrected                       | `deprecated-routes.ts`                                 |
