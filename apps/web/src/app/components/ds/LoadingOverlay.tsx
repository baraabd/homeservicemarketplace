import { useEffect, useState } from 'react';

export interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
  subtext?: string;
}

export function LoadingOverlay({ visible, message = 'Loading…', subtext }: LoadingOverlayProps) {
  const [rendered, setRendered] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setShow(true)));
    } else {
      setShow(false);
      const t = setTimeout(() => setRendered(false), 300);
      return () => clearTimeout(t);
    }
  }, [visible]);

  if (!rendered) return null;

  return (
    <div
      className={[
        'fixed inset-0 z-[300] flex items-center justify-center',
        'transition-opacity duration-300',
        show ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />

      {/* Card */}
      <div
        className={[
          'relative bg-white rounded-3xl px-8 py-8 flex flex-col items-center gap-5 shadow-2xl mx-6',
          'transition-all duration-300',
          show ? 'scale-100 translate-y-0' : 'scale-90 translate-y-4',
        ].join(' ')}
        style={{ minWidth: '220px' }}
      >
        {/* Logo Mark */}
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 w-10 h-10 rounded-2xl bg-amber-500 flex items-center justify-center shadow-lg shadow-amber-200">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </div>

        {/* Animated ring spinner */}
        <div className="relative mt-3">
          {/* Outer track */}
          <div className="w-16 h-16 rounded-full border-4 border-slate-100" />
          {/* Spinning arc */}
          <div
            className="absolute inset-0 w-16 h-16 rounded-full border-4 border-transparent border-t-amber-500 animate-spin"
            style={{ animationDuration: '0.75s' }}
          />
          {/* Inner dot pulse */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
          </div>
        </div>

        {/* Text */}
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-slate-900" style={{ fontSize: '15px', fontWeight: 700 }}>
            {message}
          </p>
          {subtext && (
            <p className="text-slate-400" style={{ fontSize: '12px' }}>
              {subtext}
            </p>
          )}
        </div>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.8s' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
