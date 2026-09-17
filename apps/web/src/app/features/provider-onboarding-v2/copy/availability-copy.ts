// Sprint 9B.21 — every string V2 Task 4 renders.
//
// Two things this copy has to get right:
//
//   THE PRESET IS AN OFFER, NOT A DEFAULT. "Sunday–Thursday" selects days and
//   stops. Nothing is applied until the provider chooses hours and presses
//   apply. A preset that silently filled in a working week would be the
//   platform deciding when somebody works.
//
//   TIME ZONES ARE NOT SPOKEN ALOUD. `Asia/Damascus` is a database convention.
//   The screen says "Damascus time (UTC+3)" and only shows an identifier where
//   the country genuinely spans several zones and somebody has to choose.

export type Lang = 'en' | 'ar';

export interface AvailabilityCopy {
  heading: string;

  // ── Sprint 09B.29 Phase 5A — the approved working-hours screen ─────────
  kicker: string;
  question: string;
  /** Day initials, in the approved screen's own abbreviations. Moved here from
   *  the legacy wizard copy, which the V2 tree must not import. */
  dayAbbrev: readonly string[];
  /** The approved button carries no count. */
  applyToSelectedDays: string;
  /** The approved consent row. */
  unavailableLabel: string;

  // ── Sprint 09B.29 Phase 5B — G-04 ───────────────────────────────────────
  //
  // Apply expresses ONE window across the days it covers, which is what makes
  // it a bulk control. It used to discard everything that did not fit — a
  // second window, a day with different hours — without saying so, and write
  // the result straight through. These say so, and make the replacement the
  // provider's decision rather than a side effect of pressing Apply.
  /** Heading of the confirmation, e.g. "This will change 2 days". */
  discardTitle: (count: number) => string;
  /** One line per affected day: "Thursday: 09:00–13:00 becomes 09:00–17:00". */
  discardLine: (day: string, from: string, to: string) => string;
  /** A day holding hours the screen cannot show at all. */
  discardSecondWindow: (day: string) => string;
  discardConfirm: string;
  discardCancel: string;
  unavailableHint: string;
  intro: string;

  // Time zone
  timezoneResolved: (city: string, offset: string) => string;
  timezoneChooseLabel: string;
  timezoneChooseHint: string;
  timezonePlaceholder: string;
  timezoneRequired: string;

  // Bulk editor
  bulkLegend: string;
  bulkHint: string;
  daysLegend: string;
  presetLegend: string;
  presetSunThu: string;
  presetMonFri: string;
  presetClear: string;
  fromLabel: string;
  toLabel: string;
  applyToSelected: (count: number) => string;
  applyDisabledHint: string;

  // Summary
  summaryLegend: string;
  summaryDay: string;
  summaryHours: string;
  unappliedChanges: string;
  appliedSaving: string;
  appliedSaved: string;
  appliedFailed: string;
  appliedOffline: string;
  summaryPending: string;
  summaryTotals: (days: number, hours: string) => string;
  summaryEmpty: string;
  unavailable: string;
  available: string;
  markUnavailable: (day: string) => string;
  setHours: (day: string) => string;
  editDay: (day: string) => string;
  doneEditing: string;
  addWindow: string;
  removeWindow: (day: string, range: string) => string;
  windowRange: (from: string, to: string) => string;

  // Refusals — each names the fix, not just the fault.
  rejectedOverlap: string;
  rejectedDuplicate: string;
  rejectedTooMany: (max: number) => string;
  rejectedInvalidRange: string;
  serverRejected: string;

  // Save status. The same vocabulary Task 1 uses, so a provider moving between
  // tasks is not learning two ways to be told the same thing.
  saving: string;
  saved: string;
  saveFailed: string;
  saveRetry: string;
  saveConflict: string;
  offline: string;
}

