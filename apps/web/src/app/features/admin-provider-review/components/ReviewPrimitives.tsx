import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { statusLabel, type ReviewLanguage } from '../copy';

export function ReviewBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  return <span className={`ar-badge ar-badge-${tone}`}>{children}</span>;
}
export function StatusBadge({
  value,
  lang,
}: {
  value: string | null | undefined;
  lang: ReviewLanguage;
}) {
  const tone = ['ACTIVE', 'VERIFIED', 'APPROVED', 'ACCEPTED', 'CLEAN'].includes(value ?? '')
    ? 'success'
    : ['REJECTED', 'SUSPENDED', 'QUARANTINED', 'RESTRICTED', 'TERMINATED', 'LOCKED'].includes(
          value ?? '',
        )
      ? 'danger'
      : [
            'PENDING',
            'PENDING_REVIEW',
            'SUBMITTED',
            'IN_REVIEW',
            'ACTION_REQUIRED',
            'RETURNED',
            'DOCUMENTS_REQUIRED',
          ].includes(value ?? '')
        ? 'warning'
        : 'neutral';
  return <ReviewBadge tone={tone}>{statusLabel(value, lang)}</ReviewBadge>;
}
export function ReviewBanner({
  children,
  tone = 'neutral',
  role,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
  role?: 'alert' | 'status';
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'danger' ? AlertCircle : Info;
  return (
    <div className={`ar-banner ar-banner-${tone}`} role={role}>
      <Icon size={20} aria-hidden />
      <div>{children}</div>
    </div>
  );
}
export function ReviewField({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`ar-field${wide ? ' ar-field-wide' : ''}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
export function ReviewSection({
  id,
  title,
  number,
  children,
  aside,
}: {
  id: string;
  title: string;
  number?: number;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section
      id={id}
      data-testid={id}
      className="ar-card ar-section"
      aria-labelledby={`${id}-heading`}
    >
      <header className="ar-section-header">
        <div className="ar-section-title">
          {number ? (
            <span className="ar-section-number" aria-hidden>
              {String(number).padStart(2, '0')}
            </span>
          ) : null}
          <h2 id={`${id}-heading`} className="ar-heading">
            {title}
          </h2>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
