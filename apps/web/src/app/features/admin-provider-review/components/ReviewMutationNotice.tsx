import type { ReviewLanguage } from '../copy';
import { ReviewBanner } from './ReviewPrimitives';

/** Explain why a preserved confirmation cannot submit stale review facts. */
export function ReviewMutationNotice({
  lang,
  paused,
  stale,
}: {
  lang: ReviewLanguage;
  paused: boolean;
  stale: boolean;
}) {
  if (!paused && !stale) return null;
  return (
    <ReviewBanner role="status" tone="warning">
      {paused
        ? lang === 'ar'
          ? 'القرارات متوقفة حتى نجاح التحديث. النصوص غير المرسلة باقية في هذه النافذة.'
          : 'Decisions are paused until refresh succeeds. Unsent text remains in this dialog.'
        : lang === 'ar'
          ? 'تغير العنصر المحدد أو الإجراء المتاح. حدّث الملف ثم راجعه مجددًا قبل اتخاذ القرار.'
          : 'The selected item or available action changed. Refresh and inspect it again before deciding.'}
    </ReviewBanner>
  );
}
