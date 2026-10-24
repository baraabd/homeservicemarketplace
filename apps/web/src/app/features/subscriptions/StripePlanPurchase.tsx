import { useEffect, useRef, useState } from 'react';
import type { Stripe, StripeElements } from '@stripe/stripe-js';
import type {
  MoneyPlanVersionWireV1,
  MoneyStripeSessionV1,
  PaymentIntentWireV1,
} from '@homeservicemarketplace/contracts';
import { Button } from '../../components/ui/button';
import {
  createStripePurchase,
  startStripePurchase,
  resumeStripePurchase,
  stripePurchaseKeys,
  stripePurchaseSession,
} from './stripe-purchase.api';

const copy = {
  en: {
    review: 'Review sandbox purchase',
    confirm: 'Continue with this amount',
    pay: 'Confirm sandbox payment',
    check: 'Check payment status',
    pending: 'Payment is pending confirmation. Refresh My Plan to check the recorded result.',
    confirmed: 'Payment is confirmed by the server. Refresh My Plan to view the subscription.',
    failed: 'Payment is unavailable or the request failed. Retry to check the same purchase.',
    units: 'minor units',
    loading: 'Loading payment…',
    amount: 'Exact payment amount',
    cancel: 'Close',
    sandbox:
      'Sandbox payment. Purchase does not grant identity verification or permission to work.',
  },
  ar: {
    review: 'مراجعة شراء اختباري',
    confirm: 'المتابعة بهذا المبلغ',
    pay: 'تأكيد الدفع الاختباري',
    check: 'التحقق من حالة الدفع',
    pending: 'الدفع بانتظار التأكيد. حدّث صفحة خطتي للتحقق من النتيجة المسجلة.',
    confirmed: 'أكد الخادم الدفع. حدّث صفحة خطتي لعرض الاشتراك.',
    failed: 'الدفع غير متاح أو تعذر الطلب. أعد المحاولة للتحقق من عملية الشراء نفسها.',
    units: 'وحدة صغرى',
    loading: 'جارٍ تحميل الدفع…',
    amount: 'مبلغ الدفع الدقيق',
    cancel: 'إغلاق',
    sandbox: 'دفع اختباري. شراء الخطة لا يمنح توثيق الهوية أو صلاحية العمل.',
  },
} as const;

/** No redirect, local status or Stripe browser result activates a subscription. */
export function StripePlanPurchase({
  plan,
  lang,
  userId,
}: {
  userId: string;
  plan: MoneyPlanVersionWireV1;
  lang: 'ar' | 'en';
}) {
  const text = copy[lang];
  const [keys] = useState(() => stripePurchaseKeys(userId, plan.id));
  const inFlight = useRef(false);
  const active = useRef(true);
  const [intent, setIntent] = useState<PaymentIntentWireV1>();
  const [attempt, setAttempt] = useState<string>();
  const [session, setSession] = useState<MoneyStripeSessionV1>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const target = useRef<HTMLDivElement>(null);
  const checkout = useRef<{ stripe: Stripe; elements: StripeElements }>();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!session?.clientSecret || !session.publishableKey) return;
    let disposed = false;
    let unmount: (() => void) | undefined;
    void import('@stripe/stripe-js/pure')
      .then(async ({ loadStripe }) => {
        const stripe = await loadStripe(session.publishableKey!);
        if (!stripe || disposed || !target.current) return;
        const elements = stripe.elements({ clientSecret: session.clientSecret!, locale: lang });
        const payment = elements.create('payment');
        payment.on('ready', () => {
          if (!disposed) setReady(true);
        });
        payment.on('loaderror', () => {
          if (!disposed) setFailed(true);
        });
        payment.mount(target.current);
        checkout.current = { stripe, elements };
        unmount = () => payment.destroy();
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      unmount?.();
      checkout.current = undefined;
    };
  }, [session, lang]);
  async function run(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await task();
    } catch {
      if (active.current) setFailed(true);
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function loadSession(id: string) {
    const value = await stripePurchaseSession(id);
    if (active.current) {
      setReady(false);
      setSession(value);
    }
    return value;
  }
  return (
    <section className="mt-4 min-w-0 space-y-3" aria-label={text.review} aria-busy={busy}>
      <p className="text-sm text-muted-foreground">{text.sandbox}</p>
      {!intent && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 whitespace-normal"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const value = await createStripePurchase(plan.id, keys.intent);
              if (active.current) setIntent(value);
            })
          }
        >
          {text.review}
        </Button>
      )}
      {intent && (
        <div role="group" aria-label={text.amount} className="space-y-3">
          <p className="text-sm break-words">
            <bdi>{plan.planKey}</bdi> · {plan.version}
          </p>
          <p className="font-medium">
            <bdi dir="ltr">
              {intent.total.amountMinor} {intent.total.currency}
            </bdi>{' '}
            {text.units}
          </p>
          {!attempt && (
            <Button
              type="button"
              className="min-h-11 whitespace-normal"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const value = await startStripePurchase(intent.id, keys.attempt);
                  if (!active.current) return;
                  setAttempt(value.resourceId);
                  await loadSession(value.resourceId);
                })
              }
            >
              {text.confirm}
            </Button>
          )}
        </div>
      )}
      {attempt && (
        <>
          <div ref={target} />
          {session?.state === 'AWAITING_PAYMENT' && (
            <Button
              type="button"
              className="min-h-11 whitespace-normal"
              disabled={busy || !ready}
              onClick={() =>
                void run(async () => {
                  const current = checkout.current;
                  if (!current) throw new Error('CHECKOUT_UNAVAILABLE');
                  const result = await current.stripe.confirmPayment({
                    elements: current.elements,
                    confirmParams: {
                      return_url: new URL('/provider/my-plan', window.location.origin).href,
                    },
                    redirect: 'if_required',
                  });
                  if (result.error) throw new Error('PAYMENT_NOT_CONFIRMED');
                  await loadSession(attempt);
                })
              }
            >
              {text.pay}
            </Button>
          )}
          {session?.state === 'PROCESSING' && <p role="status">{text.pending}</p>}
          {session?.state === 'CONFIRMED' && <p role="status">{text.confirmed}</p>}
          <Button
            type="button"
            variant="outline"
            className="min-h-11 whitespace-normal"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const current = await loadSession(attempt);
                if (current.state === 'PROCESSING') {
                  await resumeStripePurchase(attempt, keys.resume);
                  await loadSession(attempt);
                }
              })
            }
          >
            {text.check}
          </Button>
        </>
      )}
      {busy && <p role="status">{text.loading}</p>}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {text.failed}
        </p>
      )}
    </section>
  );
}
