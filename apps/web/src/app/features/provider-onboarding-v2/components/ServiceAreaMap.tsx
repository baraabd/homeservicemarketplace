import { useEffect, useState } from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { Minus, Plus, Crosshair } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { ProviderButton } from '../../provider-ui';
import { SERVICE_AREA_COPY, type Lang } from '../copy/service-area-copy';
import './service-area-map.css';

export interface ServiceAreaPoint {
  lat: number;
  lng: number;
}

/** The envelope of the provider's market, as the server describes it. */
export interface ServiceAreaBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface Props {
  point: ServiceAreaPoint | null;
  radiusKm: number;
  editable: boolean;
  lang: Lang;
  /**
   * R09 — where to open the map while no point is chosen.
   *
   * Without it the map opened on the whole world at zoom 2, where one tap is
   * hundreds of kilometres wide: a provider who had just chosen Syria and
   * tapped the middle of the map stored a starting point in the Sahara, and
   * matching was then computed from it. The envelope comes from the server;
   * the client holds no geography of its own.
   */
  bounds?: ServiceAreaBounds | null;
  /** Returns false when the point was not accepted, so a dragged pin can be
   *  put back where the server still has it. */
  onSelect: (point: ServiceAreaPoint) => boolean;
}

// The world centre is only a viewport, never a suggested or persisted home.
const WORLD: L.LatLngTuple = [20, 0];
const pin = L.divIcon({
  className: 'pv-service-area-pin',
  html: '<svg viewBox="0 0 32 40" aria-hidden="true"><path d="M16 39C13 33 1 22 1 16a15 15 0 1 1 30 0c0 6-12 17-15 23Z" fill="currentColor" stroke="white" stroke-width="2"/><circle cx="16" cy="16" r="5" fill="white"/></svg>',
  iconSize: [44, 48],
  iconAnchor: [22, 48],
});

function MapInteraction({ point, radiusKm, editable, lang, bounds, onSelect }: Props) {
  const copy = SERVICE_AREA_COPY[lang];
  const map = useMap();
  const lat = point?.lat;
  const lng = point?.lng;
  useMapEvents({
    click: (event) => {
      if (editable) {
        const selected = event.latlng.wrap();
        onSelect({ lat: selected.lat, lng: selected.lng });
      }
    },
  });
  useEffect(() => {
    const element = map.getContainer();
    element.setAttribute('role', 'region');
    element.setAttribute('aria-label', copy.mapInstructions);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(element);
    map.invalidateSize();
    return () => observer.disconnect();
  }, [map, copy.mapInstructions]);
  useEffect(() => {
    if (lat !== undefined && lng !== undefined)
      map.setView([lat, lng], Math.max(map.getZoom(), 13), { animate: false });
  }, [map, lat, lng]); // Coordinate changes include GPS and server hydration.
  const south = bounds?.south;
  const west = bounds?.west;
  const north = bounds?.north;
  const east = bounds?.east;
  const hasPoint = lat !== undefined && lng !== undefined;
  useEffect(() => {
    // Only a viewport. Nothing is selected or saved by showing the market.
    if (hasPoint) return;
    if (south === undefined || west === undefined || north === undefined || east === undefined)
      return;
    map.fitBounds(
      [
        [south, west],
        [north, east],
      ],
      { animate: false },
    );
  }, [map, hasPoint, south, west, north, east]);
  return (
    <>
      {point ? (
        <>
          <Circle
            center={[point.lat, point.lng]}
            radius={radiusKm * 1000}
            pathOptions={{ color: 'var(--pv-accent)', fillOpacity: 0.08, weight: 1 }}
            interactive={false}
          />
          <Marker
            position={[point.lat, point.lng]}
            icon={pin}
            draggable={editable}
            title={copy.selectedPoint}
            alt={copy.selectedPoint}
            eventHandlers={{
              dragend: (event) => {
                if (!editable) return;
                const marker = event.target as L.Marker;
                const next = marker.getLatLng().wrap();
                // A refused drop goes back to the point that is still stored.
                if (!onSelect({ lat: next.lat, lng: next.lng })) {
                  marker.setLatLng([point.lat, point.lng]);
                }
              },
            }}
          />
        </>
      ) : null}
      <div
        className="pv-service-area-controls"
        ref={(node) => {
          if (node) L.DomEvent.disableClickPropagation(node);
        }}
      >
        <ProviderButton tone="secondary" aria-label={copy.zoomIn} onClick={() => map.zoomIn()}>
          <Plus size={20} aria-hidden="true" />
        </ProviderButton>
        <ProviderButton tone="secondary" aria-label={copy.zoomOut} onClick={() => map.zoomOut()}>
          <Minus size={20} aria-hidden="true" />
        </ProviderButton>
      </div>
      {editable ? (
        <div
          className="pv-service-area-centre"
          ref={(node) => {
            if (node) L.DomEvent.disableClickPropagation(node);
          }}
        >
          <ProviderButton
            tone="secondary"
            data-testid="service-area-use-centre"
            onClick={() => {
              const next = map.getCenter().wrap();
              onSelect({ lat: next.lat, lng: next.lng });
            }}
          >
            <Crosshair size={18} aria-hidden="true" />
            {copy.useMapCentre}
          </ProviderButton>
        </div>
      ) : null}
    </>
  );
}

export default function ServiceAreaMap(props: Props) {
  const copy = SERVICE_AREA_COPY[props.lang];
  const [tileError, setTileError] = useState(false);
  return (
    <div className="pv-service-area-map" data-testid="service-area-map">
      <MapContainer
        center={props.point ? [props.point.lat, props.point.lng] : WORLD}
        zoom={props.point ? 13 : 2}
        minZoom={2}
        maxZoom={19}
        zoomControl={false}
        touchZoom
        dragging
        keyboard
        scrollWheelZoom={false}
        worldCopyJump
        maxBounds={[
          [-85, -180],
          [85, 180],
        ]}
        maxBoundsViscosity={1}
        className="h-[280px] w-full"
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          eventHandlers={{
            tileerror: () => setTileError(true),
            tileload: () => setTileError(false),
          }}
        />
        <MapInteraction {...props} />
      </MapContainer>
      {tileError ? (
        <p role="status" className="px-3 py-2 text-pv-help text-pv-muted">
          {copy.mapUnavailable}
        </p>
      ) : null}
    </div>
  );
}
