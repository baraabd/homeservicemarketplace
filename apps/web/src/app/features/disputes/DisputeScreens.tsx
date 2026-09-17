import { useEffect, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight, Plus, RefreshCw } from 'lucide-react';
import { useLang } from '../../i18n/LanguageContext';
import { useCaseBookings, useCaseDetail, useCaseList, useIntakeContext, caseErrorStatus } from './api';
import { DISPUTE_COPY } from './copy';
import { CaseBadge, CaseDate, CaseEmpty, CaseNotice } from '../case-ui/CasePrimitives';
import { IntakeForm } from './IntakeForm';

function Failure({ error, retry }: { error: unknown; retry: () => void }) {
  const { lang } = useLang(); const t = DISPUTE_COPY[lang];
  return <CaseNotice alert>{[401, 403, 404].includes(caseErrorStatus(error) ?? 0) ? t.denied : t.failed}<div><button className="case-button" type="button" onClick={retry}>{t.retry}</button></div></CaseNotice>;
}
function Heading({ children }: { children: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  return <h1 ref={ref} tabIndex={-1}>{children}</h1>;
}
export function CaseListScreen() {
  const { lang } = useLang(); const t = DISPUTE_COPY[lang]; const query = useCaseList();
  const items = query.isError ? [] : query.data?.pages.flatMap((page) => page.items) ?? [];
  return <div className="case-stack"><div className="case-summary"><div><Heading>{t.title}</Heading><p className="case-muted">{t.introduction}</p></div><Link className="case-button case-button-primary" to="/disputes/new"><Plus size={18} aria-hidden="true" />{t.newCase}</Link></div>
    {query.isPending ? <CaseNotice>{t.loading}</CaseNotice> : query.isError ? <Failure error={query.error} retry={() => void query.refetch()} /> : items.length === 0 ? <CaseEmpty title={t.listEmpty}>{t.listEmptyHint}</CaseEmpty> : <ul className="case-list">{items.map((item) => <li className="case-card case-summary" key={item.id}><div className="case-stack"><CaseBadge>{t.states[item.state]}</CaseBadge><p>{item.openedByYou ? t.openedByYou : t.involvesYou}</p><span className="case-reference"><bdi dir="ltr">{item.reference}</bdi></span><p className="case-muted"><CaseDate value={item.submittedAt} lang={lang} /></p></div><Link className="case-button" to={`/disputes/${encodeURIComponent(item.id)}`}>{t.open}</Link></li>)}</ul>}
    {query.hasNextPage && !query.isError && <button className="case-button" type="button" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{t.more}</button>}
  </div>;
}
export function BookingPickerScreen() {
  const { lang } = useLang(); const t = DISPUTE_COPY[lang]; const query = useCaseBookings();
  const items = query.isError ? [] : query.data?.pages.flatMap((page) => page.items) ?? [];
  return <div className="case-stack"><Heading>{t.bookingTitle}</Heading><p className="case-muted">{t.bookingHint}</p>
    {query.isPending ? <CaseNotice>{t.loading}</CaseNotice> : query.isError ? <Failure error={query.error} retry={() => void query.refetch()} /> : items.length === 0 ? <CaseEmpty title={t.bookingEmpty}>{t.bookingEmptyHint}</CaseEmpty> : <ul className="case-list">{items.map((item) => <li className="case-card case-summary" key={item.id}><div><h2>{(lang === 'ar' ? item.serviceLabelAr : item.serviceLabelEn) || t.service}</h2><p className="case-muted">{item.role === 'SEEKER' ? t.seeker : t.provider}</p><p><CaseDate value={item.scheduledAt ?? item.createdAt} lang={lang} /></p><span className="case-reference">{t.booking}: <bdi dir="ltr">{item.id}</bdi></span></div><Link className="case-button" to={`/disputes/new?bookingId=${encodeURIComponent(item.id)}`}>{t.choose}</Link></li>)}</ul>}
    {query.hasNextPage && !query.isError && <button className="case-button" type="button" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{t.more}</button>}
  </div>;
}
export function NewCaseScreen() {
  const [params] = useSearchParams(); const bookingId = params.get('bookingId');
  return bookingId ? <IntakeScreen key={bookingId} bookingId={bookingId} /> : <BookingPickerScreen />;
}
function IntakeScreen({ bookingId }: { bookingId: string }) {
  const { lang } = useLang(); const t = DISPUTE_COPY[lang]; const query = useIntakeContext(bookingId);
  const denied = query.isError && [401, 403, 404].includes(caseErrorStatus(query.error) ?? 0);
  // Preserve an already-entered form on transient refresh failure, but pause submission.
  const data = denied ? undefined : query.data;
  return <div className="case-stack"><Heading>{t.newCase}</Heading>
    {query.isPending && <CaseNotice>{t.loading}</CaseNotice>}
    {query.isError && <Failure error={query.error} retry={() => void query.refetch()} />}
    {data && <div className="case-layout"><IntakeForm context={data} lang={lang} readOnly={query.isError || query.isFetching} refresh={() => void query.refetch()} /><aside className="case-card case-stack"><h2>{(lang === 'ar' ? data.booking.serviceLabelAr : data.booking.serviceLabelEn) || t.service}</h2><p className="case-muted">{data.role === 'SEEKER' ? t.seeker : t.provider}</p><span className="case-reference">{t.booking}: <bdi dir="ltr">{data.booking.id}</bdi></span>{data.openingDeadline && <p>{lang === 'ar' ? 'آخر موعد للإرسال' : 'Submit before'}: <CaseDate value={data.openingDeadline} lang={lang} /></p>}{data.existingCaseId && <Link className="case-button" to={`/disputes/${encodeURIComponent(data.existingCaseId)}`}>{t.open}</Link>}<p className="case-muted">{t.outcomeHint}</p></aside></div>}
  </div>;
}
export function CaseDetailScreen() {
  const { caseId = '' } = useParams(); const { lang } = useLang(); const t = DISPUTE_COPY[lang]; const query = useCaseDetail(caseId);
  // Never expose stale participant details after a denied or failed re-read.
  const data = query.isError ? undefined : query.data;
  return <div className="case-stack"><div className="case-summary"><Heading>{t.open}</Heading><button type="button" className="case-button" aria-label={t.refresh} disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={18} aria-hidden="true" />{t.refresh}</button></div>
    {query.isPending && <CaseNotice>{t.loading}</CaseNotice>}{query.isError && <Failure error={query.error} retry={() => void query.refetch()} />}
    {data && <><header className="case-card case-stack"><CaseBadge>{t.states[data.state]}</CaseBadge><div><h2>{t.reference}</h2><span className="case-reference"><bdi dir="ltr">{data.reference}</bdi></span></div><p className="case-muted">{data.role === 'SEEKER' ? t.seeker : t.provider} · {t.submitted}: <CaseDate value={data.submittedAt} lang={lang} /></p></header><div className="case-layout"><div className="case-stack"><section className="case-card case-stack"><h2>{t.issueTitle}</h2>{data.issueCode && <p>{t.issues[data.issueCode]}</p>}<h3>{t.description}</h3><p className="case-statement">{data.statement ?? t.noNarrative}</p>{data.requestedOutcome && <><h3>{t.outcome}</h3><p>{t.outcomes[data.requestedOutcome]}</p><p className="case-muted">{t.outcomeHint}</p></>}</section><section className="case-card case-stack"><h2>{t.timeline}</h2><ol className="case-timeline">{data.events.map((event) => <li key={event.id}><strong>{event.kind === 'SUBMITTED' ? t.submitted : event.kind === 'DECISION_RECORDED' ? t.decisionRecorded : t.statusUpdated}</strong><CaseDate value={event.occurredAt} lang={lang} /></li>)}</ol>{data.eventsTruncated && <p className="case-muted">{t.historyLimit}</p>}</section></div><aside className="case-card case-stack"><h2>{t.nextAction}</h2><p>{data.nextAction === 'WAIT_FOR_REVIEW' ? t.wait : t.contact}</p>{data.nextAction === 'CONTACT_SUPPORT' && <CaseNotice>{t.noPayment}</CaseNotice>}<p className="case-muted">{t.privacy}</p></aside></div></>}
  </div>;
}
export function CaseBackLink() {
  const { lang, dir } = useLang(); const Icon = dir === 'rtl' ? ArrowRight : ArrowLeft;
  return <Link className="case-button" to="/disputes"><Icon size={18} aria-hidden="true" />{DISPUTE_COPY[lang].back}</Link>;
}
