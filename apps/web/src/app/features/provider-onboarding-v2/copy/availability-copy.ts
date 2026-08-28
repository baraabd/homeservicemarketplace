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

    summaryLegend: 'Your week',
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

    summaryLegend: 'أسبوعك',
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
