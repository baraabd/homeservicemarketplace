/** Test-only DOM observation. Self-contained so Playwright can serialize it. */
export function readLeafletTileZoom(tiles: Element[]): number {
  const levels: number[] = [];
  for (const tile of tiles) {
    try {
      const url = new URL(tile.getAttribute('src') ?? '');
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      const match = /^\/(\d+)\/\d+\/\d+\.png$/.exec(url.pathname);
      if (!match) continue;
      const zoom = Number(match[1]);
      if (Number.isSafeInteger(zoom)) levels.push(zoom);
    } catch {
      // A retired/detached tile can have an empty or non-URL source.
    }
  }
  // No real tile is NOT zoom zero. Readiness must fail closed until a valid
  // sample exists; callers must not begin a gesture with an invalid baseline.
  return levels.length ? Math.max(...levels) : Number.NaN;
}
