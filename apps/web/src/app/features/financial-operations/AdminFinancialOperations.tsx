import { LanguageProvider } from '../../i18n/LanguageContext';
import { FinancialOperationsView } from './FinancialOperationsView';

/** Guarded by the coordinated Admin route and fresh API permission checks. */
export function AdminFinancialOperations() {
  return (
    <LanguageProvider>
      <FinancialOperationsView audience="admin" />
    </LanguageProvider>
  );
}
