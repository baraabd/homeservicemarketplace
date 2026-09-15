import { formatReviewDate } from '../format-review-date';
import { ReviewHistory } from './ReviewHistory';
import { reviewCorrectionFieldLabel } from '../../provider-onboarding-v2/copy/review-correction-fields';
import type { ReactNode } from 'react';
import { useEquipmentCatalog } from '../../../../lib/use-service-categories';
import type {
  AdminProviderReview,
  AdminProviderReviewTaskId,
  ProviderReviewSnapshot,
} from '@homeservicemarketplace/contracts';
import {
  BadgeCheck,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardCheck,
  Images,
  MapPin,
} from 'lucide-react';
import { REVIEW_COPY, TASK_LABELS, statusLabel, type ReviewLanguage } from '../copy';
import {
  ReviewBadge,
  ReviewBanner,
  ReviewField,
  ReviewSection,
  StatusBadge,
} from './ReviewPrimitives';

const TASKS: AdminProviderReviewTaskId[] = [
  'BASICS_IDENTITY',
  'SERVICES_EXPERIENCE',
  'WORK_AREA',
  'WORKING_HOURS',
  'PORTFOLIO',
  'REVIEW_SUBMISSION',
];
const ICONS = [BadgeCheck, BriefcaseBusiness, MapPin, CalendarDays, Images, ClipboardCheck];
const reviewSectionId = (task: AdminProviderReviewTaskId) => `review-section-${task}`;

export function ReviewTaskNavigation({ lang }: { lang: ReviewLanguage }) {
  return (
    <nav className="ar-task-nav" aria-label={REVIEW_COPY[lang].submitted}>
      {TASKS.map((task, i) => {
        const Icon = ICONS[i];
        return (
          <a key={task} href={`#${reviewSectionId(task)}`}>
            <Icon size={19} aria-hidden />
            <span>{TASK_LABELS[lang][task]}</span>
          </a>
        );
      })}
    </nav>
  );
}

function minuteLabel(minute: number, lang: ReviewLanguage) {
  if (minute === 1440) return '24:00';
  return new Intl.DateTimeFormat(lang, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, 0, 4, 0, minute)));
}

