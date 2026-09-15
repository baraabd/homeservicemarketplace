import type { ReactNode, RefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useLang } from '../../../i18n/LanguageContext';
import { REVIEW_COPY } from '../copy';

/** Shared Radix focus containment, dismissal and focus return for review commands. */
export function ReviewDialog({
  open,
  onClose,
  title,
  description,
  children,
  openerRef,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
  openerRef?: RefObject<HTMLButtonElement>;
}) {
  const { lang, dir, darkMode } = useLang();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ar-modal-overlay" />
        <Dialog.Content
          className={`admin-review ar-dialog ar-modal-content${darkMode ? ' dark' : ''}`}
          dir={dir}
          lang={lang}
          onCloseAutoFocus={(event) => {
            if (openerRef?.current) {
              event.preventDefault();
              openerRef.current.focus();
            }
          }}
        >
          <Dialog.Title className="ar-heading ar-modal-title">{title}</Dialog.Title>
          <Dialog.Description className="ar-muted">{description}</Dialog.Description>
          {children}
          <Dialog.Close className="ar-button ar-modal-close" aria-label={REVIEW_COPY[lang].close}>
            <X size={20} aria-hidden />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
