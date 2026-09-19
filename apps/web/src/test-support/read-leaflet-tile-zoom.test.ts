import { describe, expect, it } from 'vitest';
import { readLeafletTileZoom } from './read-leaflet-tile-zoom';

function tiles(...sources: string[]): Element[] {
  return sources.map((source) => {
    const image = document.createElement('img');
    image.setAttribute('src', source);
    return image;
  });
}
const tile = (zoom: number) => `https://tile.openstreetmap.org/${zoom}/9881/6422.png`;

describe('Leaflet zoom evidence', () => {
  it('reads the highest actual tile level during overlapping zoom layers', () => {
    expect(readLeafletTileZoom(tiles(tile(13), tile(14)))).toBe(14);
  });
  it('ignores a retired data-image source without poisoning the real level', () => {
    expect(readLeafletTileZoom(tiles(tile(14), 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'))).toBe(14);
  });
  it.each(['', 'about:blank', 'https://tile.openstreetmap.org/NaN/1/2.png',
    'https://tile.openstreetmap.org/error.png', 'data:image/png;base64,AA=='])(
    'does not invent a usable level from %s', (source) => {
      expect(readLeafletTileZoom(tiles(source))).toBeNaN();
    },
  );
  it('does not turn an empty map into a valid zero baseline', () => {
    expect(readLeafletTileZoom([])).toBeNaN();
    expect(readLeafletTileZoom(tiles(tile(0)))).toBe(0);
  });
  it('still requires a higher actual level to demonstrate pinch zoom', () => {
    const before = readLeafletTileZoom(tiles(tile(14)));
    expect(readLeafletTileZoom(tiles(tile(14)))).not.toBeGreaterThan(before);
    expect(readLeafletTileZoom(tiles(tile(14), tile(16)))).toBeGreaterThan(before);
  });
});
