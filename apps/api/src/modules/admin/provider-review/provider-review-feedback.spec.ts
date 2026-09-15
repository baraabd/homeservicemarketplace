import { validateReviewFeedback } from './provider-review-feedback';
import { reviewFixture } from '../../../../test/fixtures/admin-provider-review.fixture';

describe('correction targets in the reviewed application', () => {
  const correction = {
    taskId: 'WORK_AREA' as const,
    field: 'serviceAreaCity',
    reasonCode: 'INFORMATION_INCORRECT',
    providerMessage: 'Confirm the city.',
  };
  it('accepts a supported editable field and preserves whole-task legacy feedback', () => {
    expect(() =>
      validateReviewFeedback([correction, { ...correction, field: undefined }], reviewFixture()),
    ).not.toThrow();
  });
  it('rejects a field belonging to another task or a server-owned derived field', () => {
    for (const field of ['bio', 'radiusKm', 'adminRole', 'https://example.com']) {
      expect(() => validateReviewFeedback([{ ...correction, field }], reviewFixture())).toThrow(
        expect.objectContaining({ status: 400 }),
      );
    }
  });
  it('refuses a foreign item and an item id on a scalar field', () => {
    const data = reviewFixture();
    expect(() => validateReviewFeedback([{ ...correction, itemId: 'foreign' }], data)).toThrow();
    expect(() =>
      validateReviewFeedback(
        [{ ...correction, taskId: 'PORTFOLIO', field: 'portfolio', itemId: 'foreign' }],
        data,
      ),
    ).toThrow();
  });
  it('accepts the exact active document but rejects a superseded document', () => {
    const data = reviewFixture();
    const document = data.verificationCase!.documents[0];
    const input = {
      ...correction,
      taskId: 'BASICS_IDENTITY' as const,
      field: 'verificationDocuments',
      itemId: document.id,
    };
    expect(() => validateReviewFeedback([input], data)).not.toThrow();
    document.supersededAt = new Date();
    expect(() => validateReviewFeedback([input], data)).toThrow();
  });
});
