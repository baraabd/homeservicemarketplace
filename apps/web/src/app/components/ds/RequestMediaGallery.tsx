import { useState } from 'react';
import { ImageOff } from 'lucide-react';

import { resolveMediaUrl } from '../../../lib/media-url';

// Sprint 7.13 — reusable media strip for service-request photos.
//
// Single source of truth for rendering seeker-uploaded media on BOTH
// the provider job-detail overlay and the seeker request/booking
// detail. It:
//   - normalises each URL via resolveMediaUrl (handles relative paths /
//     bare keys without double-prefixing absolute URLs),
//   - renders a bounded horizontal thumbnail strip,
//   - swaps any image/video that fails to load for an inline
//     placeholder so the browser's broken-image glyph never shows,
//   - renders nothing at all when there is no renderable media (so the
//     layout reserves no dead space).

const VIDEO_EXTENSION = /\.(mp4|mov|webm|m4v)(?:[?#]|$)/i;

const DEFAULT_THUMB_CLASS =
  'w-16 h-16 object-cover rounded-md border border-slate-200 dark:border-slate-600 flex-shrink-0';

export interface RequestMediaGalleryProps {
  urls: string[] | null | undefined;
  /** Override the strip container classes. */
  className?: string;
  /** Override each thumbnail's classes (size/shape). */
  thumbClassName?: string;
  testId?: string;
  ariaLabel?: string;
}

export function RequestMediaGallery({
  urls,
  className,
  thumbClassName,
  testId,
  ariaLabel,
}: RequestMediaGalleryProps) {
  const resolved = (urls ?? []).map((u) => resolveMediaUrl(u)).filter((u) => u.length > 0);

  if (resolved.length === 0) return null;

  return (
    <div
      className={className ?? 'flex gap-2 overflow-x-auto -mx-1 px-1 pb-1'}
      style={{ scrollbarWidth: 'none' }}
      data-testid={testId}
      aria-label={ariaLabel}
    >
      {resolved.map((url) => (
        <MediaThumb key={url} url={url} thumbClassName={thumbClassName} />
      ))}
    </div>
  );
}

function MediaThumb({ url, thumbClassName }: { url: string; thumbClassName?: string }) {
  const [errored, setErrored] = useState(false);
  const base = thumbClassName ?? DEFAULT_THUMB_CLASS;

  if (errored) {
    return (
      <div
        className={`${base} flex items-center justify-center bg-slate-100 dark:bg-slate-700`}
        data-testid="media-thumb-fallback"
        aria-hidden="true"
      >
        <ImageOff size={18} className="text-slate-400" />
      </div>
    );
  }

  if (VIDEO_EXTENSION.test(url)) {
    return (
      <video
        src={url}
        className={base}
        muted
        playsInline
        preload="metadata"
        data-testid="media-thumb-video"
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className={base}
      data-testid="media-thumb-img"
      onError={() => setErrored(true)}
    />
  );
}
