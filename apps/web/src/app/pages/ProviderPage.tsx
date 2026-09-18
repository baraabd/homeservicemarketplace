import { useLocation } from 'react-router';
import { DisputeEntry } from '../features/disputes/DisputeEntry';
import { ProviderApp } from '../components/provider/ProviderApp';

// EcosystemProvider is already mounted in Root.tsx, so we just render the app
export function ProviderPage() {
  const location = useLocation();
  return <>{location.pathname === '/provider/jobs' && <DisputeEntry />}<ProviderApp /></>;
}
