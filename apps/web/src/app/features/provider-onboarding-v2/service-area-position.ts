/** A native geolocation timeout may exclude time spent waiting for permission.
 * Bound the entire user action, and let manual edits release the exit barrier. */
export function requestServiceAreaPosition(signal: AbortSignal): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject({ code: 2 });
      return;
    }
    let settled = false;
    const finish = (position?: GeolocationPosition, error?: { code: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (position) resolve(position);
      else reject(error);
    };
    const abort = () => finish(undefined, { code: 2 });
    const timer = setTimeout(() => finish(undefined, { code: 3 }), 15000);
    signal.addEventListener('abort', abort, { once: true });
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => finish(position),
        (error) => finish(undefined, error),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
      );
    } catch {
      finish(undefined, { code: 2 });
    }
  });
}
