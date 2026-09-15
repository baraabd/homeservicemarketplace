import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// Sprint 09B.29 Phase 5 — the image half of the evidence gate.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
//
// WHY THIS REPLACES A SIGNATURE CHECK
//
// The ledger's first image test read eight bytes and asked whether they were
// the PNG magic number. That refuses a text file renamed `.png` and nothing
// else: it cannot tell a 390x844 capture from a 10x10 one, cannot tell whether
// `diff.png` was produced from the two images beside it, and believes whatever
// ratio the metrics file happens to state.
//
// The attack that mattered was the simplest one. Two genuinely different
// images and a metrics file claiming `diffPixelRatio: 0` — a green cell for a
// screen that does not match the reference at all.
//
// So the ratio is now MEASURED here, from the decoded pixels, and the stored
// number is only ever compared against that measurement. A number in a file is
// a claim; a recomputed ratio is evidence.

/** The only viewport a pixel comparison is geometrically valid at. */
export const CANONICAL_VIEWPORT = { width: 390, height: 844 } as const;

export const MAX_DIFF_PIXEL_RATIO = 0.005;

/**
 * How far a stored metric may sit from the recomputed one.
 *
 * Not zero: a writer may round, and a comparator may count an anti-aliased
 * pixel a shade differently from this one. Small enough that the attack above
 * — claiming 0 for a wholly different image — cannot hide inside it.
 */
const METRIC_AGREEMENT_TOLERANCE = 0.0005;

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

/**
 * Decode a PNG, or return null.
 *
 * A real decode, so a file carrying a correct signature followed by rubbish is
 * refused — as is a truncated capture, which is what a killed run leaves
 * behind.
 */
export function decodePng(bytes: Buffer): DecodedImage | null {
  try {
    const image = PNG.sync.read(bytes);
    if (!image || image.width <= 0 || image.height <= 0) return null;
    return { width: image.width, height: image.height, data: image.data };
  } catch {
    return null;
  }
}

function readAndDecode(file: string): DecodedImage | null {
  try {
    return decodePng(readFileSync(file));
  } catch {
    return null;
  }
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface CanonicalCellVerification {
  readonly ok: boolean;
  /** The ratio this module measured. Null when it could not be measured. */
  readonly recomputedRatio: number | null;
  /** What the metrics file claimed, for the report. */
  readonly storedRatio: number | null;
  readonly problems: readonly string[];
}

/**
 * Verify one canonical cell by decoding and measuring it.
 *
 * Order matters: everything that can be checked is checked, so the report says
 * all of what is wrong rather than only the first thing.
 */
export function verifyCanonicalCell(dir: string): CanonicalCellVerification {
  const problems: string[] = [];

  const expected = readAndDecode(join(dir, 'expected.png'));
  const actual = readAndDecode(join(dir, 'actual.png'));
  const diff = readAndDecode(join(dir, 'diff.png'));

  if (!expected) problems.push('expected.png is missing or not a decodable PNG');
  if (!actual) problems.push('actual.png is missing or not a decodable PNG');
  if (!diff) problems.push('diff.png is missing or not a decodable PNG');

  const metrics = readJson(join(dir, 'metrics.json'));
  let storedRatio: number | null = null;
  if (metrics === null) {
    problems.push('metrics.json is missing or unparseable');
  } else {
    const raw = metrics.diffPixelRatio;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1) {
      storedRatio = raw;
    } else {
      problems.push(`diffPixelRatio is not a finite proportion: ${String(raw)}`);
    }
  }

  // Canonical geometry. A capture at another size is not this comparison.
  for (const [name, image] of [
    ['expected.png', expected],
    ['actual.png', actual],
  ] as const) {
    if (!image) continue;
    if (image.width !== CANONICAL_VIEWPORT.width || image.height !== CANONICAL_VIEWPORT.height) {
      problems.push(
        `${name} is ${image.width}x${image.height}, not the canonical ` +
          `${CANONICAL_VIEWPORT.width}x${CANONICAL_VIEWPORT.height}`,
      );
    }
  }

  if (
    expected &&
    actual &&
    (expected.width !== actual.width || expected.height !== actual.height)
  ) {
    problems.push('expected and actual differ in size and cannot be compared');
  }

  if (diff && expected && (diff.width !== expected.width || diff.height !== expected.height)) {
    problems.push('diff image does not match the size of the pair it claims to describe');
  }

  let recomputedRatio: number | null = null;

  if (expected && actual && expected.width === actual.width && expected.height === actual.height) {
    const { width, height } = expected;
    const output = new PNG({ width, height });
    const changed = pixelmatch(expected.data, actual.data, output.data, width, height, {
      threshold: 0.1,
    });
    recomputedRatio = changed / (width * height);

    if (recomputedRatio > MAX_DIFF_PIXEL_RATIO) {
      problems.push(
        `recomputed diffPixelRatio ${recomputedRatio.toFixed(6)} exceeds ${MAX_DIFF_PIXEL_RATIO}`,
      );
    }

    if (
      storedRatio !== null &&
      Math.abs(storedRatio - recomputedRatio) > METRIC_AGREEMENT_TOLERANCE
    ) {
      problems.push(
        `stored and recomputed ratios disagree: ${storedRatio} vs ${recomputedRatio.toFixed(6)}`,
      );
    }

    // The diff image has to be the diff of THESE two. A blank one filed beside
    // images that differ is the same lie as an understated ratio, drawn
    // instead of written.
    if (diff && diff.width === width && diff.height === height) {
      let marked = 0;
      for (let i = 0; i < diff.data.length; i += 4) {
        const r = diff.data[i];
        const g = diff.data[i + 1];
        const b = diff.data[i + 2];
        // pixelmatch paints differing pixels red/yellow over a dimmed base.
        if (r > 200 && g < 200 && b < 120) marked += 1;
      }
      const markedRatio = marked / (width * height);
      if (changed > 0 && markedRatio === 0) {
        problems.push('diff image marks nothing although the images differ');
      }
    }
  }

  return { ok: problems.length === 0, recomputedRatio, storedRatio, problems };
}
