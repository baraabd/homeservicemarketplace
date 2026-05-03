import { useCallback, useMemo, useRef } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import { MapPin } from 'lucide-react';

// ─── Leaflet base styles + default-marker icon fix ───────────────────────────
//
// Leaflet ships its CSS as a sibling asset; Vite users must import it at the
// module scope of any component that mounts a map. Without this, tiles render
// but the zoom controls and attribution overlay show as unstyled DOM noise.
import 'leaflet/dist/leaflet.css';
//
// The default marker icon URLs that Leaflet bakes into its bundled CSS resolve
// against the page origin (e.g. `/images/marker-icon.png`), which breaks under
// every modern bundler — the assets live inside the leaflet package, not at
// the web root. The standard fix is to import the three images through Vite's
// asset pipeline, then merge them into the Default-Icon options. Done once at
// module scope so the cost is paid only on first import.
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

// `_getIconUrl` is the internal hook Leaflet uses to compute the URL — once
// removed, `mergeOptions` becomes the source of truth and our Vite-resolved
// URLs win. Cast through `unknown` because Leaflet's typings don't expose the
// private method, but it's part of the de-facto Leaflet+Vite recipe.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

// Phase 4 Feature 4 (revised) — interactive map with a draggable marker.
//
// Used by:
//   - JobWizardModal.tsx (Location & Time step) — pin the captured
//     coordinates from the "Use my current location" flow.
//   - SavedAddressesPage.tsx — let the user fine-tune the saved
//     address pin before saving.
//
// Migration note: previously rendered through @react-google-maps/api against
// the Google Maps JS API; now uses Leaflet + OpenStreetMap tiles for the
// rendering layer (free, no API key) while the reverse-geocoding utility
// (apps/web/src/lib/reverse-geocode.ts) still calls the Google Geocoding API
// over plain HTTP. The prop contract — { lat, lng, onCoordsChange } — is
// unchanged so JobWizardModal and SavedAddressesPage need no changes.
//
// Graceful fallback contract (unchanged):
//   - When `lat` / `lng` are null (the user hasn't captured a location yet),
//     a non-interactive Placeholder renders so the parent doesn't have to
//     conditionally mount us.
//   - The marker is draggable; its drag-end fires `onCoordsChange` so the
//     parent can update its captured-coords state.
//   - OpenStreetMap tile usage is governed by the OSMF tile usage policy
//     (https://operations.osmfoundation.org/policies/tiles/). Production
//     deployments should provision their own tile server or a paid tile
//     provider rather than relying on the public OSM tile servers at scale.

const MAP_HEIGHT = 200;
const DEFAULT_ZOOM = 15;
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: `${MAP_HEIGHT}px`,
  borderRadius: '1rem',
  overflow: 'hidden',
};

export interface LocationMapProps {
  lat: number | null;
  lng: number | null;
  /** Fired when the user drops the marker at a new position. */
  onCoordsChange?: (next: { lat: number; lng: number }) => void;
  /** Aria label for the map region; falls back to a generic English copy. */
  ariaLabel?: string;
  /** Copy shown in the no-location placeholder. */
  placeholderLabel?: string;
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
  const center = useMemo<[number, number] | null>(
    () => (lat !== null && lng !== null ? [lat, lng] : null),
    [lat, lng],
  );

  const markerRef = useRef<L.Marker | null>(null);

  // Leaflet's drag-end event fires on the Marker itself; the new position is
  // read off the marker via getLatLng() rather than off the event payload so
  // we don't depend on a private LeafletEvent shape.
  const handleDragEnd = useCallback(() => {
    if (!onCoordsChange) return;
    const m = markerRef.current;
    if (!m) return;
    const next = m.getLatLng();
    onCoordsChange({ lat: next.lat, lng: next.lng });
  }, [onCoordsChange]);

  // No coordinates → placeholder. Mirrors the previous Google-Maps behaviour
  // so the parent component's mount logic is unchanged.
  if (center === null) {
    return <Placeholder label={placeholderLabel} />;
  }

  return (
    <div aria-label={ariaLabel} style={containerStyle}>
      <MapContainer
        center={center}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom={false}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
        <Marker
          position={center}
          draggable
          eventHandlers={{ dragend: handleDragEnd }}
          ref={markerRef}
        />
      </MapContainer>
    </div>
  );
}
