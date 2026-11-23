import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { DisputeIntakeContext } from '@homeservicemarketplace/contracts';

import { IntakeForm } from './IntakeForm';

// K06 — a participant refused by the dispute pilot ("not enabled") is told
// that support remains available, and now gets a working link to it: their
// own app's support route, chosen by the server-reported participant role.

function contextFor(role: DisputeIntakeContext['role']): DisputeIntakeContext {
  return {
    booking: {
      id: 'b-1',
      status: 'COMPLETED',
      serviceLabelEn: 'Plumbing',
      serviceLabelAr: 'سباكة',
    },
    role,
    canOpen: false,
    blocker: 'NOT_ENABLED',
    existingCaseId: null,
    policyVersion: null,
    openingDeadline: null,
    issueCodes: [],
    requestedOutcomes: [],
  };
}

function renderForm(role: DisputeIntakeContext['role'], lang: 'en' | 'ar') {
  const router = createMemoryRouter(
    [
      {
        path: '/disputes/new',
        element: (
          <IntakeForm context={contextFor(role)} lang={lang} readOnly={false} refresh={() => {}} />
        ),
      },
    ],
    { initialEntries: ['/disputes/new'] },
  );
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('IntakeForm — denied intake offers support', () => {
  it.each([
    ['PROVIDER', 'en', 'Contact support', '/provider/support'],
    ['SEEKER', 'en', 'Contact support', '/home/support'],
    ['PROVIDER', 'ar', 'تواصل مع الدعم', '/provider/support'],
    ['SEEKER', 'ar', 'تواصل مع الدعم', '/home/support'],
  ] as const)('%s (%s) links to %s', (role, lang, label, href) => {
    renderForm(role, lang);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(lang === 'en' ? 'not enabled' : 'غير مفعّل');
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
  });
});
