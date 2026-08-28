import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Image as ImageIcon, RotateCw, Trash2, Upload } from 'lucide-react';

import {
  finalizeAvatar,
  keyFromUploadUrl,
  presignAvatar,
  putAvatarBytes,
  removeAvatar,
} from '../../../../lib/provider/provider-avatar-api';
import { ImageProcessingError, processAvatarImage } from './image-processing';
import { AVATAR_COPY, type Lang } from '../copy/basics-copy';

// Sprint 9B.17 — the avatar control.
//
// WHAT REPLACED WHAT
//
// The Sprint 8 wizard asked the provider to paste a URL into a text box. That
// asks someone to host an image somewhere else first, and it is why the field
// was almost always empty. This takes a photo, or a file, and does the rest.
//
// THE STATE THAT MATTERS
//
// `uploading` is not `saved`. The bytes reaching storage means only that: the
// server has not yet looked at them. Nothing here says the photo is set until
// FINALIZE returns, because finalize is where the object is read back, its
// size measured and its leading bytes checked. Reporting success at the end of
// the PUT would show a provider a photo the server may be about to refuse.

type UploadState =
  | { kind: 'idle' }
  | { kind: 'processing' }
  | { kind: 'uploading'; fraction: number }
  | { kind: 'finalizing' }
  | { kind: 'failed'; code: string; retry: () => void };

interface AvatarUploaderProps {
  /** The stored photo, from the server. Null when there is none. */
  imageUrl: string | null;
  /** The draft version, for the optimistic-concurrency contract. */
  version: number;
  lang: Lang;
  /** Called with the complete draft view returned by finalize/remove, so the
   *  caller can seed its cache rather than refetch. */
  onSaved: (view: unknown) => void;
  disabled?: boolean;
}