export const AVAILABILITY_COPY: Record<Lang, AvailabilityCopy> = {
  en: {
    kicker: 'Select several days at once',
    question: 'When can you take requests?',
    dayAbbrev: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
    applyToSelectedDays: 'Apply to selected days',
    unavailableLabel: 'Unavailable on selected days',
    discardTitle: (count) =>
      count === 1
        ? 'This will change 1 day you have already set'
        : `This will change ${count} days you have already set`,
    discardLine: (day, from, to) => `${day}: ${from} becomes ${to}`,
    discardSecondWindow: (day) =>
      `${day}: the extra time ranges will be replaced by the hours selected above`,
    discardConfirm: 'Apply these hours',
    discardCancel: 'Leave them as they are',
    unavailableHint:
      'Applying removes the working hours on the selected days. Other days stay unchanged.',
    heading: 'Working hours',
    intro: 'Tell us when you can take jobs. You can change this any time.',

    timezoneResolved: (city, offset) => `Times are shown in ${city} time (${offset}).`,
    timezoneChooseLabel: 'Time zone',
    timezoneChooseHint:
      'Your country covers more than one time zone, so we cannot work this out for you.',
    timezonePlaceholder: 'Choose your time zone',
    timezoneRequired: 'Choose your time zone before setting your hours.',

    bulkLegend: 'Set several days at once',
    bulkHint: 'Pick the days, choose the hours, then apply. This replaces those days.',
    daysLegend: 'Days',
    presetLegend: 'Quick pick',
    presetSunThu: 'Sunday–Thursday',
    presetMonFri: 'Monday–Friday',
    presetClear: 'Clear selection',
    fromLabel: 'From',
    toLabel: 'To',
    applyToSelected: (count) =>
      count === 1 ? 'Apply to 1 selected day' : `Apply to ${count} selected days`,
    applyDisabledHint: 'Select at least one day.',

    summaryLegend: 'Your weekly schedule',
    summaryDay: 'Day',
    summaryHours: 'Working hours',
    unappliedChanges: 'Your selection has changed. Apply it to update the schedule below.',
    appliedSaving: 'Hours applied. Saving your schedule…',
    appliedSaved: 'Working hours applied and saved.',
    appliedFailed: 'These working hours have not been saved.',
    appliedOffline: 'Offline — keep this page open to save your working hours.',
    summaryPending: 'The schedule below includes changes that are not saved yet.',
    summaryTotals: (days, hours) =>
      `${days === 1 ? '1 day' : `${days} days`} · ${hours} hours a week`,
    summaryEmpty: 'No hours set yet.',
    unavailable: 'Unavailable',
    available: 'Available',
    markUnavailable: (day) => `Mark ${day} unavailable`,
    setHours: (day) => `Set hours for ${day}`,
    editDay: (day) => `Edit ${day}`,
    doneEditing: 'Done',
    addWindow: 'Add another period',
    removeWindow: (day, range) => `Remove ${range} on ${day}`,
    windowRange: (from, to) => `${from}–${to}`,

    rejectedOverlap:
      'That overlaps hours already set for this day. Change the times or remove the other period.',
    rejectedDuplicate: 'Those hours are already set for this day.',
    rejectedTooMany: (max) => `You can set at most ${max} periods across the week.`,
    rejectedInvalidRange:
      'Hours have to end after they start. A shift running past midnight is two periods, on two days.',
    serverRejected: 'These hours could not be saved. Check the days marked below.',

    saving: 'Saving…',
    saved: 'Saved',
    saveFailed: 'Could not save.',
    saveRetry: 'Try again',
    saveConflict: 'Your hours changed somewhere else. Reload to see the current schedule.',
    offline: 'Offline — your changes are waiting.',
  },
  ar: {
    kicker: 'حدد عدة أيام معاً',
    question: 'متى تستقبل الطلبات؟',
    dayAbbrev: ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'],
    applyToSelectedDays: 'تطبيق على الأيام المحددة',
    unavailableLabel: 'غير متاح في أيام محددة',
    discardTitle: (count) =>
      count === 1
        ? 'سيغيّر هذا يوماً واحداً سبق أن حددته'
        : `سيغيّر هذا ${count} أيام سبق أن حددتها`,
    discardLine: (day, from, to) => `${day}: ${from} تصبح ${to}`,
    discardSecondWindow: (day) => `${day}: ستُستبدل الفترات الإضافية بالساعات التي حددتها أعلاه`,
    discardConfirm: 'طبّق هذه الساعات',
    discardCancel: 'اتركها كما هي',
    unavailableHint: 'عند التطبيق تُحذف ساعات العمل من الأيام المحددة، وتبقى الأيام الأخرى كما هي.',
    heading: 'ساعات العمل',
    intro: 'أخبرنا متى يمكنك قبول الأعمال. يمكنك تغيير ذلك في أي وقت.',

    timezoneResolved: (city, offset) => `تُعرض الأوقات بتوقيت ${city} (${offset}).`,
    timezoneChooseLabel: 'المنطقة الزمنية',
    timezoneChooseHint: 'دولتك تضم أكثر من منطقة زمنية، لذا لا يمكننا تحديدها نيابة عنك.',
    timezonePlaceholder: 'اختر منطقتك الزمنية',
    timezoneRequired: 'اختر منطقتك الزمنية قبل تحديد ساعاتك.',

    bulkLegend: 'حدّد عدة أيام دفعة واحدة',
    bulkHint: 'اختر الأيام، ثم الساعات، ثم طبّق. هذا يستبدل ساعات تلك الأيام.',
    daysLegend: 'الأيام',
    presetLegend: 'اختيار سريع',
    presetSunThu: 'الأحد–الخميس',
    presetMonFri: 'الإثنين–الجمعة',
    presetClear: 'إلغاء التحديد',
    fromLabel: 'من',
    toLabel: 'إلى',
    applyToSelected: (count) =>
      count === 1 ? 'تطبيق على يوم واحد محدد' : `تطبيق على ${count} أيام محددة`,
    applyDisabledHint: 'اختر يوماً واحداً على الأقل.',

    summaryLegend: 'جدول ساعاتك الأسبوعي',
    summaryDay: 'اليوم',
    summaryHours: 'ساعات العمل',
    unappliedChanges: 'غيّرت اختيارك. اضغط على تطبيق لتحديث الجدول أدناه.',
    appliedSaving: 'تم تطبيق الساعات. جارٍ حفظ الجدول…',
    appliedSaved: 'تم تطبيق ساعات العمل وحفظها.',
    appliedFailed: 'لم تُحفظ ساعات العمل هذه بعد.',
    appliedOffline: 'أنت غير متصل. أبقِ الصفحة مفتوحة لحفظ ساعات العمل.',
    summaryPending: 'يتضمن الجدول أدناه تغييرات لم تُحفظ بعد.',
    summaryTotals: (days, hours) =>
      `${days === 1 ? 'يوم واحد' : `${days} أيام`} · ${hours} ساعة أسبوعياً`,
    summaryEmpty: 'لم تُحدَّد أي ساعات بعد.',
    unavailable: 'غير متاح',
    available: 'متاح',
    markUnavailable: (day) => `تعيين ${day} كغير متاح`,
    setHours: (day) => `تحديد ساعات ${day}`,
    editDay: (day) => `تعديل ${day}`,
    doneEditing: 'تم',
    addWindow: 'إضافة فترة أخرى',
    removeWindow: (day, range) => `إزالة ${range} في ${day}`,
    windowRange: (from, to) => `${from}–${to}`,

    rejectedOverlap:
      'هذه الفترة تتداخل مع ساعات محددة لهذا اليوم. غيّر الأوقات أو احذف الفترة الأخرى.',
    rejectedDuplicate: 'هذه الساعات محددة بالفعل لهذا اليوم.',
    rejectedTooMany: (max) => `يمكنك تحديد ${max} فترة كحد أقصى خلال الأسبوع.`,
    rejectedInvalidRange:
      'يجب أن تنتهي الساعات بعد بدايتها. الوردية التي تمتد بعد منتصف الليل هي فترتان في يومين.',
    serverRejected: 'تعذّر حفظ هذه الساعات. راجع الأيام المحددة أدناه.',

    saving: 'جارٍ الحفظ…',
    saved: 'تم الحفظ',
    saveFailed: 'تعذّر الحفظ.',
    saveRetry: 'إعادة المحاولة',
    saveConflict: 'تغيّرت ساعاتك في مكان آخر. أعد التحميل لعرض الجدول الحالي.',
    offline: 'غير متصل — تغييراتك في الانتظار.',
  },
};

/**
 * Full day names, for the accessible name on the approved screen's two-letter
 * toggles. Moved into V2 copy because the tree must not import the legacy
 * wizard copy — the conformance gate refuses that import by name.
 */
export const DAY_NAMES: Record<Lang, readonly string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};
