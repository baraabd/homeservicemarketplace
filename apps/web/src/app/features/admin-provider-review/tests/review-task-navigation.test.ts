import { describe, expect, it } from 'vitest';
import { ADMIN_PROVIDER_REVIEW_TASK_IDS } from '@homeservicemarketplace/contracts';
import {
  parseReviewTask,
  reviewTaskFromHash,
  reviewTaskSearch,
  selectedReviewTask,
} from '../review-task-navigation';

describe('Review tab URL state', () => {
  it.each(ADMIN_PROVIDER_REVIEW_TASK_IDS)('accepts only the canonical task %s', (task) => {
    expect(parseReviewTask(task)).toBe(task);
    expect(reviewTaskFromHash(`#review-section-${task}`)).toBe(task);
    expect(selectedReviewTask(`?reviewTab=${task}`, '')).toBe(task);
  });
  it.each([undefined, null, '', 'APPROVED', '../PORTFOLIO', 'portfolio', '<script>'])('rejects %s without selecting an action', (input) => {
    expect(parseReviewTask(input)).toBeNull();
  });
  it('prioritizes a valid legacy section link over a saved tab and ignores unrelated anchors', () => {
    expect(selectedReviewTask('?reviewTab=PORTFOLIO', '#review-section-WORK_AREA')).toBe('WORK_AREA');
    expect(selectedReviewTask('?reviewTab=PORTFOLIO', '#review-decision-panel')).toBe('PORTFOLIO');
    expect(selectedReviewTask('?reviewTab=APPROVED', '#review-section-INVALID')).toBe('BASICS_IDENTITY');
  });
  it('changes only its own query parameter, keeping duplicates and encoded directory context elsewhere', () => {
    const original = '?returnTo=%2Fadmin%2Freviews%3Fquery%3Da%252Bb&query=one&query=two&reviewTab=PORTFOLIO&reviewTab=WORK_AREA';
    const next = new URLSearchParams(reviewTaskSearch(original, 'WORKING_HOURS'));
    expect(next.getAll('reviewTab')).toEqual(['WORKING_HOURS']);
    expect(next.getAll('query')).toEqual(['one', 'two']);
    expect(next.get('returnTo')).toBe('/admin/reviews?query=a%2Bb');
    expect(reviewTaskSearch('', 'PORTFOLIO')).toBe('?reviewTab=PORTFOLIO');
  });
});
