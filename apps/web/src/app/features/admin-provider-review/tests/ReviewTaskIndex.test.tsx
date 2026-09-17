import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ADMIN_PROVIDER_REVIEW_TASK_IDS } from '@homeservicemarketplace/contracts';
import { ReviewTaskIndex } from '../components/ReviewTaskIndex';
import { TASK_LABELS } from '../copy';

afterEach(cleanup);
describe('Review task navigation', () => {
  it.each(['en', 'ar'] as const)('covers the six canonical tasks without pretending they are approved in %s', (lang) => {
    render(<ReviewTaskIndex lang={lang} blockers={[]} />);
    const links = within(screen.getByTestId('review-task-index')).getAllByRole('link');
    expect(links).toHaveLength(6);
    ADMIN_PROVIDER_REVIEW_TASK_IDS.forEach((task, i) => {
      expect(links[i]).toHaveAttribute('href', `#review-section-${task}`);
      expect(links[i]).toHaveTextContent(TASK_LABELS[lang][task]);
      expect(links[i]).toHaveTextContent(lang === 'ar' ? 'افتح للمراجعة' : 'Open to review');
    });
  });
  it('highlights only the task attached to a server blocker', () => {
    render(<ReviewTaskIndex lang="en" blockers={[{ code: 'VERIFICATION_REQUIRED', taskId: 'BASICS_IDENTITY' }, { code: 'SELF_REVIEW' }]} />);
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveTextContent('Server-reported blocker');
    expect(screen.getAllByText('Open to review')).toHaveLength(5);
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
  });
});
