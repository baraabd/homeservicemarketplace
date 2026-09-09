import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

// Sprint 09B.29 — parity evidence for every case, not only the failures.
//
// Playwright writes `-expected` / `-actual` / `-diff` artefacts when a snapshot
// FAILS and nothing at all when it passes. That is the wrong way round for an
// acceptance gate: "2 passed" is not evidence, it is a claim, and the sprint
// mandate asks for reference, actual, diff and a machine-readable number for
// all four comparisons.
//
// So each capture is recorded here as well: the reference it was compared
// against, the actual bytes, a diff image, and the measured ratio — whatever
// the verdict. The pixel work runs on a canvas in the page that is already
// open, so it adds no dependency.
//
// This RECORDS; it does not decide. `toMatchSnapshot` remains the gate, at the
// threshold the contract names.

export interface ParityMeasurement {
  name: string;
  dims: string;
  totalPixels: number;
  differingPixels: number;
  /** Differing pixels over total, at the same >24 channel-sum threshold the
   *  region tool uses. Stricter than Playwright's antialiasing-aware compare,
   *  so it reads slightly higher and never flatters the implementation. */
  ratio: number;
  /** Where the difference is, in the shell's fixed vertical structure. */
  regions: { header: number; progress: number; content: number; sticky: number };
  textEdgePixels: number;
  clusteredPixels: number;
}

/**
 * Compare one capture against its stored reference and write the artefacts.
 *
 * `referencePath` is the snapshot the gate compares against, so the numbers
 * here describe the same comparison the gate made.
 */
export async function recordParityEvidence(
  page: Page,
  opts: { name: string; actual: Buffer; referencePath: string; outDir: string },
): Promise<ParityMeasurement> {
  const { name, actual, referencePath, outDir } = opts;
  mkdirSync(outDir, { recursive: true });

  const { readFileSync } = await import('node:fs');
  const expected = readFileSync(referencePath);

  const measured = await page.evaluate(
    async ([expB64, actB64]) => {
      const load = (b64: string) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = `data:image/png;base64,${b64}`;
        });
      const [re, ac] = await Promise.all([load(expB64), load(actB64)]);
      const w = Math.min(re.width, ac.width);
      const h = Math.min(re.height, ac.height);
      const pixels = (img: HTMLImageElement) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d')!.drawImage(img, 0, 0);
        return c.getContext('2d')!.getImageData(0, 0, w, h);
      };
      const A = pixels(re).data;
      const B = pixels(ac).data;

      // The diff image: the reference, greyed back, with differences in red.
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d')!;
      const img = ctx.createImageData(w, h);

      const mask = new Uint8Array(w * h);
      let total = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const d =
            Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
          if (d > 24) {
            mask[y * w + x] = 1;
            total++;
            img.data[i] = 255;
            img.data[i + 1] = 0;
            img.data[i + 2] = 0;
            img.data[i + 3] = 255;
          } else {
            const grey = 255 - (255 - (A[i] * 0.299 + A[i + 1] * 0.587 + A[i + 2] * 0.114)) * 0.25;
            img.data[i] = grey;
            img.data[i + 1] = grey;
            img.data[i + 2] = grey;
            img.data[i + 3] = 255;
          }
        }
      }
      ctx.putImageData(img, 0, 0);

      const band = (y0: number, y1: number) => {
        let c = 0;
        for (let y = Math.max(0, y0); y < Math.min(y1, h); y++)
          for (let x = 0; x < w; x++) c += mask[y * w + x];
        return c;
      };

      let isolated = 0;
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          if (!mask[y * w + x]) continue;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              if (!(dx === 0 && dy === 0) && mask[(y + dy) * w + (x + dx)]) n++;
          if (n <= 2) isolated++;
        }

      return {
        dims: `${w}x${h}`,
        totalPixels: w * h,
        differingPixels: total,
        ratio: +(total / (w * h)).toFixed(5),
        regions: {
          header: band(0, 64),
          progress: band(64, 68),
          content: band(68, h - 79),
          sticky: band(h - 79, h),
        },
        textEdgePixels: isolated,
        clusteredPixels: total - isolated,
        diffPng: out.toDataURL('image/png'),
      };
    },
    [expected.toString('base64'), actual.toString('base64')] as const,
  );

  const { diffPng, ...metrics } = measured;
  copyFileSync(referencePath, join(outDir, `${name}-expected.png`));
  writeFileSync(join(outDir, `${name}-actual.png`), actual);
  writeFileSync(join(outDir, `${name}-diff.png`), Buffer.from(diffPng.split(',')[1], 'base64'));

  return { name, ...metrics };
}

/**
 * Write the collected measurements as one machine-readable record.
 *
 * The filename carries the worker index. `afterAll` runs once PER WORKER, so
 * with more than one worker a fixed name would be written several times and
 * the survivor would hold one worker's subset while looking like the whole
 * run — an artefact that is worse than none, because it reads as complete.
 */
export function writeParityReport(outDir: string, measurements: ParityMeasurement[]): void {
  mkdirSync(outDir, { recursive: true });
  const worker = process.env.TEST_WORKER_INDEX ?? '0';
  writeFileSync(
    join(outDir, `visual-parity.worker-${worker}.json`),
    JSON.stringify(
      {
        threshold: 0.005,
        capturedAt: new Date().toISOString(),
        workerIndex: worker,
        cases: measurements,
      },
      null,
      2,
    ),
  );
}
