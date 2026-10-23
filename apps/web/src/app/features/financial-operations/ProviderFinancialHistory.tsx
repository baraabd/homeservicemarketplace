import { LanguageProvider } from '../../i18n/LanguageContext';
import { FinancialOperationsView } from './FinancialOperationsView';

/** Subscription history remains separate from work eligibility and booking earnings. */
export function ProviderFinancialHistory() {
  return (
    <LanguageProvider>
      <FinancialOperationsView audience="provider" />
    </LanguageProvider>
  );
}