export function ReviewDossier({
  review,
  snapshot,
  lang,
  identity,
  categories,
  portfolio,
  submittedSource,
}: {
  review: AdminProviderReview;
  snapshot: ProviderReviewSnapshot | null;
  lang: ReviewLanguage;
  identity: ReactNode;
  categories: ReactNode;
  portfolio: ReactNode;
  submittedSource: boolean;
}) {
  const t = REVIEW_COPY[lang];
  const p = snapshot?.profile;
  const equipment = useEquipmentCatalog();
  const equipmentName = (code: string) => {
    const entry = equipment.data?.find((item) => item.code === code);
    return entry ? (lang === 'ar' ? entry.labelAr : entry.labelEn) : code;
  };
  const empty = snapshot ? t.notProvided : t.notCaptured;
  const text = (value: string | number | null | undefined) =>
    value === null || value === undefined || value === '' ? empty : value;
  const date = (value: string | null | undefined) => formatReviewDate(value, lang, empty);
  const serviceName = (id: string | null | undefined) => {
    const item = snapshot?.services.specialties.find((entry) => entry.id === id);
    return item ? (lang === 'ar' ? item.labelAr : item.labelEn) : text(id);
  };
  const section = (task: AdminProviderReviewTaskId, number: number, children: ReactNode) => (
    <ReviewSection id={reviewSectionId(task)} title={TASK_LABELS[lang][task]} number={number}>
      {children}
    </ReviewSection>
  );
  return (
    <div className="ar-stack">
      {section(
        'BASICS_IDENTITY',
        1,
        <div className="ar-stack">
          <dl className="ar-fields">
            <ReviewField label={t.name}>{text(p?.displayName)}</ReviewField>
            <ReviewField label={t.providerType}>
              {p?.providerType
                ? p.providerType === 'BUSINESS'
                  ? t.registeredBusiness
                  : t.individual
                : empty}
            </ReviewField>
            {p?.providerType === 'BUSINESS' && (
              <ReviewField label={t.business} wide>
                {text(p.legalBusinessName)}
              </ReviewField>
            )}
            <ReviewField label={t.email}>
              <span dir="ltr">{text(p?.email)}</span>
              {p?.email && (
                <div>
                  <ReviewBadge tone={p.emailVerified ? 'success' : 'neutral'}>
                    {p.emailVerified ? t.proven : t.unproven}
                  </ReviewBadge>
                </div>
              )}
            </ReviewField>
            <ReviewField label={t.phone}>
              <span dir="ltr">{text(p?.phoneNumber)}</span>
              {p?.phoneNumber && (
                <div>
                  <ReviewBadge tone={p.phoneVerifiedAt ? 'success' : 'neutral'}>
                    {p.phoneVerifiedAt ? t.proven : t.unproven}
                  </ReviewBadge>
                  {p.phoneVerifiedAt && (
                    <small className="ar-muted"> {date(p.phoneVerifiedAt)}</small>
                  )}
                </div>
              )}
            </ReviewField>
            {p?.profileImageUrl && (
              <ReviewField label={t.photo}>
                <img
                  className="ar-profile-photo"
                  src={p.profileImageUrl}
                  alt={p.displayName}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              </ReviewField>
            )}
          </dl>
          {identity}
        </div>,
      )}
      {section(
        'SERVICES_EXPERIENCE',
        2,
        <div className="ar-stack">
          <dl className="ar-fields">
            <ReviewField label={t.experience}>{text(p?.yearsOfExperience)}</ReviewField>
            <ReviewField label={t.professionSince}>
              {formatReviewDate(p?.professionSince, lang, empty, true)}
            </ReviewField>
            <ReviewField label={t.primaryService} wide>
              {serviceName(snapshot?.services.primarySpecialtyId)}
            </ReviewField>
            <ReviewField label={t.services} wide>
              {snapshot ? (
                snapshot.services.specialties.length ? (
                  <ul className="ar-list">
                    {snapshot.services.specialties.map((item) => (
                      <li
                        className="ar-list-row"
                        key={`${item.id}-${item.applicationId ?? 'approved'}`}
                      >
                        <span>{lang === 'ar' ? item.labelAr : item.labelEn}</span>
                        <StatusBadge value={item.state} lang={lang} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  t.servicesNone
                )
              ) : (
                empty
              )}
            </ReviewField>
            <ReviewField label={t.equipment}>
              {snapshot
                ? snapshot.services.equipmentCodes
                    .map(equipmentName)
                    .join(lang === 'ar' ? '، ' : ', ') || t.notProvided
                : empty}
            </ReviewField>
            <ReviewField label={t.transport}>
              {snapshot
                ? [
                    ...new Set([
                      ...(p?.transportModes ?? []),
                      ...(p?.transportMode ? [p.transportMode] : []),
                    ]),
                  ]
                    .map((value) => statusLabel(value, lang))
                    .join(lang === 'ar' ? '، ' : ', ') || t.notProvided
                : empty}
            </ReviewField>
          </dl>
          {categories}
        </div>,
      )}
      {section(
        'WORK_AREA',
        3,
        <dl className="ar-fields">
          <ReviewField label={t.country}>
            {text(snapshot?.workArea.country)}
            {snapshot?.workArea.countryCode && (
              <small className="ar-muted"> ({snapshot.workArea.countryCode})</small>
            )}
          </ReviewField>
          <ReviewField label={t.city}>{text(snapshot?.workArea.city)}</ReviewField>
          <ReviewField label={t.radius}>
            {snapshot?.workArea.radiusKm != null
              ? `${new Intl.NumberFormat(lang).format(snapshot.workArea.radiusKm)} ${lang === 'ar' ? 'كم' : 'km'}`
              : empty}
          </ReviewField>
          <ReviewField label={t.workshop}>
            {text(snapshot?.workArea.workshopAddressLine)}
          </ReviewField>
          <ReviewField label={t.selectedAreas} wide>
            {snapshot ? (
              snapshot.workArea.areas.length ? (
                <ul className="ar-list">
                  {snapshot.workArea.areas.map((area, index) => (
                    <li
                      className="ar-list-row"
                      key={`${area.neighborhoodId ?? area.districtId ?? area.cityId}-${index}`}
                    >
                      {(lang === 'ar' ? area.labelAr : area.labelEn) ||
                        area.labelEn ||
                        area.labelAr ||
                        `${t.order} ${index + 1}`}
                    </li>
                  ))}
                </ul>
              ) : (
                t.notProvided
              )
            ) : (
              empty
            )}
          </ReviewField>
          {snapshot?.workArea.lat != null && snapshot.workArea.lng != null && (
            <ReviewField label={lang === 'ar' ? 'إحداثيات نطاق العمل' : 'Work area coordinates'}>
              <span dir="ltr">
                {snapshot.workArea.lat}, {snapshot.workArea.lng}
              </span>
            </ReviewField>
          )}
          {snapshot?.workArea.workshopLat != null && snapshot.workArea.workshopLng != null && (
            <ReviewField label={lang === 'ar' ? 'إحداثيات الورشة' : 'Workshop coordinates'}>
              <span dir="ltr">
                {snapshot.workArea.workshopLat}, {snapshot.workArea.workshopLng}
              </span>
            </ReviewField>
          )}
        </dl>,
      )}
      {section(
        'WORKING_HOURS',
        4,
        <div className="ar-stack">
          <dl className="ar-fields">
            <ReviewField label={t.timezone}>{text(snapshot?.availability.timezone)}</ReviewField>
          </dl>
          {snapshot ? (
            <ul className="ar-list" aria-label={t.hours}>
              {Array.from({ length: 7 }, (_, day) => {
                const intervals = snapshot.availability.intervals.filter(
                  (interval) => interval.dayOfWeek === day,
                );
                const weekday = new Intl.DateTimeFormat(lang, {
                  weekday: 'long',
                  timeZone: 'UTC',
                }).format(new Date(Date.UTC(2026, 0, 4 + day)));
                return (
                  <li key={day} className="ar-list-row">
                    <strong>{weekday}</strong>
                    <div>
                      {intervals.length ? (
                        intervals.map((interval, index) => (
                          <div key={index}>
                            <span dir="ltr">
                              {minuteLabel(interval.startMinute, lang)} –{' '}
                              {minuteLabel(interval.endMinute, lang)}
                            </span>
                            {interval.timezone !== snapshot.availability.timezone && (
                              <small className="ar-muted"> {interval.timezone}</small>
                            )}
                          </div>
                        ))
                      ) : (
                        <span className="ar-muted">{t.closed}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="ar-muted">{empty}</p>
          )}
        </div>,
      )}
      {section(
        'PORTFOLIO',
        5,
        <div className="ar-stack">
          <dl className="ar-fields">
            <ReviewField label={t.headline} wide>
              {text(p?.headline)}
            </ReviewField>
            <ReviewField label={t.bio} wide>
              {text(p?.bio)}
            </ReviewField>
            <ReviewField label={t.additional} wide>
              {text(p?.additionalInformation)}
            </ReviewField>
          </dl>
          <div>
            <h3 className="ar-subheading">
              {submittedSource ? t.snapshotItems : t.galleryCurrent}
            </h3>
            <p className="ar-muted">{submittedSource ? t.galleryHistoric : t.currentHint}</p>
            {snapshot ? (
              snapshot.portfolio.length ? (
                <ul className="ar-list">
                  {snapshot.portfolio.map((item, index) => (
                    <li className="ar-list-row" key={item.id}>
                      <div>
                        <strong>{item.title || `${t.order} ${index + 1}`}</strong>
                        <p>{item.description}</p>
                        <p className="ar-muted">{serviceName(item.serviceCategoryId)}</p>
                        <small className="ar-muted">
                          {t.publicationAck}: {date(item.publicationRightAckAt)}
                          {item.publicationRightAckVersion
                            ? ` · ${item.publicationRightAckVersion}`
                            : ''}
                        </small>
                      </div>
                      <StatusBadge value={item.moderationState} lang={lang} />
                    </li>
                  ))}
                </ul>
              ) : (
                <ReviewBanner>{t.galleryEmpty}</ReviewBanner>
              )
            ) : (
              <p className="ar-muted">{empty}</p>
            )}
          </div>
          {portfolio}
        </div>,
      )}
      {section(
        'REVIEW_SUBMISSION',
        6,
        <div className="ar-stack">
          <dl className="ar-fields">
            <ReviewField label={t.submittedAt}>{date(review.submission?.submittedAt)}</ReviewField>
            <ReviewField label={t.capturedAt}>{date(snapshot?.capturedAt)}</ReviewField>
            <ReviewField label={t.policyVersion}>
              {text(review.submission?.policyVersion)}
            </ReviewField>
            <ReviewField label={t.applicationDecision}>
              <StatusBadge value={review.submission?.decision} lang={lang} />
            </ReviewField>
            <ReviewField label={t.consentVersion}>
              {text(snapshot?.consent.acceptedVersion)}
            </ReviewField>
            <ReviewField label={t.consentAt}>{date(snapshot?.consent.acceptedAt)}</ReviewField>
          </dl>
          <ReviewHistory providerId={review.provider.id} lang={lang} />
          {!!review.submission?.feedback?.items.length && (
            <div>
              <h3 className="ar-subheading">{t.previousCorrections}</h3>
              <ul className="ar-list">
                {review.submission.feedback.items.map((item) => (
                  <li key={item.id} className="ar-list-row">
                    <div>
                      <strong>{TASK_LABELS[lang][item.taskId]}</strong>
                      {item.field && <p>{reviewCorrectionFieldLabel(item.field, lang)}</p>}
                      <p>{item.providerMessage}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>,
      )}
    </div>
  );
}
