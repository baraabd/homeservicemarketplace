import { useNavigate, useSearchParams } from 'react-router';
import type { SupportTicketExperience } from '@homeservicemarketplace/contracts';

import { HelpSupportPage } from '../components/profile/HelpSupportPage';

// K06 — routed help & support, one per app.
//
// /provider/support sits OUTSIDE the provider workspace splat and its status
// gate: a provider whose work access is denied is exactly the person who needs
// support. /home/support gives customer notifications a stable target. The API
// enforces ticket ownership; `?ticket=` only chooses which owned ticket to open.
const HOME: Record<SupportTicketExperience, string> = {
  provider: '/provider',
  seeker: '/home/profile',
};

export function SupportPage({ experience }: { experience: SupportTicketExperience }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (
    // The provider app is full width; keep the conversation at a readable
    // measure. Inside the customer app's phone frame the cap has no effect.
    <div className="min-h-svh bg-slate-50 dark:bg-slate-900">
      <div className="relative mx-auto min-h-svh w-full max-w-3xl">
        <HelpSupportPage
          experience={experience}
          initialTicketId={params.get('ticket')}
          onBack={() => navigate(HOME[experience])}
        />
      </div>
    </div>
  );
}

export function ProviderSupportPage() {
  return <SupportPage experience="provider" />;
}

export function CustomerSupportPage() {
  return <SupportPage experience="seeker" />;
}
