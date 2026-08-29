// Sprint 9B.25 — the autosave status strings, in ONE place.
//
// docs/sprint-09b25/HARDENING.md
//
// WHY THIS FILE EXISTS
//
// Three V2 task screens each declared their own copy of these six strings and
// their own near-identical renderer, and two screens declared neither — so
// ServiceArea and Services autosaved with no status at all. A provider editing
// those two screens saw nothing when a save was in flight, nothing when it
// failed, and nothing when another tab won a conflict. Their work looked saved
// because nothing said otherwise.
//
// Six strings copied three times is three chances for the offline sentence to
// drift from the conflict sentence; five screens sharing one is none.

export type Lang = 'en' | 'ar';

export interface AutosaveCopy {
  /** In flight. */
  saving: string;
  /** Written and acknowledged by the server. Never shown optimistically. */
  saved: string;
  /** Held locally, in memory, until the connection returns. */
  offline: string;
  /** Another tab wrote first. The edit was dropped, not queued. */
  conflict: string;
  failed: string;
  retry: string;
}

const EN: AutosaveCopy = {
  saving: 'Saving…',
  saved: 'Saved',
  // Deliberately "when you are back online", not "your changes are safe".
  //
  // The pending edit lives in memory, so it survives a lost connection but NOT
  // a reload or a crashed tab. Promising durability we do not have is the
  // false-saved-state this sprint exists to remove; the honest sentence tells
  // them to stay on the page.
  offline: 'Offline — this will save when you are back online. Keep this page open.',
  conflict: 'This was changed somewhere else. Reload to see the current version.',
  failed: 'Could not save.',
  retry: 'Try again',
};

const AR: AutosaveCopy = {
  saving: 'جارٍ الحفظ…',
  saved: 'تم الحفظ',
  offline: 'غير متصل — سيتم الحفظ عند عودة الاتصال. أبقِ هذه الصفحة مفتوحة.',
  conflict: 'تم تغيير هذا في مكان آخر. أعد التحميل لعرض النسخة الحالية.',
  failed: 'تعذّر الحفظ.',
  retry: 'حاول مرة أخرى',
};

export const AUTOSAVE_COPY: Record<Lang, AutosaveCopy> = { en: EN, ar: AR };
