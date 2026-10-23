import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import type {
  MoneyMyPlanWireV1,
  MoneyPlanVersionWireV1,
  SubscriptionPeriodWireV1,
} from '@homeservicemarketplace/contracts';
import { useAuth } from '../../../lib/auth-provider';
import { useLang } from '../../i18n/LanguageContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import {
  getMyPlan,
  getPlanCatalog,
  getSubscriptionPage,
  subscriptionErrorStatus,
  subscriptionQueryKeys,
} from './subscriptions.api';
import { SUBSCRIPTION_COPY } from './subscriptions.copy';

type Language = 'ar' | 'en';
type Copy = (typeof SUBSCRIPTION_COPY)[Language];
// Theme changes must update text and backgrounds together to preserve contrast.
const controlClass =
  'min-h-11 whitespace-normal rounded-xl px-4 text-sm transition-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2';

function DateLabel({ value, lang }: { value: string; lang: Language }) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <span>—</span>;
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(lang, { dateStyle: 'medium', calendar: 'gregory' }).format(date)}
    </time>
  );
}

function Period({
  period,
  lang,
  copy,
}: {
  period: SubscriptionPeriodWireV1;
  lang: Language;
  copy: Copy;
}) {
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">{copy.starts}</dt>
        <dd>
          <DateLabel value={period.startsAt} lang={lang} />
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{copy.ends}</dt>
        <dd>
          <DateLabel value={period.endsAt} lang={lang} />
        </dd>
      </div>
    </dl>
  );
}

function PlanVersion({ plan, copy }: { plan: MoneyPlanVersionWireV1; copy: Copy }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="font-semibold break-words">
        <bdi>{plan.planKey}</bdi>
      </p>
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="outline" className="transition-none">
          {copy.version} {plan.version}
        </Badge>
        <span>{copy.intervals[plan.billingInterval]}</span>
      </div>
      {/* The frozen contract has no approved currency scale. Never assume /100,
          round BIGINT strings, or turn an unavailable quote into a sales price. */}
      <p className="text-sm text-muted-foreground">{copy.priceUnavailable}</p>
    </div>
  );
}

