import { useRef, useState } from 'react';
import type { ProviderPortfolioItem } from '@homeservicemarketplace/contracts';

import { useLang } from '../../../i18n/LanguageContext';
import {
  portfolioErrorCode,
  useCreatePortfolioItem,
  useDeletePortfolioItem,
  useProviderPortfolio,
  useReorderPortfolio,
  useUpdatePortfolioItem,
} from '../../../hooks/provider/useProviderPortfolio';
import {
  preparePortfolioUpload,
  uploadPortfolioFile,
} from '../../../../lib/provider/provider-portfolio-api';
import { PORTFOLIO_COPY, portfolioErrorText } from './portfolio-copy';
import { currentPublicationAck } from '../../../../lib/provider/publication-ack';
import { Button, IconButton } from '../../ds/Button';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { Progress } from '../../ui/progress';
import { Skeleton } from '../../ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../ui/alert-dialog';

// Sprint 9B.10 — the provider's gallery.
//
// docs/sprint-09b10/PROVIDER_PORTFOLIO.md
//
// REUSED, NOT REBUILT: `ds/Button`, `ui/{badge,input,label,textarea,progress,
// skeleton,alert-dialog}`, `useLang` for locale and direction, and the
// existing `/v1/media/presigned-url` upload pipeline. No new UI framework, no
// second upload system, no new design tokens — every colour and spacing value
// below is an existing Tailwind token already used elsewhere in this app.
//
// DIRECTION IS NEVER HARD-CODED. Reordering is the one place an RTL bug is
// invisible in review and obvious to a user: "move earlier" must move an item
// towards the START of the reading order, which is the right-hand side in
// Arabic. The controls are therefore labelled by INTENT (earlier / later), the
// arrows are flipped from `dir`, and the layout uses logical properties so the
// browser handles the mirroring.

const ACCEPTED = 'image/jpeg,image/png,image/webp';

