import { ALLOWED_CONTENT_TYPES, type ContentType } from './content-type';
import {
  MEDIA_SIGNATURE_PROBE_BYTES,
  detectMediaType,
  verifyMediaSignature,
} from './media-signature';

// R06 — the stored bytes decide the type, not the declaration.

const pad = (bytes: number[]): Uint8Array => {
  const out = new Uint8Array(MEDIA_SIGNATURE_PROBE_BYTES);
  out.set(bytes);
  return out;
};
const ascii = (text: string): number[] => [...text].map((ch) => ch.charCodeAt(0));
const ftyp = (brand: string): Uint8Array => pad([0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii(brand)]);

const SAMPLES: Record<ContentType, Uint8Array> = {
  'image/jpeg': pad([0xff, 0xd8, 0xff, 0xe0]),
  'image/png': pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/webp': pad([...ascii('RIFF'), 0x10, 0, 0, 0, ...ascii('WEBP')]),
  'image/gif': pad(ascii('GIF89a')),
  'image/heic': ftyp('heic'),
  'image/heif': ftyp('mif1'),
  'video/mp4': ftyp('isom'),
  'video/quicktime': ftyp('qt  '),
  'video/webm': pad([0x1a, 0x45, 0xdf, 0xa3]),
};

describe('media signature detection', () => {
  it('has a sample for every allowed content type', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...ALLOWED_CONTENT_TYPES].sort());
  });

  it.each([...ALLOWED_CONTENT_TYPES])('accepts genuine %s bytes declared as %s', (type) => {
    expect(verifyMediaSignature(type, SAMPLES[type])).toEqual({ ok: true, detected: type });
  });

  it('refuses bytes of one type declared as another', () => {
    // The classic disguise: a PNG, or anything else, uploaded as a JPEG.
    expect(verifyMediaSignature('image/jpeg', SAMPLES['image/png'])).toEqual({
      ok: false,
      detected: 'image/png',
    });
    expect(verifyMediaSignature('image/png', SAMPLES['video/mp4']).ok).toBe(false);
    expect(verifyMediaSignature('video/mp4', SAMPLES['image/heic']).ok).toBe(false);
    expect(verifyMediaSignature('video/mp4', SAMPLES['video/quicktime']).ok).toBe(false);
  });

  it('refuses content that is not media at all', () => {
    const html = pad(ascii('<!doctype html><script>'));
    const executable = pad([0x4d, 0x5a, 0x90, 0x00]);
    const svg = pad(ascii('<svg xmlns="http://www.w3'));
    for (const bytes of [html, executable, svg, new Uint8Array(0)]) {
      expect(detectMediaType(bytes, 'image/jpeg')).toBeNull();
      expect(verifyMediaSignature('image/jpeg', bytes)).toEqual({ ok: false, detected: null });
    }
  });

  it('does not let the declaration pick a different signature family', () => {
    // `declared` only chooses between HEIC and HEIF, which share brands.
    expect(detectMediaType(SAMPLES['image/png'], 'image/heif')).toBe('image/png');
    expect(detectMediaType(ftyp('heic'), 'image/heif')).toBe('image/heif');
    expect(detectMediaType(ftyp('heic'), 'video/mp4')).toBe('image/heic');
  });

  it('refuses an ISO-BMFF image brand that is not on the allowlist', () => {
    expect(detectMediaType(ftyp('avif'), 'image/heic')).toBeNull();
    expect(verifyMediaSignature('video/mp4', ftyp('avif')).ok).toBe(false);
  });

  it('refuses a truncated or malformed GIF header', () => {
    expect(detectMediaType(pad(ascii('GIF8')), 'image/gif')).toBeNull();
    expect(detectMediaType(pad(ascii('GIF88a')), 'image/gif')).toBeNull();
  });
});
