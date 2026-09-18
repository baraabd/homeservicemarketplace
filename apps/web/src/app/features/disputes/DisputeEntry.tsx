import { Link } from 'react-router';
import { useLang } from '../../i18n/LanguageContext';
import { DISPUTE_COPY } from './copy';
import '../case-ui/case-ui.css';
/** Navigation flag only. The API independently enforces the account-scoped pilot policy. */
export function DisputeEntry() {
  const { lang } = useLang();
  if (import.meta.env.VITE_DISPUTE_INTAKE_V1 !== 'true') return null;
  return <div className="case-entry"><Link to="/disputes">{DISPUTE_COPY[lang].title}</Link></div>;
}
