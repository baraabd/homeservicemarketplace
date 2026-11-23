import { useEffect, useState } from 'react';

/** UI hint only. The backend owns OTP expiry, even if the local clock changes. */
export function useOtpCountdown(expiresAt?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAt === undefined) return;
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [expiresAt]);
  const seconds = expiresAt === undefined ? null : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return {
    seconds,
    expired: seconds === 0,
    label:
      seconds === null
        ? null
        : `${Math.floor(seconds / 60)
            .toString()
            .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`,
  };
}
