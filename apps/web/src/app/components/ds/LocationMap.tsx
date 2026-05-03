import { useCallback, useMemo } from 'react';
import { GoogleMap, MarkerF, useJsApiLoader } from '@react-google-maps/api';
import { MapPin } from 'lucide-react';

// Phase 4 Feature 4 — interactive Google Map with a draggable marker.
//
// Used by:
//   - JobWizardModal.tsx (Location & Time step) — pin the captured
//     coordinates from the "Use my current location" flow.
//   - SavedAddressesPage.tsx — let the user fine-tune the saved
//     address pin before saving.
//
// Graceful fallback contract:
//   - When `VITE_GOOGLE_MAPS_API_KEY` is missing/empty (typical dev
//     shell, CI), the component renders a non-interactive placeholder
//     instead of trying to load the Maps JS. No key request goes out;
//     no console error; the parent's flow is unaffected.
//   - When `lat`/`lng` are null (the user hasn't captured a location
//     yet), the placeholder also renders with a "no location yet"
//     message so the parent doesn't have to conditionally mount us.
//   - When the Maps JS fails to load (offline, blocked, quota), the
//     placeholder renders with the same copy. We never show a broken
//     iframe / blank tile.
//
// The marker is draggable; its drag-end fires `onCoordsChange` so the
// parent can update its captured-coords state.

const MAP_HEIGHT = 200;
const DEFAULT_ZOOM = 15;

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: `${MAP_HEIGHT}px`,
  borderRadius: '1rem',
  overflow: 'hidden',
};

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  // The interactive map's whole job is the marker; clutter is bad.
  clickableIcons: false,
};

export interface LocationMapProps {
  lat: number | null;
  lng: number | null;
  /** Fired when the user drops the marker at a new position. */
  onCoordsChange?: (next: { lat: number; lng: number }) => void;
  /** Aria label for the map region; falls back to a generic English copy. */
  ariaLabel?: string;
  /** Copy shown in the no-key / no-location placeholder. */
  placeholderLabel?: string;
}

function readApiKey(): string {
  const k = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return typeof k === 'string' ? k.trim() : '';
}

function Placeholder({ label }: { label: string }) {
  return (
    <div
      className="w-full rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center gap-2 text-slate-400"
      style={{ height: MAP_HEIGHT, fontSize: '12px', fontWeight: 600 }}
      role="img"
      aria-label={label}
    >
      <MapPin size={14} className="text-slate-400" />
      {label}
    </div>
  );
}

export function LocationMap({
  lat,
  lng,
  onCoordsChange,
  ariaLabel = 'Location map',
  placeholderLabel = 'Map preview unavailable',
}: LocationMapProps) {
  const apiKey = readApiKey();

  // Hooks must run unconditionally — call useJsApiLoader before any
  // early return so React's hook order stays stable across renders.
  // When apiKey is empty we pass an empty string; the loader keeps it
  // un-loaded but the hook still returns a stable shape.
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    // Stable id so multiple mount points reuse the same loader.
    id: 'fixnow-google-maps-loader',
  });

  const center = useMemo(() => (lat !== null && lng !== null ? { lat, lng } : null), [lat, lng]);

  const handleDragEnd = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (!onCoordsChange || !e.latLng) return;
      onCoordsChange({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    },
    [onCoordsChange],
  );

  // Render the placeholder for every "we can't show a real map" case:
  //   - no API key configured (dev shells, CI, jsdom tests)
  //   - the Maps JS errored out
  //   - the user hasn't captured coordinates yet
  if (!apiKey || loadError || center === null) {
    return <Placeholder label={placeholderLabel} />;
  }

  // Loader still in flight — keep the visual frame stable.
  if (!isLoaded) {
    return <Placeholder label={placeholderLabel} />;
  }

  return (
    <div aria-label={ariaLabel}>
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={DEFAULT_ZOOM}
        options={mapOptions}
      >
        <MarkerF position={center} draggable onDragEnd={handleDragEnd} />
      </GoogleMap>
    </div>
  );
}
