import type { ProviderPreviewNotice } from '@homeservicemarketplace/contracts';

// Sprint 9B.9 — what the provider is told, in both locales.
//
// Server-owned rather than a client string key, for the same reason the budget
// label is: the restriction is a policy decision, and a client that composed
// its own wording would drift from what the server actually does the first
// time the policy changed.
//
// THE COPY HAS TO BE TRUE
//
// A provider looking at a deliberately vague map will conclude one of two
// things: that the platform is broken, or that it is hiding something from
// them. Both are worse than being told plainly that the locations are
// approximate ON PURPOSE, that this is a preview, and what to do next. So the
// text says all three, names the limit, and does not promise a timeline
// nobody can keep.
//
// It also does not blame the provider. "You are not verified" reads as an
// accusation to someone who has submitted their documents and is waiting;
// "while your documents are being checked" describes the same state without
// implying they did something wrong.

export const PREVIEW_NOTICE: ProviderPreviewNotice = {
  code: 'PREVIEW_ONLY',
  titleEn: 'Preview only',
  titleAr: 'معاينة فقط',
  bodyEn:
    'While your documents are being checked you can see a sample of nearby work. ' +
    'Locations are approximate on purpose, and contact details are hidden. ' +
    'You will be able to bid and message customers once your verification is complete.',
  bodyAr:
    'أثناء مراجعة مستنداتك يمكنك الاطلاع على نموذج من الأعمال القريبة. ' +
    'المواقع تقريبية عن قصد، وبيانات التواصل مخفية. ' +
    'ستتمكن من تقديم العروض ومراسلة العملاء بعد اكتمال التحقق.',
};
