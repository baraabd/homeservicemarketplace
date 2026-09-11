import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CANONICAL_VIEWPORT,
  decodePng,
  verifyCanonicalCell,
} from '../../../../e2e/phase5-image-verify';

// Sprint 09B.29 Phase 5 — attacking the IMAGE half of the evidence gate.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
//
// The ledger's first image check looked at eight signature bytes. That refuses
// a text file named `.png`, and nothing else. It cannot tell a 390x844 capture
// from a 10x10 one, it cannot tell whether `diff.png` was produced from the two
// images beside it, and it believes whatever ratio the metrics file states.
//
// So the gate now DECODES both images and RECOMPUTES the difference itself.
// These tests are the attacks that forced that: each builds the cheapest
// plausible fake and asserts it is refused. A number in a JSON file is a claim;
// a recomputed ratio is a measurement.

let root: string;

function png(width: number, height: number, fill: [number, number, number, number]): Buffer {
  const image = new PNG({ width, height });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = fill[0];
    image.data[i + 1] = fill[1];
    image.data[i + 2] = fill[2];
    image.data[i + 3] = fill[3];
  }
  return PNG.sync.write(image);
}

/** The diff a real comparator would actually emit for this pair. */
function realDiff(a: PNG, b: PNG): Buffer {
  const out = new PNG({ width: a.width, height: a.height });
  pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.1 });
  return PNG.sync.write(out);
}

const W = CANONICAL_VIEWPORT.width;
const H = CANONICAL_VIEWPORT.height;

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];

/** A cell directory with whatever files the test wants in it. */
function cell(files: Record<string, Buffer | string>): string {
  const dir = join(root, 'cell');
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content as never);
  }
  return dir;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'phase5-img-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('decodePng is a real decoder, not a signature check', () => {
  it('decodes a genuine PNG to its true dimensions', () => {
    const decoded = decodePng(png(12, 7, WHITE));
    expect(decoded).not.toBeNull();
    expect({ width: decoded!.width, height: decoded!.height }).toEqual({ width: 12, height: 7 });
  });

  it('refuses a file carrying the PNG signature but no valid image', () => {
    // Eight correct bytes followed by rubbish. The old signature check passed
    // this; a decoder cannot.
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('not actually an image, just bytes after a good header'),
    ]);
    expect(decodePng(fake)).toBeNull();
  });

  it('refuses a truncated PNG', () => {
    const whole = png(W, H, WHITE);
    expect(decodePng(whole.subarray(0, Math.floor(whole.length / 2)))).toBeNull();
  });
});

describe('the canonical cell must be the canonical size', () => {
  it('refuses images that are not exactly 390x844', () => {
    const dir = cell({
      'expected.png': png(320, 568, WHITE),
      'actual.png': png(320, 568, WHITE),
      'diff.png': png(320, 568, WHITE),
      'metrics.json': JSON.stringify({ diffPixelRatio: 0 }),
    });

    const result = verifyCanonicalCell(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/390x844/);
  });

  it('refuses expected and actual of DIFFERENT sizes, which cannot be compared', () => {
    const dir = cell({
      'expected.png': png(W, H, WHITE),
      'actual.png': png(W, H - 1, WHITE),
      'diff.png': png(W, H, WHITE),
      'metrics.json': JSON.stringify({ diffPixelRatio: 0 }),
    });

    expect(verifyCanonicalCell(dir).ok).toBe(false);
  });
});

