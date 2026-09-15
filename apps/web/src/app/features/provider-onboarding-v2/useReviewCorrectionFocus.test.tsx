import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { useReviewCorrectionFocus, readReviewCorrectionTarget } from './useReviewCorrectionFocus';
import { feedbackTaskPath } from './feedback-task-path';

function Editor({
  taskId = 'BASICS_IDENTITY',
  showImage = false,
}: {
  taskId?: string;
  showImage?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const root = useReviewCorrectionFocus({
    taskId,
    search: location.search,
    navigationKey: location.key,
    enabled: true,
  });
  const [name, setName] = useState('Unsaved local name');
  return (
    <div ref={root}>
      <button
        onClick={() =>
          navigate(
            feedbackTaskPath({
              id: 'feedback-1',
              taskId: 'BASICS_IDENTITY',
              field: 'phoneNumber',
              reasonCode: 'INCORRECT',
              providerMessage: 'Correct your number.',
            }),
          )
        }
      >
        Open phone correction
      </button>
      <input
        aria-label="Name"
        data-review-field="displayName"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input aria-label="Phone" data-review-field="phoneNumber" defaultValue="+123456789" />
      <button data-review-field="portfolio" data-review-item="another-owned-image">
        Other image
      </button>
      {showImage && (
        <button data-review-field="portfolio" data-review-item="owned-image">
          Requested image
        </button>
      )}
      <output data-testid="location">
        {location.pathname}
        {location.search}
        {location.hash}
      </output>
    </div>
  );
}
function setup(path: string, props: { taskId?: string; showImage?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Editor {...props} />
    </MemoryRouter>,
  );
}
afterEach(() => vi.restoreAllMocks());

describe('explicit correction focus', () => {
  it('focuses the named editor when following a correction and leaves unsaved field values intact', async () => {
    setup('/provider/onboarding/BASICS_IDENTITY');
    const name = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'Still unsaved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open phone correction' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Phone' })).toHaveFocus());
    expect(name).toHaveValue('Still unsaved');
    expect(screen.getByTestId('location')).toHaveTextContent('?reviewField=phoneNumber');
    name.focus();
    fireEvent.change(name, { target: { value: 'Continue editing' } });
    expect(name).toHaveFocus();
    expect(name).toHaveValue('Continue editing');
  });
  it('waits for the requested owned gallery item and never substitutes another image', async () => {
    const path = feedbackTaskPath({
      id: 'f1',
      taskId: 'PORTFOLIO',
      field: 'portfolio',
      itemId: 'owned-image',
      reasonCode: 'UNCLEAR',
      providerMessage: 'Replace this image.',
    });
    const view = setup(path, { taskId: 'PORTFOLIO' });
    expect(screen.getByRole('button', { name: 'Other image' })).not.toHaveFocus();
    view.rerender(
      <MemoryRouter initialEntries={[path]}>
        <Editor taskId="PORTFOLIO" showImage />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Requested image' })).toHaveFocus(),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('#portfolio');
  });
  it('cancels delayed focus after the provider starts interacting', async () => {
    const path =
      '/provider/onboarding/PORTFOLIO?reviewField=portfolio&reviewItem=owned-image#portfolio';
    const view = setup(path, { taskId: 'PORTFOLIO' });
    const name = screen.getByRole('textbox', { name: 'Name' });
    name.focus();
    fireEvent.keyDown(name, { key: 'a' });
    view.rerender(
      <MemoryRouter initialEntries={[path]}>
        <Editor taskId="PORTFOLIO" showImage />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Requested image' })).toBeInTheDocument(),
    );
    expect(name).toHaveFocus();
  });
  it.each([
    '?reviewField=bio',
    '?reviewField=body%20input',
    '?reviewField=phoneNumber&reviewItem=foreign',
  ])('ignores invalid task/field/selector input %s', (search) => {
    setup(`/provider/onboarding/BASICS_IDENTITY${search}`);
    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Phone' })).not.toHaveFocus();
  });
  it('validates task names and never focuses a foreign item', () => {
    expect(readReviewCorrectionTarget('unknown', '?reviewField=phoneNumber')).toBeNull();
    setup('/provider/onboarding/PORTFOLIO?reviewField=portfolio&reviewItem=foreign#portfolio', {
      taskId: 'PORTFOLIO',
      showImage: true,
    });
    expect(screen.getByRole('button', { name: 'Requested image' })).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Other image' })).not.toHaveFocus();
  });
});
