import { useRef, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useLang } from '../../i18n/LanguageContext';
/** One focus-managed modal primitive for customer, provider and reviewer commands. */
export function CaseModal({
  title,
  description,
  children,
  onClose,
  closeLabel,
  admin = false,
  pending = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  closeLabel: string;
  admin?: boolean;
  pending?: boolean;
}) {
  const { lang, dir, darkMode } = useLang();
  const opener = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="cw-overlay" />
        <Dialog.Content
          className={`case-ui case-card case-stack cw-modal${admin ? ' admin-review case-admin' : ''}${darkMode ? ' dark' : ''}`}
          dir={dir}
          lang={lang}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            if (!pending) onClose();
          }}
          onCloseAutoFocus={(e) => {
            if (opener.current?.isConnected) {
              e.preventDefault();
              opener.current.focus();
            }
          }}
        >
          <header className="case-summary">
            <Dialog.Title asChild>
              <h2>{title}</h2>
            </Dialog.Title>
            <button
              className="case-button"
              type="button"
              disabled={pending}
              onClick={onClose}
              aria-label={closeLabel}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          <Dialog.Description className="case-muted">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
