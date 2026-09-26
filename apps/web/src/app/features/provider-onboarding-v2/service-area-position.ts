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
        (position) => {
          // Do not hand non-finite or impossible coordinates to Leaflet or
          // autosave. A malformed device result must preserve manual entry.
          const { latitude, longitude } = position.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
              latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            finish(undefined, { code: 2 });
            return;
          }
          finish(position);
        },
        (error) => finish(undefined, error),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
      );
    } catch {
      finish(undefined, { code: 2 });
    }
  });
}
