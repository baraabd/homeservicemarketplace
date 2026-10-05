import type { Readable } from 'node:stream';
import { ALLOWED_IMAGE_TYPES, isAllowedContentType } from './content-type';
import { verifyMediaSignature } from './media-signature';
import type { StoragePort } from './storage.port';

export const PORTFOLIO_MAX_DECODE_BYTES = 10 * 1024 * 1024;
export const PORTFOLIO_MAX_DECODE_PIXELS = 16_000_000;
const STORAGE_READ_TIMEOUT_MS = 5_000;

export class PortfolioImageValidationError extends Error {
  constructor() {
    super('The stored portfolio image could not be validated.');
    this.name = 'PortfolioImageValidationError';
  }
}

export class PortfolioImageDecoderUnavailableError extends Error {
  constructor() {
    super('Portfolio image validation is temporarily unavailable.');
    this.name = 'PortfolioImageDecoderUnavailableError';
  }
}

export class PortfolioImageStorageUnavailableError extends Error {
  constructor() {
    super('Portfolio image storage is temporarily unavailable. Please try again.');
    this.name = 'PortfolioImageStorageUnavailableError';
  }
}

/** Validate the whole immutable object, not only a plausible image header.
 * Bytes and decoded pixels are bounded; no output is saved and no metadata
 * leaves this function. Call outside database transactions and their locks. */
export async function validateStoredPortfolioImage(
  storage: StoragePort,
  input: { storageKey: string; contentType: string; sizeBytes: number; maxBytes?: number },
): Promise<string> {
  const maxBytes = Math.min(
    input.maxBytes ?? PORTFOLIO_MAX_DECODE_BYTES,
    PORTFOLIO_MAX_DECODE_BYTES,
  );
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > maxBytes ||
    !isAllowedContentType(input.contentType) ||
    !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(input.contentType)
  )
    throw new PortfolioImageValidationError();

  const bytes = await readBoundedImage(storage, input.storageKey, input.sizeBytes);
  const signature = verifyMediaSignature(input.contentType, bytes.subarray(0, 32));
  if (!signature.ok) throw new PortfolioImageValidationError();
  let sharp: (typeof import('sharp'))['default'];
  try {
    sharp = (await import('sharp')).default;
  } catch {
    throw new PortfolioImageDecoderUnavailableError();
  }
  try {
    // Lazy loading keeps ordinary API startup and denied reads independent
    // from the native decoder. metadata() alone does not decode pixel data.
    const image = sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: PORTFOLIO_MAX_DECODE_PIXELS,
      animated: true,
    }).timeout({ seconds: 3 });
    const metadata = await image.metadata();
    if (metadata.channels > 4) throw new PortfolioImageValidationError();
    const decoded = await image.raw().toBuffer({ resolveWithObject: true });
    if (
      decoded.info.width < 1 ||
      decoded.info.height < 1 ||
      decoded.info.width * decoded.info.height > PORTFOLIO_MAX_DECODE_PIXELS ||
      decoded.data.byteLength === 0
    )
      throw new PortfolioImageValidationError();
  } catch {
    throw new PortfolioImageValidationError();
  }
  return signature.detected;
}

async function readBoundedImage(
  storage: StoragePort,
  storageKey: string,
  expectedBytes: number,
): Promise<Buffer> {
  let stream: Readable | null = null;
  let expired = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    stream = await storage.readObjectStream(storageKey);
    if (expired) {
      stream?.destroy();
      throw new PortfolioImageStorageUnavailableError();
    }
    if (!stream) throw new PortfolioImageValidationError();
    const chunks: Buffer[] = [];
    let sizeBytes = 0;
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) throw new PortfolioImageValidationError();
      const bytes = Buffer.from(chunk);
      sizeBytes += bytes.byteLength;
      // Stop on overflow, before retaining the extra chunk or decoding it.
      if (sizeBytes > expectedBytes) throw new PortfolioImageValidationError();
      chunks.push(bytes);
    }
    if (sizeBytes !== expectedBytes) throw new PortfolioImageValidationError();
    return Buffer.concat(chunks, sizeBytes);
  };
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => {
          expired = true;
          stream?.destroy();
          reject(new PortfolioImageStorageUnavailableError());
        }, STORAGE_READ_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    // Only proven absence or invalid bytes require a replacement. A failed
    // transport cannot tell us whether the immutable image itself is valid.
    if (
      error instanceof PortfolioImageValidationError ||
      error instanceof PortfolioImageStorageUnavailableError
    )
      throw error;
    throw new PortfolioImageStorageUnavailableError();
  } finally {
    if (deadline) clearTimeout(deadline);
    // A storage response arriving after the deadline is destroyed in read().
    // An opened response belongs to this attempt, regardless of its outcome.
    (stream as Readable | null)?.destroy();
  }
}
