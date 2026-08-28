// Sprint 9B.17 — rotate, square-crop and shrink a photo before it is uploaded.
//
// NO NEW DEPENDENCY, and that is a decision rather than an omission. The repo
// carries no cropping library, and the brief asks for crop/rotate "where
// existing libraries permit". What the platform permits is a canvas, which is
// what a cropping library would use anyway — and the compression step needs a
// canvas regardless, so the crop is the same draw call with a different source
// rectangle.
//
// WHY COMPRESS AT ALL
//
// A modern phone camera produces 4–12 MB per photo. Rendered as a 40px avatar,
// every one of those bytes is waste: the provider pays for the upload on a
// mobile connection, and every customer who ever loads the profile pays to
// download it. Shrinking to a square that is generous for a retina avatar
// turns a 9 MB upload into tens of kilobytes.
//
// WHAT THIS IS NOT
//
// It is not validation. Everything here runs in the browser, where anything
// can be replaced, so nothing downstream may rely on it: the server re-reads
// the stored object, measures its size and inspects its leading bytes. This
// exists to make a good upload small and correctly oriented, not to make a bad
// one safe.

/** The rendered square. 512 is comfortably sharp for the largest avatar the UI
 *  draws on a 3x display, and small enough that the result is tens of KB. */
export const AVATAR_TARGET_PX = 512;

/** JPEG quality for the re-encode. High enough that skin tones do not band,
 *  low enough that the file is small. */
export const AVATAR_JPEG_QUALITY = 0.85;

/** Refused before any decoding is attempted. Generous — the point is to reject
 *  a video someone renamed, not to second-guess a real photo, which is about
 *  to be shrunk to a few tens of KB anyway. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export type ImageProcessingFailure =
  | 'UNSUPPORTED_TYPE'
  | 'TOO_LARGE'
  | 'DECODE_FAILED'
  | 'ENCODE_FAILED';

export class ImageProcessingError extends Error {
  constructor(readonly code: ImageProcessingFailure) {
    super(code);
    this.name = 'ImageProcessingError';
  }
}

/** What a browser will let a person pick. Wider than what we UPLOAD — a phone
 *  gallery hands back HEIC, and the canvas re-encode is exactly what turns it
 *  into something every browser can render. */
const DECODABLE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
];

export function isDecodableImage(file: { type: string }): boolean {
  return DECODABLE_TYPES.includes(file.type);
}

/**
 * Decode a file into something drawable.
 *
 * `createImageBitmap` with `imageOrientation: 'from-image'` is preferred
 * because it applies the EXIF orientation tag for us. Without it, a photo taken
 * in portrait on a phone decodes sideways — the single most common "the upload
 * is broken" report there is, and one no amount of manual rotation fixes
 * consistently because the tag is still there.
 */
async function decode(file: Blob): Promise<{
  draw: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        draw: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through: some browsers reject the options bag rather than
      // ignoring it, and older ones cannot decode HEIC at all.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new ImageProcessingError('DECODE_FAILED'));
      el.src = url;
    });
    return {
      draw: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err instanceof ImageProcessingError ? err : new ImageProcessingError('DECODE_FAILED');
  }
}

export interface ProcessOptions {
  /** Quarter turns clockwise, as the person pressed them. Normalised, so 5 is
   *  one turn and -1 is three. */
  rotateQuarterTurns?: number;
  targetPx?: number;
}

export interface ProcessedImage {
  blob: Blob;
  /** Always one of the three types the server accepts for an avatar. */
  contentType: 'image/jpeg';
  width: number;
  height: number;
  /** For the preview. The caller owns it and must revoke it. */
  previewUrl: string;
}

/**
 * Rotate, crop to a centred square, downscale, re-encode.
 *
 * The crop is centred rather than interactive. A drag-to-position cropper is a
 * gesture surface of its own and this release does not ship one; a centred
 * square is what a person framing a portrait already expects, and rotation
 * covers the case the centre gets wrong.
 *
 * Always re-encodes to JPEG. The input may be a HEIC that only Safari can
 * render or a PNG screenshot ten times the size it needs to be; normalising
 * means what the server stores and every browser renders is one predictable
 * format, and it is why the finalize check can be as narrow as it is.
 */
export async function processAvatarImage(
  file: File,
  options: ProcessOptions = {},
): Promise<ProcessedImage> {
  if (!isDecodableImage(file)) throw new ImageProcessingError('UNSUPPORTED_TYPE');
  if (file.size > MAX_SOURCE_BYTES) throw new ImageProcessingError('TOO_LARGE');

  const target = options.targetPx ?? AVATAR_TARGET_PX;
  const turns = (((options.rotateQuarterTurns ?? 0) % 4) + 4) % 4;

  const source = await decode(file);
  try {
    if (source.width === 0 || source.height === 0) {
      throw new ImageProcessingError('DECODE_FAILED');
    }

    // The square, taken from the middle of the SHORTER edge.
    const side = Math.min(source.width, source.height);
    const sx = (source.width - side) / 2;
    const sy = (source.height - side) / 2;

    // Never upscale: blowing a 96px image up to 512 invents detail and costs
    // bytes to store the invention.
    const outSide = Math.min(target, side);

    const canvas = document.createElement('canvas');
    canvas.width = outSide;
    canvas.height = outSide;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageProcessingError('ENCODE_FAILED');

    // A white base, because JPEG has no alpha: a transparent PNG would
    // otherwise composite onto black and arrive as a silhouette.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outSide, outSide);

    // Rotate about the centre of the output square. Because the output is
    // square, quarter turns need no width/height swap.
    ctx.translate(outSide / 2, outSide / 2);
    ctx.rotate((turns * Math.PI) / 2);
    ctx.translate(-outSide / 2, -outSide / 2);

    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source.draw, sx, sy, side, side, 0, 0, outSide, outSide);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', AVATAR_JPEG_QUALITY),
    );
    if (!blob) throw new ImageProcessingError('ENCODE_FAILED');

    return {
      blob,
      contentType: 'image/jpeg',
      width: outSide,
      height: outSide,
      previewUrl: URL.createObjectURL(blob),
    };
  } finally {
    source.release();
  }
}