export function AvatarUploader({
  imageUrl,
  version,
  lang,
  onSaved,
  disabled = false,
}: AvatarUploaderProps) {
  const copy = AVATAR_COPY[lang];
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [preview, setPreview] = useState<string | null>(null);
  const [turns, setTurns] = useState(0);
  // Whether a file was picked IN THIS SESSION. State rather than a read of
  // `original.current` during render: rotation re-processes the original, and a
  // stored photo has no original here to turn.
  const [hasPicked, setHasPicked] = useState(false);

  // The picked file is kept so ROTATE can re-process from the original rather
  // than re-encoding an already-encoded JPEG each time, which would visibly
  // degrade the photo after three presses.
  const original = useRef<File | null>(null);
  const abort = useRef<AbortController | null>(null);
  const previewRef = useRef<string | null>(null);

  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  // Retry has to call the very function that produced the failure, and a
  // callback cannot close over itself. These refs hold the latest version, so
  // the retry button reaches it without the declaration referring to itself.
  const runRef = useRef<((file: File, turns: number) => void) | null>(null);
  const removeRef = useRef<(() => void) | null>(null);

  const setPreviewUrl = useCallback((url: string | null) => {
    // Object URLs are a leak if they are not revoked, and this component can
    // create one per rotation.
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreview(url);
  }, []);

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      abort.current?.abort();
    },
    [],
  );

  const run = useCallback(
    async (file: File, quarterTurns: number) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      try {
        setState({ kind: 'processing' });
        const processed = await processAvatarImage(file, { rotateQuarterTurns: quarterTurns });
        setPreviewUrl(processed.previewUrl);

        setState({ kind: 'uploading', fraction: 0 });
        const presigned = await presignAvatar({
          contentType: processed.contentType,
          sizeBytes: processed.blob.size,
          filename: file.name,
        });

        await putAvatarBytes(processed.blob, presigned.uploadUrl, {
          signal: controller.signal,
          onProgress: (fraction) => setState({ kind: 'uploading', fraction }),
        });

        // The bytes are stored. They are not yet a photo.
        setState({ kind: 'finalizing' });
        const view = await finalizeAvatar({
          key: keyFromUploadUrl(presigned.uploadUrl),
          version,
        });

        onSaved(view);
        setState({ kind: 'idle' });
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return;
        const code =
          err instanceof ImageProcessingError
            ? err.code
            : ((err as { response?: { data?: { error?: { details?: { reason?: string } } } } })
                ?.response?.data?.error?.details?.reason ?? 'UPLOAD_FAILED');
        setState({
          kind: 'failed',
          code,
          // Retry re-runs the WHOLE pipeline from the original file, because a
          // presigned URL expires and a half-finished upload is not resumable.
          retry: () => runRef.current?.(file, quarterTurns),
        });
      }
    },
    [onSaved, setPreviewUrl, version],
  );

  // Kept current so the retry closures above reach the latest callbacks.
  useEffect(() => {
    runRef.current = (file, quarterTurns) => void run(file, quarterTurns);
  }, [run]);

  const onPick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Clear the input so picking the SAME file twice still fires a change
      // event — otherwise a retry-by-repick silently does nothing.
      event.target.value = '';
      if (!file) return;
      original.current = file;
      setHasPicked(true);
      setTurns(0);
      void run(file, 0);
    },
    [run],
  );

  const onRotate = useCallback(() => {
    const file = original.current;
    if (!file) return;
    const next = (turns + 1) % 4;
    setTurns(next);
    void run(file, next);
  }, [run, turns]);

  const onRemove = useCallback(async () => {
    try {
      setState({ kind: 'finalizing' });
      const view = await removeAvatar(version);
      original.current = null;
      setHasPicked(false);
      setTurns(0);
      setPreviewUrl(null);
      onSaved(view);
      setState({ kind: 'idle' });
    } catch {
      setState({ kind: 'failed', code: 'REMOVE_FAILED', retry: () => removeRef.current?.() });
    }
  }, [onSaved, setPreviewUrl, version]);

  useEffect(() => {
    removeRef.current = () => void onRemove();
  }, [onRemove]);

  const busy =
    state.kind === 'processing' || state.kind === 'uploading' || state.kind === 'finalizing';
  const shown = preview ?? imageUrl;
  const hasPhoto = Boolean(shown);

  return (
    <div className="flex flex-col gap-3" data-testid="avatar-uploader">
      <div className="flex items-center gap-3">
        <div
          className="relative flex-shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"
          style={{ width: '72px', height: '72px' }}
          data-testid="avatar-preview"
        >
          {shown ? (
            <img
              src={shown}
              alt={copy.previewAlt}
              className="h-full w-full object-cover"
              data-testid="avatar-preview-image"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-400">
              <ImageIcon size={24} aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p
            className="break-words text-slate-900 dark:text-white"
            style={{ fontSize: '14px', fontWeight: 600 }}
          >
            {copy.title}
          </p>
          <p
            className="mt-0.5 break-words text-slate-500 dark:text-slate-400"
            style={{ fontSize: '12px' }}
          >
            {copy.hint}
          </p>
        </div>
      </div>

      {/* Two inputs, not one. `capture` opens the camera directly on a phone,
          which is the fastest path for someone who has not taken the photo
          yet; the plain input is the gallery or a desktop file browser.
          A single input with `capture` would take the choice away. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="user"
        className="sr-only"
        onChange={onPick}
        data-testid="avatar-input-camera"
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={galleryInput}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={onPick}
        data-testid="avatar-input-gallery"
        aria-hidden="true"
        tabIndex={-1}
      />

      <div className="flex flex-wrap gap-2">
        <UploaderButton
          testId="avatar-take-photo"
          icon={<Camera size={16} aria-hidden="true" />}
          label={copy.takePhoto}
          onClick={() => cameraInput.current?.click()}
          disabled={disabled || busy}
        />
        <UploaderButton
          testId="avatar-choose-file"
          icon={<Upload size={16} aria-hidden="true" />}
          label={hasPhoto ? copy.replace : copy.choose}
          onClick={() => galleryInput.current?.click()}
          disabled={disabled || busy}
        />
        {hasPhoto ? (
          <>
            <UploaderButton
              testId="avatar-rotate"
              icon={<RotateCw size={16} aria-hidden="true" />}
              label={copy.rotate}
              onClick={onRotate}
              // Rotation re-processes the ORIGINAL file, so it is only
              // available for a photo picked in this session. A stored photo
              // has no original here to turn.
              disabled={disabled || busy || !hasPicked}
            />
            <UploaderButton
              testId="avatar-remove"
              icon={<Trash2 size={16} aria-hidden="true" />}
              label={copy.remove}
              onClick={() => void onRemove()}
              disabled={disabled || busy}
            />
          </>
        ) : null}
      </div>

      <div role="status" aria-live="polite" data-testid="avatar-status">
        {state.kind === 'processing' ? (
          <StatusLine text={copy.processing} />
        ) : state.kind === 'uploading' ? (
          <div className="flex flex-col gap-1">
            <StatusLine text={copy.uploading} />
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(state.fraction * 100)}
              aria-label={copy.uploading}
            >
              <div
                className="h-full rounded-full bg-blue-600 transition-[width] duration-150"
                style={{ width: `${Math.round(state.fraction * 100)}%` }}
                data-testid="avatar-progress-bar"
              />
            </div>
          </div>
        ) : state.kind === 'finalizing' ? (
          // A distinct message, because this is the wait the provider cannot
          // otherwise account for: the bytes are sent, and the server is
          // deciding whether they are usable.
          <StatusLine text={copy.checking} />
        ) : state.kind === 'failed' ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-words text-rose-600" style={{ fontSize: '12px' }}>
              {copy.failure[state.code] ?? copy.failure.UPLOAD_FAILED}
            </span>
            <button
              type="button"
              onClick={state.retry}
              data-testid="avatar-retry"
              className="rounded-lg px-2 py-1 text-blue-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              style={{ fontSize: '12px', fontWeight: 600, minHeight: '44px' }}
            >
              {copy.retry}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatusLine({ text }: { text: string }) {
  return (
    <span className="break-words text-slate-500 dark:text-slate-400" style={{ fontSize: '12px' }}>
      {text}
    </span>
  );
}

function UploaderButton({
  testId,
  icon,
  label,
  onClick,
  disabled,
}: {
  testId: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      style={{ fontSize: '13px', fontWeight: 600, minHeight: '44px' }}
    >
      {icon}
      {label}
    </button>
  );
}
