import { Link, Route, Routes, useLocation } from 'react-router';
import { ShieldCheck, Moon } from 'lucide-react';
import { LanguageProvider, useLang } from '../i18n/LanguageContext';
import { DISPUTE_COPY } from '../features/disputes/copy';
import { CaseBackLink, CaseDetailScreen, CaseListScreen, NewCaseScreen } from '../features/disputes/DisputeScreens';
import '../features/case-ui/case-ui.css';
function DisputesSurface() {
  const { lang, dir, darkMode, toggleDarkMode, toggleLang } = useLang();
  const t = DISPUTE_COPY[lang]; const location = useLocation();
  return <div className={`case-ui${darkMode ? ' dark' : ''}`} dir={dir} lang={lang} data-testid="disputes-surface">
    <header className="case-header"><span className="case-brand"><ShieldCheck size={24} aria-hidden="true" />{t.brand}</span><div className="case-controls"><button type="button" className="case-button" onClick={toggleLang} aria-label={lang === 'ar' ? 'التغيير إلى الإنجليزية' : 'Switch to Arabic'}>{t.language}</button><button type="button" className="case-button" onClick={toggleDarkMode} aria-label={t.theme}><Moon size={20} aria-hidden="true" /></button></div></header>
    <main className="case-shell case-stack" id="dispute-main"><div>{location.pathname.replace(/\/$/, '') === '/disputes' ? <Link className="case-button" to="/select">{t.home}</Link> : <CaseBackLink />}</div><p className="case-eyebrow">{t.pilot}</p><Routes><Route index element={<CaseListScreen />} /><Route path="new" element={<NewCaseScreen />} /><Route path=":caseId" element={<CaseDetailScreen />} /></Routes></main>
  </div>;
}
/** Outside the legacy phone frame; language changes never remount entered private text. */
export function DisputesPage() { return <LanguageProvider><DisputesSurface /></LanguageProvider>; }
