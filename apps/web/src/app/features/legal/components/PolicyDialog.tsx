import { useLayoutEffect, useRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import {
  LEGAL_CHROME,
  LEGAL_PAGES,
  legalPath,
  type LegalLang,
  type LegalPageId,
} from '../copy/legal-documents.copy';
import { LegalDocument } from './LegalDocument';

// K02 — read a policy without leaving the signup form. The form stays
// mounted underneath, so every typed value (including the password, which is
// never written to storage) and the validated returnTo survive, and opening
// or closing the dialog never changes the consent checkbox. Radix provides
// the focus trap, Escape to close and focus return to the link that opened
// it. The full page is one link away, in a new tab.
export function PolicyDialog({
  id,
  lang,
  onClose,
}: {
  id: LegalPageId | null;
  lang: LegalLang;
  onClose: () => void;
}) {
  const chrome = LEGAL_CHROME[lang];
  // The dialog is opened by a plain link, not a Radix Trigger, so Radix has
  // no trigger to return focus to and would drop it on <body>. Capture the
  // opener before Radix moves focus (layout effects run first) and restore it.
  const opener = useRef<HTMLElement | null>(null);
  const isOpen = id !== null;
  useLayoutEffect(() => {
    if (isOpen && document.activeElement instanceof HTMLElement) {
      opener.current = document.activeElement;
    }
  }, [isOpen]);
  return (
    <DialogPrimitive.Root
      open={id !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/60" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92svh] flex-col rounded-t-3xl bg-white shadow-xl outline-none dark:bg-slate-900 sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[85svh] sm:w-[min(40rem,calc(100vw-2rem))] sm:rounded-3xl"
          data-testid="policy-dialog"
        >
          <div className="flex items-center justify-end gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-700">
            <DialogPrimitive.Close
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-slate-200 dark:hover:bg-slate-800"
              aria-label={chrome.close}
            >
              <X size={20} aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="overflow-y-auto px-5 py-5" style={{ overscrollBehavior: 'contain' }}>
            {id ? (
              <>
                <DialogPrimitive.Title className="sr-only">
                  {LEGAL_PAGES[id][lang].title}
                </DialogPrimitive.Title>
                <LegalDocument id={id} lang={lang} headingLevel={2} showNav={false} />
                <a
                  href={legalPath(id)}
                  target="_blank"
                  rel="noopener"
                  className="mt-6 inline-flex min-h-11 items-center text-blue-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-300"
                  style={{ fontSize: '15px', fontWeight: 600 }}
                >
                  {chrome.openFullPage}
                </a>
              </>
            ) : null}
          </div>
          <div
            className="border-t border-slate-200 px-5 py-3 dark:border-slate-700"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            <DialogPrimitive.Close
              className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-slate-900 px-4 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-white dark:text-slate-900"
              style={{ fontSize: '16px', fontWeight: 700 }}
            >
              {chrome.close}
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
