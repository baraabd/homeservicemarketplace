// Sprint 9B.28 — what a blocked exit says.
//
// docs/sprint-09b28/PROVIDER_ONBOARDING_PERSISTENCE_MOBILE_FIRST.md
//
// Every sentence here is shown INSTEAD of a navigation the provider asked for,
// so each one has to answer "why am I still on this screen?" and "what do I
// do?". A generic "something went wrong" fails both, and a silent navigation —
// which is what shipped — fails the provider worse.
//
// Key parity across `en` and `ar` is asserted by copy-parity.test.ts.

export type Lang = 'en' | 'ar';

export interface ExitCopy {
  /** Shown on the exit control itself while the flush runs. */
  leaving: string;
  /** Heading of the blocked-exit notice. */
  blockedTitle: string;
  /** Body for a retryable server/network failure. */
  blockedError: string;
  /** Body for a failure the browser attributes to being offline. */
  blockedOffline: string;
  /** Body for a 409 — someone else advanced the draft. */
  blockedConflict: string;
  /** Body for "the draft never loaded", which retrying rarely fixes but
   *  reloading does. */
  blockedNotLoaded: string;
  retry: string;
  /** For a conflict: go and read what the other tab wrote before deciding. */
  reload: string;
  /** Abandon the exit and carry on editing. */
  stay: string;
  /** Body for a binary upload that failed. Retrying belongs to the uploader,
   *  which still has the file; the exit can only offer to go on without it. */
  blockedUpload: string;
  /** Leave WITHOUT the photo that failed. Explicit, and named for what it
   *  costs — "Leave" alone would not say the photo is the thing being given
   *  up. */
  discardUpload: string;
}

const EN: ExitCopy = {
  leaving: 'Saving…',
  blockedTitle: 'Your changes are not saved yet',
  // Deliberately says the work is HELD. It is — it is still in the
  // coordinator's queue — and the provider's next decision depends on
  // believing it.
  blockedError:
    'We could not save your last change, so we kept you on this page. Your work is still here.',
  blockedOffline:
    'You appear to be offline. Your work is still here and will save when the connection returns — keep this page open.',
  blockedConflict:
    'This application was changed somewhere else — another tab or another device. Reload to see the current version before you continue.',
  blockedNotLoaded:
    'We have not finished loading your application, so we could not save. Reload the page and try again.',
  retry: 'Try again',
  reload: 'Reload and review',
  stay: 'Keep editing',
  blockedUpload:
    'Your photo did not finish uploading, so we kept you on this page. Try the upload again, or leave without it.',
  discardUpload: 'Leave without the photo',
};

const AR: ExitCopy = {
  leaving: 'جارٍ الحفظ…',
  blockedTitle: 'لم يتم حفظ تغييراتك بعد',
  blockedError: 'تعذّر حفظ آخر تغيير، لذلك أبقيناك في هذه الصفحة. عملك ما زال موجوداً.',
  blockedOffline:
    'يبدو أنك غير متصل. عملك ما زال موجوداً وسيتم حفظه عند عودة الاتصال — أبقِ هذه الصفحة مفتوحة.',
  blockedConflict:
    'تم تغيير هذا الطلب في مكان آخر — تبويب آخر أو جهاز آخر. أعد التحميل لعرض النسخة الحالية قبل المتابعة.',
  blockedNotLoaded: 'لم ننتهِ من تحميل طلبك، لذلك تعذّر الحفظ. أعد تحميل الصفحة وحاول مرة أخرى.',
  retry: 'حاول مرة أخرى',
  reload: 'أعد التحميل والمراجعة',
  stay: 'متابعة التحرير',
  blockedUpload: 'لم يكتمل رفع صورتك، لذلك أبقيناك في هذه الصفحة. أعد المحاولة، أو غادر بدونها.',
  discardUpload: 'المغادرة بدون الصورة',
};

export const EXIT_COPY: Record<Lang, ExitCopy> = { en: EN, ar: AR };
