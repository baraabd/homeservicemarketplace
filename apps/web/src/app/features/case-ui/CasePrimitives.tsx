import type { ReactNode } from 'react';
import { AlertCircle, Clock3, Inbox } from 'lucide-react';
import './case-ui.css';
export function CaseNotice({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return <div className={`case-notice${alert ? ' case-notice-error' : ''}`} role={alert ? 'alert' : 'status'}><AlertCircle size={20} aria-hidden="true" /><div>{children}</div></div>;
}
export function CaseEmpty({ title, children }: { title: string; children: ReactNode }) {
  return <section className="case-card case-empty"><Inbox size={34} aria-hidden="true" /><h2>{title}</h2><div className="case-muted">{children}</div></section>;
}
export function CaseBadge({ children }: { children: ReactNode }) {
  return <span className="case-badge"><Clock3 size={15} aria-hidden="true" />{children}</span>;
}
export function CaseDate({ value, lang }: { value: string; lang: 'ar' | 'en' }) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <span>—</span>;
  return <time dateTime={value}>{new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(date)}</time>;
}