export function PortfolioSection() {
  const { lang, dir } = useLang();
  const t = PORTFOLIO_COPY[lang];

  const query = useProviderPortfolio();
  const createMut = useCreatePortfolioItem();
  const updateMut = useUpdatePortfolioItem();
  const reorderMut = useReorderPortfolio();
  const deleteMut = useDeletePortfolioItem();

  const fileInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // The exact sentence the provider is agreeing to, and the version that
  // will be recorded against it. One call so the two cannot diverge.
  const ack = currentPublicationAck(lang === 'ar' ? 'ar' : 'en');

  const [consent, setConsent] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', description: '' });
  const [confirmDelete, setConfirmDelete] = useState<ProviderPortfolioItem | null>(null);

  const items = query.data?.items ?? [];
  const remaining = query.data?.remainingSlots ?? 0;
  const atLimit = remaining <= 0;

  async function runUpload(file: File) {
    setErrorCode(null);
    setProgress(0);
    try {
      const prepared = await preparePortfolioUpload(file);
      await uploadPortfolioFile(prepared.uploadUrl, file, setProgress);
      await createMut.mutateAsync({
        storageKey: prepared.storageKey,
        contentType: file.type,
        sizeBytes: file.size,
        publicationRightAck: true,
        // Sprint 9B.22 — WHICH wording was shown. The server refuses a stale
        // version rather than recording agreement to text nobody saw.
        publicationRightAckVersion: ack.version,
      });
      setPendingFile(null);
      setConsent(false);
    } catch (err) {
      // The server's refusal CODE, mapped to localised copy. Never the
      // server's sentence: that arrives in one language whatever the UI is
      // set to, and a provider reading Arabic would get English.
      setErrorCode(portfolioErrorCode(err) ?? 'UPLOAD_FAILED');
    } finally {
      setProgress(null);
    }
  }

  function move(index: number, delta: number) {
    const next = [...items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorderMut.mutate(next.map((i) => i.id));
  }

  // ── loading ─────────────────────────────────────────────────────────────
  if (query.isLoading) {
    return (
      <section aria-busy="true" aria-label={t.sectionTitle} className="space-y-3">
        <h2 className="text-lg font-semibold">{t.sectionTitle}</h2>
        <span className="sr-only">{t.loading}</span>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  // ── load failure ────────────────────────────────────────────────────────
  if (query.isError) {
    return (
      <section aria-label={t.sectionTitle} className="space-y-3">
        <h2 className="text-lg font-semibold">{t.sectionTitle}</h2>
        <p role="alert" className="text-sm text-destructive">
          {t.loadFailed}
        </p>
        <Button variant="secondary" tone="provider" onClick={() => void query.refetch()}>
          {t.retry}
        </Button>
      </section>
    );
  }

  return (
    <section aria-label={t.sectionTitle} className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{t.sectionTitle}</h2>
        <p className="text-sm text-muted-foreground">{t.sectionSubtitle}</p>
      </header>

      {/* The refusal, announced. role="alert" so a screen reader hears it the
          moment it appears rather than only if the user happens to navigate
          back to it. */}
      {errorCode && (
        <p role="alert" data-testid="portfolio-error" className="text-sm text-destructive">
          {portfolioErrorText(lang, errorCode)}
        </p>
      )}

      {/* ── empty ────────────────────────────────────────────────────────── */}
      {items.length === 0 ? (
        <div
          data-testid="portfolio-empty"
          className="rounded-lg border border-dashed p-6 text-center"
        >
          <p className="font-medium">{t.emptyTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.emptyBody}</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t.reorderHint}</p>
          <ul data-testid="portfolio-grid" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {items.map((item, index) => (
              <li
                key={item.id}
                data-testid="portfolio-item"
                className="overflow-hidden rounded-lg border"
              >
                <img
                  src={item.media.url}
                  alt={item.title ?? t.sectionTitle}
                  className="aspect-square w-full object-cover"
                  loading="lazy"
                />
                <div className="space-y-2 p-2">
                  <Badge
                    variant={item.moderationState === 'REJECTED' ? 'destructive' : 'secondary'}
                  >
                    {item.moderationState === 'APPROVED'
                      ? t.moderationApproved
                      : item.moderationState === 'REJECTED'
                        ? t.moderationRejected
                        : t.moderationPending}
                  </Badge>

                  {editing === item.id ? (
                    // Controlled inputs rather than a <form>: the design
                    // system's Button has no `type` prop, so a Cancel inside a
                    // form would submit it. Holding the draft in state keeps
                    // both buttons plain onClick handlers.
                    <div className="space-y-2">
                      <Label htmlFor={`title-${item.id}`}>{t.captionLabel}</Label>
                      <Input
                        id={`title-${item.id}`}
                        value={draft.title}
                        placeholder={t.captionPlaceholder}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      />
                      <Label htmlFor={`desc-${item.id}`}>{t.descriptionLabel}</Label>
                      <Textarea
                        id={`desc-${item.id}`}
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <Button
                          tone="provider"
                          state={updateMut.isPending ? 'loading' : 'default'}
                          onClick={() =>
                            updateMut.mutate(
                              {
                                itemId: item.id,
                                input: { title: draft.title, description: draft.description },
                              },
                              { onSuccess: () => setEditing(null) },
                            )
                          }
                        >
                          {t.save}
                        </Button>
                        <Button variant="text" tone="provider" onClick={() => setEditing(null)}>
                          {t.cancel}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="truncate text-sm font-medium">{item.title ?? ''}</p>
                      <div className="flex flex-wrap gap-1">
                        {/* Labelled by INTENT, not by arrow direction: in
                            Arabic "earlier" is to the right, and a button
                            called "move left" would be wrong in one of the two
                            languages whichever way it was written. */}
                        {/* IconButton, not Button: the design system's
                            Button takes an explicit prop list and does not
                            forward aria-label, so an icon-only control built
                            from it would be announced as its glyph. IconButton
                            exists for exactly this and wires label into both
                            aria-label and title. */}
                        <IconButton
                          variant="ghost"
                          size="sm"
                          label={t.moveUp}
                          state={index === 0 || reorderMut.isPending ? 'disabled' : 'default'}
                          icon={dir === 'rtl' ? '→' : '←'}
                          onClick={() => move(index, -1)}
                        />
                        <IconButton
                          variant="ghost"
                          size="sm"
                          label={t.moveDown}
                          state={
                            index === items.length - 1 || reorderMut.isPending
                              ? 'disabled'
                              : 'default'
                          }
                          icon={dir === 'rtl' ? '←' : '→'}
                          onClick={() => move(index, 1)}
                        />
                        <Button
                          variant="text"
                          tone="provider"
                          onClick={() => {
                            setDraft({
                              title: item.title ?? '',
                              description: item.description ?? '',
                            });
                            setEditing(item.id);
                          }}
                        >
                          {t.edit}
                        </Button>
                        <Button
                          variant="text"
                          tone="provider"
                          onClick={() => setConfirmDelete(item)}
                        >
                          {t.delete}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ── add ──────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {atLimit ? (
          <p data-testid="portfolio-limit" className="text-sm text-muted-foreground">
            {t.limitReachedNotice}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {remaining} {t.slotsRemaining}
          </p>
        )}

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED}
          className="sr-only"
          // Its OWN accessible name, distinct from the visible button that
          // triggers it. Two controls sharing one name is an ambiguity for
          // anyone navigating by name — a screen reader announces "Add photo,
          // button" twice with no way to tell which is which.
          aria-label={t.fileInputLabel}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setPendingFile(file);
              setErrorCode(null);
            }
            // Reset so choosing the SAME file again still fires a change.
            e.target.value = '';
          }}
        />

        {pendingFile && (
          <div className="space-y-2 rounded-lg border p-3" data-testid="portfolio-consent">
            <p className="truncate text-sm">{pendingFile.name}</p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                aria-label={ack.text}
              />
              <span>
                {ack.text}
                <span className="block text-xs text-muted-foreground">{t.consentHint}</span>
              </span>
            </label>
            <div className="flex gap-2">
              <Button
                tone="provider"
                state={progress !== null ? 'loading' : !consent ? 'disabled' : 'default'}
                onClick={() => void runUpload(pendingFile)}
              >
                {t.addButton}
              </Button>
              <Button
                variant="text"
                tone="provider"
                onClick={() => {
                  setPendingFile(null);
                  setConsent(false);
                }}
              >
                {t.uploadCancel}
              </Button>
            </div>
          </div>
        )}

        {progress !== null && (
          <div data-testid="portfolio-progress">
            <Progress value={progress} aria-label={t.uploading} />
            <p className="text-xs text-muted-foreground">
              {t.uploading} {progress}%
            </p>
          </div>
        )}

        {!pendingFile && !atLimit && (
          <Button variant="secondary" tone="provider" onClick={() => fileInput.current?.click()}>
            {items.length === 0 ? t.addButton : t.addAnother}
          </Button>
        )}
      </div>

      {/* ── delete confirmation ──────────────────────────────────────────── */}
      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent dir={dir}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.deleteConfirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.deleteCancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) deleteMut.mutate(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              {t.deleteConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
