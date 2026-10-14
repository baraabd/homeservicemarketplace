// R27 — pure graph arithmetic over a captured Rollup bundle.
//
// The capture (bundle-report.mjs) records, per emitted chunk, its static
// imports, dynamic imports, CSS and the rendered byte length of every source
// module inside it. Everything here is deterministic over that record, so it
// is unit-tested without running a build.
//
// "Initial" means what the browser must fetch before the entry module can
// execute: the entry chunks, their transitive STATIC imports and the CSS
// those chunks import. A dynamic import's cost is its increment: the chunks
// its static closure adds beyond what is already loaded.

/** Transitive static-import closure of `roots` (chunk file names). */
export function staticClosure(chunks, roots) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    const chunk = chunks[name];
    if (!chunk) throw new Error(`unknown chunk in graph: ${name}`);
    seen.add(name);
    for (const dep of chunk.imports) stack.push(dep);
  }
  return seen;
}

export function entryChunks(chunks) {
  return Object.keys(chunks)
    .filter((name) => chunks[name].isEntry)
    .sort();
}

export function initialChunkSet(chunks) {
  return staticClosure(chunks, entryChunks(chunks));
}

/** Chunks a dynamic import adds beyond `loaded`. */
export function increment(chunks, root, loaded) {
  const closure = staticClosure(chunks, [root]);
  return new Set([...closure].filter((name) => !loaded.has(name)));
}

/** CSS files imported by a set of chunks, without duplicates. */
export function cssOf(chunks, set) {
  const css = new Set();
  for (const name of set) for (const file of chunks[name].css ?? []) css.add(file);
  return css;
}

const ZERO = () => ({ raw: 0, gzip: 0, brotli: 0 });

/** Sum transfer sizes of chunks plus their CSS. */
export function sizeOf(chunks, assets, set) {
  const total = { js: ZERO(), css: ZERO(), files: set.size };
  for (const name of set) addInto(total.js, chunks[name].sizes);
  const css = cssOf(chunks, set);
  for (const file of css) addInto(total.css, assets[file]?.sizes ?? ZERO());
  total.files += css.size;
  return total;
}

function addInto(target, sizes) {
  target.raw += sizes.raw;
  target.gzip += sizes.gzip;
  target.brotli += sizes.brotli;
}

/**
 * Attribute a source module id to a package or an application area.
 * pnpm paths look like .../node_modules/.pnpm/<store>/node_modules/<pkg>/...;
 * the LAST node_modules segment names the package that owns the file.
 */
export function ownerOf(moduleId) {
  const id = moduleId.replace(/\\/g, '/').replace(/^\0/, '');
  const marker = '/node_modules/';
  const at = id.lastIndexOf(marker);
  if (at >= 0) {
    const rest = id.slice(at + marker.length).split('/');
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  const src = id.indexOf('/apps/web/src/');
  if (src >= 0) {
    const parts = id.slice(src + '/apps/web/src/'.length).split('/');
    return `web:${parts.slice(0, Math.min(parts.length - 1, 3)).join('/') || parts[0]}`;
  }
  if (id.includes('/packages/contracts/')) return 'workspace:contracts';
  return id.startsWith('vite/') || id.includes('vite/preload-helper') ? 'vite:runtime' : 'other';
}

/** Rendered (pre-compression) bytes per owner across a chunk set. */
export function attribute(chunks, set) {
  const byOwner = new Map();
  for (const name of set) {
    for (const [id, length] of Object.entries(chunks[name].modules)) {
      const owner = ownerOf(id);
      byOwner.set(owner, (byOwner.get(owner) ?? 0) + length);
    }
  }
  return [...byOwner.entries()]
    .map(([owner, renderedBytes]) => ({ owner, renderedBytes }))
    .sort((a, b) => b.renderedBytes - a.renderedBytes || a.owner.localeCompare(b.owner));
}

/** Rendered bytes of modules matching `pattern` across a chunk set. */
export function bytesMatching(chunks, set, pattern) {
  let total = 0;
  for (const name of set) {
    for (const [id, length] of Object.entries(chunks[name].modules)) {
      if (pattern.test(id)) total += length;
    }
  }
  return total;
}

/** Which chunks contain a module whose id matches `pattern`. */
export function chunksContaining(chunks, pattern) {
  return Object.keys(chunks)
    .filter((name) => Object.keys(chunks[name].modules).some((id) => pattern.test(id)))
    .sort();
}

/**
 * The chunk a dynamic import of `suffix` resolves to.
 *
 * Usually that chunk's facade is the module. When Rollup merges a small
 * dynamic entry into a chunk shared with other modules, the facade differs;
 * the import then targets the dynamically imported chunk that CONTAINS the
 * module, which is the same chunk the browser fetches.
 */
export function dynamicEntryFor(chunks, suffix) {
  const wanted = suffix.replace(/\\/g, '/');
  const facades = Object.keys(chunks).filter((name) =>
    (chunks[name].facadeModuleId ?? '').replace(/\\/g, '/').endsWith(wanted),
  );
  if (facades.length > 1) throw new Error(`ambiguous facade ${suffix}: ${facades.join(', ')}`);
  if (facades.length === 1) return facades[0];
  const targets = new Set(Object.values(chunks).flatMap((c) => c.dynamicImports));
  const holders = [...targets].filter((name) =>
    Object.keys(chunks[name]?.modules ?? {}).some((id) => id.endsWith(`/${wanted}`)),
  );
  if (holders.length > 1) throw new Error(`ambiguous lazy holder ${suffix}: ${holders.join(', ')}`);
  return holders[0] ?? null;
}
