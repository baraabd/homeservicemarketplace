import {
  isProviderReviewCorrectionField,
  type AdminProviderReviewFeedbackInput,
} from '@homeservicemarketplace/contracts';
import { AppError } from '../../../shared/errors/app-error';
import type { AdminProviderReviewData } from './provider-review.repository';

/** Run after revision validation in the decision transaction. Never accept a
 * foreign image/document/category id just because its task name is valid. */
export function validateReviewFeedback(
  items: AdminProviderReviewFeedbackInput[],
  data: AdminProviderReviewData,
): void {
  for (const item of items) {
    if (item.field && !isProviderReviewCorrectionField(item.taskId, item.field)) invalid();
    if (!item.itemId) continue;
    const field = item.field;
    const owned =
      field === 'portfolio'
        ? data.current.portfolio.some((row) => row.id === item.itemId)
        : field === 'specialties'
          ? data.current.services.specialties.some((row) => row.id === item.itemId)
          : ['verificationDocuments', 'identityDocument', 'categoryLicense'].includes(field ?? '')
            ? data.verificationCase?.documents.some(
                (row) =>
                  row.id === item.itemId &&
                  !row.supersededAt &&
                  (field !== 'categoryLicense' || row.kind === 'CATEGORY_LICENSE') &&
                  (field !== 'identityDocument' ||
                    ['INDIVIDUAL_IDENTITY', 'AUTHORIZED_REPRESENTATIVE_IDENTITY'].includes(
                      row.kind,
                    )),
              )
            : false;
    if (!owned) invalid();
  }
}

function invalid(): never {
  throw new AppError(
    'VALIDATION_ERROR',
    'Choose a supported correction target from this application.',
    400,
    { reason: 'INVALID_CORRECTION_TARGET' },
  );
}
