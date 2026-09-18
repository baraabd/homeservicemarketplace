import { useEffect, useRef } from 'react';

/** Native modal semantics provide focus containment and make the background inert. */
export function CaseLeaveDialog({ open, title, description, stayLabel, leaveLabel, pending, onStay, onLeave }: {
  open: boolean; title: string; description: string; stayLabel: string; leaveLabel: string;
  pending: boolean; onStay: () => void; onLeave: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="case-card case-stack case-dialog"
    aria-labelledby="case-leave-title" aria-describedby="case-leave-description"
    onCancel={(event) => { event.preventDefault(); onStay(); }}>
    <h2 id="case-leave-title">{title}</h2><p id="case-leave-description">{description}</p>
    <div className="case-actions"><button type="button" className="case-button case-button-primary" autoFocus onClick={onStay}>{stayLabel}</button><button type="button" className="case-button" disabled={pending} onClick={onLeave}>{leaveLabel}</button></div>
  </dialog>;
}
