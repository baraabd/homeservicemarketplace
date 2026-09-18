import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router';
import {
  ADMIN_PROVIDER_REVIEW_TASK_IDS,
  type AdminProviderReviewBlocker,
  type AdminProviderReviewTaskId,
} from '@homeservicemarketplace/contracts';
import { ReviewTaskTabs } from '../components/ReviewTaskTabs';
import { ReviewSection } from '../components/ReviewPrimitives';
import { useReviewTaskNavigation } from '../useReviewTaskNavigation';
import { TASK_LABELS, type ReviewLanguage } from '../copy';

afterEach(cleanup);

function Harness({ lang = 'en', blockers = [] }: {
  lang?: ReviewLanguage;
  blockers?: AdminProviderReviewBlocker[];
}) {
  const navigation = useReviewTaskNavigation();
  const location = useLocation();
  return (
    <>
      <output data-testid="location">{JSON.stringify(location)}</output>
      <Link to={`${location.pathname}${location.search}#review-section-WORK_AREA`} state={location.state}>
        Open blocker
      </Link>
      <Link to={`${location.pathname}${location.search}#review-decision-panel`} state={location.state}>
        Open decision panel
      </Link>
      <ReviewTaskTabs
        lang={lang}
        blockers={blockers}
        value={navigation.task}
        onValueChange={navigation.selectTask}
        focusLinkedPanel={navigation.focusLinkedPanel}
      >
        <div className="ar-stack">
          {ADMIN_PROVIDER_REVIEW_TASK_IDS.map((task) => (
            <ReviewSection key={task} id={`review-section-${task}`} title={TASK_LABELS[lang][task]}>
              <input aria-label={`note-${task}`} defaultValue="" />
            </ReviewSection>
          ))}
        </div>
      </ReviewTaskTabs>
    </>
  );
}
function openTask(task: AdminProviderReviewTaskId) {
  // Radix activates its trigger on primary mouse-down, just like a browser pointer action.
  fireEvent.mouseDown(screen.getByTestId(`review-tab-${task}`), { button: 0, ctrlKey: false });
}
function currentLocation() {
  return JSON.parse(screen.getByTestId('location').textContent ?? '{}') as {
    search: string; hash: string; state: unknown;
  };
}

describe('Tabbed Admin review presentation', () => {
  it.each(['en', 'ar'] as const)('shows exactly one accessible section and retains inactive drafts in %s', (lang) => {
    render(<MemoryRouter><Harness lang={lang} /></MemoryRouter>);
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(6);
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(TASK_LABELS[lang].BASICS_IDENTITY);
    fireEvent.change(screen.getByLabelText('note-BASICS_IDENTITY'), { target: { value: 'Unsent note' } });
    openTask('PORTFOLIO');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(TASK_LABELS[lang].PORTFOLIO);
    expect(screen.getByTestId('review-panel-BASICS_IDENTITY')).toHaveAttribute('hidden');
    expect(screen.getByTestId('review-panel-BASICS_IDENTITY')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');
    openTask('BASICS_IDENTITY');
    expect(screen.getByLabelText('note-BASICS_IDENTITY')).toHaveValue('Unsent note');
  });

  it('uses the URL and preserves directory filters and navigation state', () => {
    render(
      <MemoryRouter initialEntries={[{
        pathname: '/admin/providers/provider-1',
        search: '?returnTo=%2Fadmin%2Freviews%3Fquery%3DAhmad&cursor=page-two&reviewTab=PORTFOLIO',
        state: { from: 'reviews' },
      }]}><Harness /></MemoryRouter>,
    );
    expect(screen.getByTestId('review-tab-PORTFOLIO')).toHaveAttribute('aria-selected', 'true');
    openTask('WORKING_HOURS');
    const location = currentLocation();
    const params = new URLSearchParams(location.search);
    expect(params.get('reviewTab')).toBe('WORKING_HOURS');
    expect(params.get('returnTo')).toBe('/admin/reviews?query=Ahmad');
    expect(params.get('cursor')).toBe('page-two');
    expect(location.state).toEqual({ from: 'reviews' });
    expect(location.hash).toBe('');
  });

  it('opens a historical blocker link and retains that task when another anchor is used', async () => {
    render(<MemoryRouter initialEntries={['/admin/providers/p?reviewTab=PORTFOLIO']}><Harness /></MemoryRouter>);
    fireEvent.click(screen.getByText('Open blocker'));
    await waitFor(() => expect(screen.getByTestId('review-tab-WORK_AREA')).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(TASK_LABELS.en.WORK_AREA);
    await waitFor(() => expect(new URLSearchParams(currentLocation().search).get('reviewTab')).toBe('WORK_AREA'));
    await waitFor(() => expect(screen.getByRole('tabpanel')).toHaveFocus());
    fireEvent.click(screen.getByText('Open decision panel'));
    expect(screen.getByTestId('review-tab-WORK_AREA')).toHaveAttribute('aria-selected', 'true');
    expect(currentLocation().hash).toBe('#review-decision-panel');
  });

  it('handles invalid URL input and keeps server issue counts separate from completion', () => {
    render(<MemoryRouter initialEntries={['/admin/providers/p?reviewTab=APPROVED']}>
      <Harness blockers={[{ code: 'EVIDENCE_NOT_READY', taskId: 'BASICS_IDENTITY' }]} />
    </MemoryRouter>);
    expect(screen.getByTestId('review-tab-BASICS_IDENTITY')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('review-tab-BASICS_IDENTITY')).toHaveAccessibleDescription('Server-reported issues: 1');
    expect(screen.queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument();
    openTask('REVIEW_SUBMISSION');
    expect(screen.getByTestId('review-tab-BASICS_IDENTITY')).toHaveAccessibleDescription('Server-reported issues: 1');
    expect(screen.getByRole('button', { name: 'Next section' })).toBeDisabled();
  });

  it('keeps ordinary sections unchanged outside the tabbed dossier', () => {
    render(<ReviewSection id="other-section" title="Other section">Content</ReviewSection>);
    expect(screen.getByRole('region', { name: 'Other section' })).toHaveTextContent('Content');
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
  });
});
