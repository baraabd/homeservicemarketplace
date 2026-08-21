// POST /v1/me/provider/submit-for-review
//
// Intentionally empty. The submission is an act, not a payload: everything the
// reviewer sees was already saved through PATCH /v1/me/provider/profile. With
// the global ValidationPipe's `forbidNonWhitelisted: true`, an empty DTO means
// ANY field a client tries to smuggle in — `status`, `approved`, `userId`,
// `providerProfileId` — is rejected with 400 before the handler runs.
export class SubmitProviderForReviewDto {}
