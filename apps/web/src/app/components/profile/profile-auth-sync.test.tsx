import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EditProfilePage } from './EditProfilePage';
import { ProfileTab } from './ProfileTab';

const mockUseAuth = vi.fn();

vi.mock('../../../lib/auth-provider', () => ({
  useAuth: () => mockUseAuth(),
}));

function renderWithLang(ui: ReactNode) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('profile auth identity sync', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: {
        id: 'u1',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        status: 'ACTIVE',
        emailVerifiedAt: '2026-04-20T00:00:00.000Z',
        mfaEnabled: false,
        roles: ['customer'],
      },
    });
  });

  it('renders the authenticated user identity in ProfileTab', () => {
    renderWithLang(
      <ProfileTab
        isOffline={false}
        onToggleOffline={() => {}}
        notifications={[]}
        onMarkAllRead={() => {}}
        onMarkRead={() => {}}
        unreadCount={0}
      />,
    );

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
  });

  it('seeds EditProfilePage from the authenticated user', () => {
    renderWithLang(<EditProfilePage onBack={() => {}} />);

    expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('AL')).toBeInTheDocument();
  });
});
