import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ADMIN_PROVIDER_REVIEW_TASK_IDS } from '@homeservicemarketplace/contracts';
import { ReviewTaskOverview } from '../components/ReviewTaskOverview';
import { reviewTaskSummary } from '../review-task-summary';
import { REVIEW_COPY } from '../copy';
import { reviewFixture, snapshot } from './fixtures';

afterEach(cleanup);
describe('Review task navigation and snapshot facts', () => {
  it.each(['en', 'ar'] as const)('links to all six existing dossier sections in %s', (lang) => {
    const review = reviewFixture();
    render(<ReviewTaskOverview review={review} snapshot={review.submission!.snapshot} lang={lang} />);
    for (const task of ADMIN_PROVIDER_REVIEW_TASK_IDS) {
      expect(screen.getByTestId(`review-task-link-${task}`)).toHaveAttribute('href', `#review-section-${task}`);
    }
    expect(screen.getAllByTestId(/^review-task-link-/)).toHaveLength(6);
  });
  it('does not label unblocked sections as approved or complete', () => {
    const review = reviewFixture();
    render(<ReviewTaskOverview review={review} snapshot={review.current} lang="en" />);
    expect(screen.getAllByText('Inspect details')).toHaveLength(6);
    expect(screen.queryByText(/^(Approved|Complete|Ready)$/)).not.toBeInTheDocument();
  });
  it('projects only task-specific server blockers, not missing-field heuristics', () => {
    const review = reviewFixture();
    review.blockers = [{ code: 'VERIFICATION_REQUIRED', taskId: 'BASICS_IDENTITY' }, { code: 'WORK_GRANT_REQUIRED' }];
    render(<ReviewTaskOverview review={review} snapshot={null} lang="en" />);
    expect(screen.getByTestId('review-task-link-BASICS_IDENTITY')).toHaveTextContent('1 review alert');
    expect(screen.getByTestId('review-task-link-WORK_AREA')).toHaveTextContent('Inspect details');
  });
  it('keeps missing historical snapshots distinct from current data', () => {
    for (const task of ADMIN_PROVIDER_REVIEW_TASK_IDS) expect(reviewTaskSummary(task, null, 'en')).toBe(REVIEW_COPY.en.notCaptured);
  });
  it('uses the selected snapshot, not the current projection', () => {
    const original = snapshot(); const current = snapshot(); current.workArea.city = 'Aleppo';
    expect(reviewTaskSummary('WORK_AREA', original, 'en')).toBe('Damascus · SY');
    expect(reviewTaskSummary('WORK_AREA', current, 'en')).toBe('Aleppo · SY');
  });
  it('counts working days, not the number of split intervals', () => {
    const data = snapshot(); data.availability.intervals.push({ dayOfWeek: 0, startMinute: 1080, endMinute: 1200, timezone: 'Asia/Damascus' });
    expect(reviewTaskSummary('WORKING_HOURS', data, 'en')).toBe('1 working day · Asia/Damascus');
  });
  it('reports zero portfolio items without inventing an acceptance blocker', () => {
    expect(reviewTaskSummary('PORTFOLIO', snapshot(), 'en')).toBe('0 images in this snapshot');
  });
});
