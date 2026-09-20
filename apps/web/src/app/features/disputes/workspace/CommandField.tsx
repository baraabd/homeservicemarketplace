import { useId, type ReactNode } from 'react';

/** Keep the accessible name separate from options, entered text, and help text. */
export function CommandField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (control: { id: string; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const descriptionId = hint ? `${id}-description` : undefined;
  return (
    <div className="case-field">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': descriptionId })}
      {hint && <small id={descriptionId}>{hint}</small>}
    </div>
  );
}
