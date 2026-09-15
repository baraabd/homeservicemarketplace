// Sprint 9B.25 — the autosave status strings, in ONE place.
// Sprint 9B.28 — `dirty` and `savedProjectionStale` added.
//
// docs/sprint-09b28/PROVIDER_ONBOARDING_PERSISTENCE_MOBILE_FIRST.md
//
// WHY THIS FILE EXISTS
//
// Three V2 task screens each declared their own copy of these strings and
// their own near-identical renderer, and two screens declared neither — so
// ServiceArea and Services autosaved with no status at all. A provider editing
// those two screens saw nothing when a save was in flight, nothing when it
// failed, and nothing when another tab won a conflict. Their work looked saved
// because nothing said otherwise.
//
// Strings copied three times are three chances for the offline sentence to
// drift from the conflict sentence; five screens sharing one is none. Key
// parity across `en` and `ar` is asserted by copy-parity.test.ts.

export type Lang = 'en' | 'ar';

export interface AutosaveCopy {
  /** Changed locally and not yet sent.
   *
   *  Sprint 9B.28 — the state the machine did not have, and the reason a
   *  "Saved" chip outlived the edit that invalidated it. Deliberately NOT
   *  "Unsaved changes": the provider has done nothing wrong, nothing is at
   *  risk, and the save is already scheduled. */
  dirty: string;
  /** In flight. */
  saving: string;
  /** Written and acknowledged by the server. Never shown optimistically. */
  saved: string;
  /**
   * What the SERVER says was last persisted, shown on arrival.
   *
   * Sprint 09B.29 Phase 5A. The approved sticky bar answers "is my work safe"
   * before the provider has touched anything, and it can do so truthfully
   * because the draft carries `lastSavedAt` — a fact the server wrote, not an
   * optimistic claim by the client. Without it the bar was empty until the
   * first keystroke, which is exactly when the question is least urgent.
   */
  persisted: string;
  /** The write landed; the hub/review projection refresh that follows it did
   *  not. The data is safe — reporting a failure here would be untrue — but
   *  task statuses elsewhere may lag for a moment. */
  savedProjectionStale: string;
  /** Held locally, in memory, until the connection returns. */
  offline: string;
  /** Another tab wrote first. The edit was dropped, not queued. */
  conflict: string;
  failed: string;
  retry: string;
}

const EN: AutosaveCopy = {
  dirty: 'Not saved yet',
  saving: 'Saving…',
  saved: 'Saved',
  persisted: 'Changes saved',
  savedProjectionStale: 'Saved — refreshing status',
  // Deliberately "when you are back online", not "your changes are safe".
  //
  // The pending edit lives in memory, so it survives a lost connection but NOT
  // a reload or a crashed tab. Promising durability we do not have is the
  // false-saved-state this work exists to remove; the honest sentence tells
  // them to stay on the page.
  offline: 'Offline — this will save when you are back online. Keep this page open.',
  conflict: 'This was changed somewhere else. Reload to see the current version.',
  failed: 'Could not save.',
  retry: 'Try again',
};

const AR: AutosaveCopy = {
  dirty: 'لم يتم الحفظ بعد',
  saving: 'جارٍ الحفظ…',
  saved: 'تم الحفظ',
  persisted: 'حُفظت التغييرات',
  savedProjectionStale: 'تم الحفظ — يتم تحديث الحالة',
  offline: 'غير متصل — سيتم الحفظ عند عودة الاتصال. أبقِ هذه الصفحة مفتوحة.',
  conflict: 'تم تغيير هذا في مكان آخر. أعد التحميل لعرض النسخة الحالية.',
  failed: 'تعذّر الحفظ.',
  retry: 'حاول مرة أخرى',
};

export const AUTOSAVE_COPY: Record<Lang, AutosaveCopy> = { en: EN, ar: AR };