function PlanDetails({
  data,
  lang,
  copy,
}: {
  data: MoneyMyPlanWireV1;
  lang: Language;
  copy: Copy;
}) {
  const number = (value: number) => new Intl.NumberFormat(lang).format(value);
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{copy.current}</h2>
            <Badge
              data-testid="my-plan-status"
              variant={data.status === 'ACTIVE' ? 'default' : 'secondary'}
              className="max-w-full whitespace-normal text-start transition-none"
            >
              {copy.states[data.status]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {data.subscription ? (
            <>
              <PlanVersion plan={data.subscription.plan} copy={copy} />
              <p className="text-sm text-muted-foreground">{copy.immutable}</p>
              {data.subscription.currentPeriod && (
                <section aria-label={copy.currentPeriod} className="space-y-2">
                  <h3 className="font-medium">{copy.currentPeriod}</h3>
                  <Period period={data.subscription.currentPeriod} lang={lang} copy={copy} />
                </section>
              )}
              {data.subscription.nextPeriod && (
                <section aria-label={copy.nextPeriod} className="space-y-2">
                  <h3 className="font-medium">{copy.nextPeriod}</h3>
                  <Period period={data.subscription.nextPeriod} lang={lang} copy={copy} />
                </section>
              )}
            </>
          ) : (
            <div>
              <h3 className="font-medium">{copy.noPlan}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{copy.noPlanHint}</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {copy.updated}: <DateLabel value={data.asOf} lang={lang} />
          </p>
        </CardContent>
      </Card>

      {data.payment && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">{copy.payment}</h2>
          </CardHeader>
          <CardContent className="space-y-2">
            <Badge
              data-testid="my-plan-payment-status"
              variant="outline"
              className="whitespace-normal transition-none"
            >
              {copy.payments[data.payment.status]}
            </Badge>
            {data.payment.latestAttemptStatus === 'FAILED' && (
              <p
                role="status"
                className="text-sm font-medium"
                data-testid="my-plan-payment-attempt"
              >
                {copy.attemptFailed}
              </p>
            )}
            <p className="text-sm text-muted-foreground">{copy.paymentPending}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">{copy.usage}</h2>
        </CardHeader>
        <CardContent>
          {data.entitlements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{copy.usageEmpty}</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.entitlements.map((item) => (
                <li key={item.key} className="min-w-0 space-y-2 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium break-all">
                      <bdi>{item.key}</bdi>
                    </h3>
                    <Badge variant="outline" className="whitespace-normal transition-none">
                      {item.allowed ? copy.included : copy.unavailable}
                    </Badge>
                  </div>
                  <p className="text-sm">
                    {copy.used}:{' '}
                    <bdi dir="ltr">
                      {number(item.used)}
                      {item.limit !== null && <> / {number(item.limit)}</>}
                    </bdi>
                  </p>
                  {(item.remaining !== null || item.allowed) && (
                    <p className="text-sm text-muted-foreground">
                      {item.remaining === null
                        ? copy.noNumericLimit
                        : `${copy.remaining}: ${number(item.remaining)}`}
                    </p>
                  )}
                  {item.reason && (
                    <p className="text-sm text-muted-foreground">{copy.reasons[item.reason]}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">{copy.history}</h2>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{copy.historyEmpty}</p>
          ) : (
            <ol className="divide-y divide-border">
              {data.history.map((period) => (
                <li key={period.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium">{copy.intervals[period.billingInterval]}</p>
                  <Period period={period} lang={lang} copy={copy} />
                </li>
              ))}
            </ol>
          )}
          {data.historyHasMore && (
            <p className="text-sm text-muted-foreground">{copy.historyMore}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">{copy.operations}</h2>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{copy.operationsHint}</p>
        </CardContent>
      </Card>
    </>
  );
}

/** A projection of server state. URL parameters, redirects and client clocks
 * cannot grant access; every mount, selection and reconnect reads the API. */
export function MyPlanScreen() {
  const { user } = useAuth();
  const { lang, dir, toggleLang, darkMode, toggleDarkMode } = useLang();
  const copy = SUBSCRIPTION_COPY[lang];
  const [search, setSearch] = useSearchParams();
  const subscriptionId = search.get('subscriptionId') || undefined;
  const userId = user?.id ?? 'signed-out';
  const [offline, setOffline] = useState(() => !navigator.onLine);
  useEffect(() => {
    const online = () => setOffline(false);
    const disconnected = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', disconnected);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', disconnected);
    };
  }, []);
  const enabled = Boolean(user);
  const plan = useQuery({
    queryKey: subscriptionQueryKeys.myPlan(userId, subscriptionId),
    queryFn: ({ signal }) => getMyPlan(subscriptionId, signal),
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    refetchInterval: 30_000,
  });
  const purchases = useInfiniteQuery({
    queryKey: subscriptionQueryKeys.purchases(userId),
    queryFn: ({ pageParam, signal }) => getSubscriptionPage(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
  });
  const catalog = useInfiniteQuery({
    queryKey: subscriptionQueryKeys.plans(userId),
    queryFn: ({ pageParam, signal }) => getPlanCatalog(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
  });
  const denied =
    !user ||
    [plan.error, purchases.error, catalog.error].some((error) =>
      [401, 403, 404].includes(subscriptionErrorStatus(error) ?? 0),
    );
  const data = denied ? undefined : plan.data;
  const purchased = purchases.data?.pages.flatMap((page) => page.items) ?? [];
  const plans = catalog.data?.pages.flatMap((page) => page.items) ?? [];
  const refreshing = plan.isFetching || purchases.isFetching || catalog.isFetching;
  const refresh = () => {
    void Promise.all([plan.refetch(), purchases.refetch(), catalog.refetch()]);
  };

  return (
    <div
      className={`${darkMode ? 'dark ' : ''}min-h-screen bg-background text-foreground`}
      dir={dir}
      lang={lang}
    >
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
        <header className="mb-6 space-y-5">
          <nav
            aria-label={copy.title}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <Button asChild variant="ghost" className={controlClass}>
              <Link to="/provider/profile">
                <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
                {copy.back}
              </Link>
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className={controlClass}
                onClick={toggleLang}
                aria-label={copy.language}
              >
                {copy.languageLabel}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className={controlClass}
                onClick={toggleDarkMode}
                aria-pressed={darkMode}
              >
                {darkMode ? copy.light : copy.dark}
              </Button>
            </div>
          </nav>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold sm:text-3xl">{copy.title}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{copy.introduction}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className={controlClass}
              onClick={refresh}
              disabled={refreshing || offline || !user}
              data-testid="my-plan-refresh"
            >
              <RefreshCw aria-hidden="true" />
              {refreshing ? copy.refreshing : copy.refresh}
            </Button>
          </div>
        </header>
        <main className="space-y-5" aria-busy={refreshing}>
          <Alert role="note">
            <ShieldCheck aria-hidden="true" />
            <AlertDescription>{copy.authority}</AlertDescription>
          </Alert>
          {offline && (
            <Alert role="status">
              <WifiOff aria-hidden="true" />
              <AlertDescription>{copy.offline}</AlertDescription>
            </Alert>
          )}
          {denied ? (
            <Alert variant="destructive">
              <AlertDescription>{copy.denied}</AlertDescription>
            </Alert>
          ) : (
            <>
              {plan.isPending && !offline && <p role="status">{copy.loading}</p>}
              {plan.isError && (
                <Alert variant="destructive">
                  <AlertDescription>{data ? copy.stale : copy.failed}</AlertDescription>
                </Alert>
              )}
              {data && (
                <>
                  {purchased.length > 0 && (
                    <section aria-label={copy.purchased} className="space-y-2">
                      <label htmlFor="my-plan-purchase" className="block text-sm font-medium">
                        {copy.purchased}
                      </label>
                      <select
                        id="my-plan-purchase"
                        className="min-h-11 w-full max-w-full rounded-xl border border-input bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-2"
                        value={subscriptionId ?? ''}
                        onChange={(event) => {
                          const next = new URLSearchParams(search);
                          if (event.target.value) next.set('subscriptionId', event.target.value);
                          else next.delete('subscriptionId');
                          setSearch(next);
                        }}
                      >
                        <option value="">{copy.defaultPurchase}</option>
                        {subscriptionId &&
                          !purchased.some((item) => item.id === subscriptionId) && (
                            <option value={subscriptionId}>
                              {copy.purchaseReference}: {subscriptionId}
                            </option>
                          )}
                        {purchased.map((item) => (
                          <option key={item.id} value={item.id}>
                            {copy.purchaseReference}: {item.id} — {copy.states[item.status]}
                          </option>
                        ))}
                      </select>
                      {purchases.hasNextPage && (
                        <Button
                          type="button"
                          variant="outline"
                          className={controlClass}
                          disabled={purchases.isFetchingNextPage || offline}
                          onClick={() => {
                            void purchases.fetchNextPage();
                          }}
                        >
                          {copy.morePurchases}
                        </Button>
                      )}
                    </section>
                  )}
                  {purchases.isError && (
                    <p role="alert" className="text-sm text-destructive">
                      {copy.listFailed}
                    </p>
                  )}
                  <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2">
                    <PlanDetails data={data} lang={lang} copy={copy} />
                  </div>
                </>
              )}
              <Card>
                <CardHeader>
                  <h2 className="text-lg font-semibold">{copy.catalog}</h2>
                </CardHeader>
                <CardContent className="space-y-4">
                  {catalog.isPending && !offline && <p role="status">{copy.loading}</p>}
                  {catalog.isError && (
                    <p role="alert" className="text-sm text-destructive">
                      {copy.listFailed}
                    </p>
                  )}
                  {!catalog.isPending && !catalog.isError && plans.length === 0 && (
                    <p className="text-sm text-muted-foreground">{copy.catalogEmpty}</p>
                  )}
                  <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                    {plans.map((item) => (
                      <li key={item.id} className="min-w-0 rounded-xl border border-border p-4">
                        <PlanVersion plan={item} copy={copy} />
                      </li>
                    ))}
                  </ul>
                  {catalog.hasNextPage && (
                    <Button
                      type="button"
                      variant="outline"
                      className={controlClass}
                      disabled={catalog.isFetchingNextPage || offline}
                      onClick={() => {
                        void catalog.fetchNextPage();
                      }}
                    >
                      {copy.morePlans}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