describe('the ratio is RECOMPUTED, never believed', () => {
  it('refuses a metrics file that understates a real difference', () => {
    // The attack that matters most: two genuinely different images, and a
    // metrics file claiming they match. The old ledger read the 0 and passed.
    const dir = cell({
      'expected.png': png(W, H, WHITE),
      'actual.png': png(W, H, BLACK),
      'diff.png': png(W, H, WHITE),
      'metrics.json': JSON.stringify({ diffPixelRatio: 0 }),
    });

    const result = verifyCanonicalCell(dir);
    expect(result.ok).toBe(false);
    expect(result.recomputedRatio).toBeGreaterThan(0.9);
    expect(result.problems.join(' ')).toMatch(/recomputed/i);
  });

  it('reports the measured ratio for identical images as zero', () => {
    const dir = cell({
      'expected.png': png(W, H, WHITE),
      'actual.png': png(W, H, WHITE),
      'diff.png': png(W, H, WHITE),
      'metrics.json': JSON.stringify({ diffPixelRatio: 0 }),
    });

    const result = verifyCanonicalCell(dir);
    expect(result.recomputedRatio).toBe(0);
    expect(result.ok).toBe(true);
  });

  it('fails a cell whose real difference exceeds the threshold, whatever the JSON says', () => {
    // One row of 390 pixels differing out of 390*844 is ~0.00118 — under the
    // threshold. Twenty rows is ~0.0237, over it.
    const expected = new PNG({ width: W, height: H });
    expected.data.fill(255);
    const actual = new PNG({ width: W, height: H });
    actual.data.fill(255);
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 4;
        actual.data[i] = 0;
        actual.data[i + 1] = 0;
        actual.data[i + 2] = 0;
      }
    }

    const dir = cell({
      'expected.png': PNG.sync.write(expected),
      'actual.png': PNG.sync.write(actual),
      'diff.png': png(W, H, WHITE),
      'metrics.json': JSON.stringify({ diffPixelRatio: 0.0001 }),
    });

    const result = verifyCanonicalCell(dir);
    expect(result.recomputedRatio).toBeGreaterThan(0.005);
    expect(result.ok).toBe(false);
  });

  it('accepts a genuine difference that is within the threshold', () => {
    const expected = new PNG({ width: W, height: H });
    expected.data.fill(255);
    const actual = new PNG({ width: W, height: H });
    actual.data.fill(255);
    // 300 pixels of 329,160 is ~0.00091.
    for (let i = 0; i < 300; i += 1) {
      const p = i * 4;
      actual.data[p] = 0;
      actual.data[p + 1] = 0;
      actual.data[p + 2] = 0;
    }

    const dir = cell({
      'expected.png': PNG.sync.write(expected),
      'actual.png': PNG.sync.write(actual),
      // The diff a real comparator emits, because that is what a genuinely
      // passing cell contains.
      'diff.png': realDiff(expected, actual),
      'metrics.json': JSON.stringify({ diffPixelRatio: 300 / (W * H) }),
    });

    const result = verifyCanonicalCell(dir);
    expect(result.recomputedRatio).toBeGreaterThan(0);
    expect(result.recomputedRatio).toBeLessThanOrEqual(0.005);
    expect(result.ok).toBe(true);
  });

  it('refuses a stored metric that disagrees with the recomputation', () => {
    // The images genuinely match, but the metrics file claims a difference.
    // Either the file is stale or the run was not the one that produced these
    // images; both are reasons to refuse.
    const dir = cell({
      'expected.png': png(W, H, WHITE),
      'actual.png': png(W, H, WHITE),
      'diff.png': png(W, H, WHITE),
      'metrics.json': JSON.stringify({ diffPixelRatio: 0.004 }),
    });

    const result = verifyCanonicalCell(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/disagree/i);
  });
});

describe('the diff image must be the diff of THESE two images', () => {
  it('refuses a diff whose size does not match the pair', () => {
    const dir = cell({
      'expected.png': png(W, H, WHITE),
      'actual.png': png(W, H, WHITE),
      'diff.png': png(10, 10, WHITE),
      'metrics.json': JSON.stringify({ diffPixelRatio: 0 }),
    });

    expect(verifyCanonicalCell(dir).ok).toBe(false);
  });

  it('refuses a blank diff when the images genuinely differ', () => {
    const expected = new PNG({ width: W, height: H });
    expected.data.fill(255);
    const actual = new PNG({ width: W, height: H });
    actual.data.fill(255);
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 4;
        actual.data[i] = 0;
      }
    }

    const dir = cell({
      'expected.png': PNG.sync.write(expected),
      'actual.png': PNG.sync.write(actual),
      // A diff that marks nothing, beside images that differ on 20 rows.
      'diff.png': png(W, H, WHITE),
      'metrics.json': JSON.stringify({ diffPixelRatio: 0.0237 }),
    });

    const result = verifyCanonicalCell(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/diff image/i);
  });
});

describe('missing pieces are refused, not defaulted', () => {
  it('refuses a cell with no metrics at all', () => {
    const dir = cell({
      'expected.png': png(W, H, WHITE),
      'actual.png': png(W, H, WHITE),
      'diff.png': png(W, H, WHITE),
    });
    expect(verifyCanonicalCell(dir).ok).toBe(false);
  });

  it('refuses a cell with no images at all', () => {
    const dir = cell({ 'metrics.json': JSON.stringify({ diffPixelRatio: 0 }) });
    expect(verifyCanonicalCell(dir).ok).toBe(false);
  });
});
