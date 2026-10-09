import * as AlertDialog from '@radix-ui/react-alert-dialog';
import type { ReactNode, RefObject } from 'react';

import { ProviderButton } from './primitives';

/**
 * A deliberate confirmation for an action that cannot be taken back.
 *
 * Built on the same Radix primitive as `ui/alert-dialog`, but in the provider
 * system's own geometry: 44px actions, logical (start) alignment, and the
 * reader's direction set on the portal, which renders outside the workspace's
 * `dir` container. Radix traps focus while it is open, closes on Escape, and
 * returns focus to `returnFocusRef` — the control that opened it — even where a
 * click does not focus a button (Safari), so keyboard users resume in place.
 *
 * The safe choice is focused first and listed first, so an accidental Enter
 * keeps the booking.
 */
export function ProviderConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  keepLabel,
  confirmLabel,
  onConfirm,
  dir,
  testId,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  keepLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
  dir: 'ltr' | 'rtl';
  testId?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-slate-900/60" />
        <AlertDialog.Content
          dir={dir}
          data-testid={testId}
          // Escape on the dialog itself always keeps (cancels). Radix also
          // listens on the document; R17-E CI once saw that listener miss a
          // keyboard Escape with focus inside the dialog, which would trap a
          // keyboard user in an irreversible-action prompt.
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) {
              event.preventDefault();
              onOpenChange(false);
            }
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef?.current;
            if (target && target.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-pv-border bg-pv-surface p-5 text-start shadow-lg"
        >
          <AlertDialog.Title className="text-pv-heading font-bold text-pv-text">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="text-pv-body text-pv-text">
            {description}
          </AlertDialog.Description>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <ProviderButton tone="secondary" data-testid={testId && `${testId}-keep`}>
                {keepLabel}
              </ProviderButton>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <ProviderButton
                tone="danger"
                onClick={onConfirm}
                data-testid={testId && `${testId}-confirm`}
              >
                {confirmLabel}
              </ProviderButton>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
