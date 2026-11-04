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
  readStripePurchaseIntent,
  resumeStripePurchase,
  rotateStripePurchaseKeys,
  startStripePurchase,
  stripePurchaseKeys,
  stripePurchaseResolution,
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
    closed: 'The server closed this purchase without confirming a payment.',
    unresolved:
      'The payment result is not recorded yet. Check again later. A new purchase is offered only after the server records this result.',
    again: 'Start a new purchase',
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
    closed: 'أغلق الخادم عملية الشراء هذه دون تأكيد أي دفع.',
    unresolved:
      'لم تُسجَّل نتيجة الدفع بعد. تحقّق مرة أخرى لاحقًا. لن تُتاح عملية شراء جديدة إلا بعد أن يسجّل الخادم هذه النتيجة.',
    again: 'بدء عملية شراء جديدة',
    failed: 'الدفع غير متاح أو تعذر الطلب. أعد المحاولة للتحقق من عملية الشراء نفسها.',
    units: 'وحدة صغرى',
    loading: 'جارٍ تحميل الدفع…',
    amount: 'مبلغ الدفع الدقيق',
    cancel: 'إغلاق',
    sandbox: 'دفع اختباري. شراء الخطة لا يمنح توثيق الهوية أو صلاحية العمل.',
  },
} as const;

// Match My Plan: theme changes must update foreground and background together
// instead of animating through low-contrast intermediate colors.
const controlClass = 'min-h-11 whitespace-normal transition-none';

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
  const [keys, setKeys] = useState(() => stripePurchaseKeys(userId, plan.id));
  const inFlight = useRef(false);
  const active = useRef(true);
  const [intent, setIntent] = useState<PaymentIntentWireV1>();
  const [attempt, setAttempt] = useState<string>();
  const [session, setSession] = useState<MoneyStripeSessionV1>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
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
    setUnresolved(false);
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
  /** Fresh owner read; an idempotent create replays only its stored snapshot. */
  async function reconcile(id: string) {
    const value = await readStripePurchaseIntent(id);
    if (active.current) setIntent(value);
    return value;
  }
  /** After a failed step, show a server-settled outcome instead of a retry trap. */
  async function settleAfter(error: unknown, id: string) {
    const value = await reconcile(id);
    if (stripePurchaseResolution(value.status) === 'OPEN') throw error;
  }
  const resolution =
    session?.state === 'CONFIRMED'
      ? 'CONFIRMED'
      : intent
        ? stripePurchaseResolution(intent.status)
        : 'OPEN';
  function startNewPurchase() {
    // Only a server-settled outcome releases the identities; pending or
    // unknown purchases keep retrying the original intent and attempt.
    if (inFlight.current || resolution === 'OPEN') return;
    setKeys(rotateStripePurchaseKeys(userId, plan.id, keys));
    setIntent(undefined);
    setAttempt(undefined);
    setSession(undefined);
    setReady(false);
    setFailed(false);
    setUnresolved(false);
  }
  return (
    <section className="mt-4 min-w-0 space-y-3" aria-label={text.review} aria-busy={busy}>
      <p className="text-sm text-muted-foreground">{text.sandbox}</p>
      {!intent && (
        <Button
          type="button"
          variant="outline"
          className={controlClass}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const created = await createStripePurchase(plan.id, keys.intent);
              await reconcile(created.id);
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
          {!attempt && resolution === 'OPEN' && (
            <Button
              type="button"
              className={controlClass}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  let value;
                  try {
                    value = await startStripePurchase(intent.id, keys.attempt);
                  } catch (error) {
                    await settleAfter(error, intent.id);
                    return;
                  }
                  if (!active.current) return;
                  setAttempt(value.resourceId);
                  try {
                    await loadSession(value.resourceId);
                  } catch (error) {
                    await settleAfter(error, intent.id);
                  }
                })
              }
            >
              {text.confirm}
            </Button>
          )}
        </div>
      )}
      {attempt && resolution === 'OPEN' && (
        <>
          <div ref={target} />
          {session?.state === 'AWAITING_PAYMENT' && (
            <Button
              type="button"
              className={controlClass}
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
          <Button
            type="button"
            variant="outline"
            className={controlClass}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                try {
                  const current = await loadSession(attempt);
                  if (current.state === 'PROCESSING') {
                    await resumeStripePurchase(attempt, keys.resume);
                    await loadSession(attempt);
                  }
                  return;
                } catch (error) {
                  if (!intent) throw error;
                  const value = await reconcile(intent.id);
                  if (stripePurchaseResolution(value.status) !== 'OPEN') return;
                  if (value.status !== 'PROCESSING') throw error;
                  // The quote time may have passed while the external outcome is
                  // still unknown. Recover the same attempt with the same identity;
                  // an elapsed timer never proves that nothing was charged.
                  await resumeStripePurchase(attempt, keys.resume);
                  const after = await reconcile(intent.id);
                  if (stripePurchaseResolution(after.status) === 'OPEN' && active.current)
                    setUnresolved(true);
                }
              })
            }
          >
            {text.check}
          </Button>
        </>
      )}
      {resolution !== 'OPEN' && (
        <>
          <p role="status">{resolution === 'CONFIRMED' ? text.confirmed : text.closed}</p>
          <Button
            type="button"
            variant="outline"
            className={controlClass}
            disabled={busy}
            onClick={startNewPurchase}
          >
            {text.again}
          </Button>
        </>
      )}
      {unresolved && <p role="status">{text.unresolved}</p>}
      {busy && <p role="status">{text.loading}</p>}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {text.failed}
        </p>
      )}
    </section>
  );
}
