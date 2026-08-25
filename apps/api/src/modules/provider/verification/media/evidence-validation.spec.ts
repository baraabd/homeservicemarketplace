import {
  validateEvidenceBytes,
  extensionForFilename,
  type EvidenceValidationCode,
} from './evidence-validation';

// Sprint 9B.4 — the validation that happens BEFORE a scanner is asked anything.
//
// A scanner answers "is this malicious?". It does not answer "is this the kind
// of file we agreed to accept, intact, and honestly labelled?" — and those are
// the questions that stop a reviewer being handed a truncated PDF, or a PDF
// wearing a .png extension in the review UI.
//
// Every rule here fails CLOSED: anything not positively recognised as an
// allowed, intact, honestly-named evidence file is refused.

const PDF_HEAD = Buffer.from('%PDF-1.4\n');
const PDF_TAIL = Buffer.from('\ntrailer\n%%EOF\n');
const pdf = (body = 'evidence body') => Buffer.concat([PDF_HEAD, Buffer.from(body), PDF_TAIL]);

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const png = () => Buffer.concat([PNG_HEAD, Buffer.from('IHDRdata'), PNG_IEND]);

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);
const jpeg = () => Buffer.concat([JPEG_HEAD, Buffer.from('exifdata'), JPEG_EOI]);

const MAX = 10 * 1024 * 1024;

function check(over: Partial<Parameters<typeof validateEvidenceBytes>[0]> = {}) {
  return validateEvidenceBytes({
    declaredMime: 'application/pdf',
    filename: 'passport.pdf',
    bytes: pdf(),
    maxBytes: MAX,
    ...over,
  });
}

function codeOf(v: ReturnType<typeof validateEvidenceBytes>): EvidenceValidationCode | 'OK' {
  return v.ok ? 'OK' : v.code;
}

describe('validateEvidenceBytes — the accepted shapes', () => {
  it('accepts a well-formed PDF', () => {
    const v = check();
    expect(v.ok).toBe(true);
    expect(v.ok && v.detected).toBe('application/pdf');
  });

  it('accepts a well-formed PNG', () => {
    const v = check({ declaredMime: 'image/png', filename: 'id.png', bytes: png() });
    expect(v.ok).toBe(true);
    expect(v.ok && v.detected).toBe('image/png');
  });

  it('accepts a well-formed JPEG under either extension', () => {
    for (const name of ['id.jpg', 'id.jpeg', 'ID.JPEG']) {
      const v = check({ declaredMime: 'image/jpeg', filename: name, bytes: jpeg() });
      expect(codeOf(v)).toBe('OK');
    }
  });

  it('accepts a file with no extension at all', () => {
    // The filename is display-only. Its ABSENCE tells us nothing dishonest,
    // and refusing it would reject a legitimate upload from a client that
    // never had a name to send.
    expect(codeOf(check({ filename: 'scan-of-passport' }))).toBe('OK');
  });

  it('accepts a null filename', () => {
    expect(codeOf(check({ filename: null }))).toBe('OK');
  });
});

describe('validateEvidenceBytes — format and honesty', () => {
  it('refuses a type outside the evidence allowlist', () => {
    // SVG is a script container; it is on the PUBLIC media allowlist and must
    // never be on this one.
    expect(codeOf(check({ declaredMime: 'image/svg+xml' }))).toBe('DISALLOWED_FORMAT');
  });

  it('refuses bytes it does not positively recognise', () => {
    expect(codeOf(check({ bytes: Buffer.from('just some text, honestly') }))).toBe(
      'UNRECOGNISED_FORMAT',
    );
  });

  it('refuses an executable declared as a PDF', () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0x20)]);
    expect(codeOf(check({ bytes: exe }))).toBe('UNRECOGNISED_FORMAT');
  });

  it('refuses bytes that disagree with the declared type', () => {
    expect(codeOf(check({ declaredMime: 'image/png', filename: 'x.png', bytes: pdf() }))).toBe(
      'DECLARED_TYPE_MISMATCH',
    );
  });

  it('refuses an extension that disagrees with what the bytes are', () => {
    // The bytes and the declaration agree; only the NAME lies. Harmless as a
    // file, dishonest in a review UI that shows the name next to the document.
    expect(codeOf(check({ filename: 'passport.png' }))).toBe('EXTENSION_MISMATCH');
  });

  it('judges the LAST extension, so a double extension cannot hide one', () => {
    expect(codeOf(check({ filename: 'passport.pdf.exe' }))).toBe('EXTENSION_MISMATCH');
    expect(codeOf(check({ filename: 'passport.exe.pdf' }))).toBe('OK');
  });
});

describe('validateEvidenceBytes — size', () => {
  it('refuses an empty file', () => {
    expect(codeOf(check({ bytes: Buffer.alloc(0) }))).toBe('EMPTY');
  });

  it('refuses a file over the ceiling', () => {
    expect(codeOf(check({ maxBytes: 8 }))).toBe('TOO_LARGE');
  });

  it('accepts a file exactly ON the ceiling', () => {
    // An off-by-one here rejects a legitimate maximum-size upload, which reads
    // to the provider as an unexplained failure.
    const body = pdf();
    expect(codeOf(check({ bytes: body, maxBytes: body.length }))).toBe('OK');
  });

  it('checks size before format, so a huge unrecognised blob is cheap to refuse', () => {
    expect(codeOf(check({ bytes: Buffer.alloc(64, 0x41), maxBytes: 8 }))).toBe('TOO_LARGE');
  });
});

describe('validateEvidenceBytes — truncated and malformed', () => {
  it('refuses a PDF with no EOF marker', () => {
    // The signature still matches: a truncated upload looks exactly like a
    // valid one from its first five bytes.
    expect(codeOf(check({ bytes: Buffer.concat([PDF_HEAD, Buffer.from('body')]) }))).toBe(
      'TRUNCATED',
    );
  });

  it('refuses a PNG with no IEND chunk', () => {
    const cut = Buffer.concat([PNG_HEAD, Buffer.from('IHDRdata')]);
    expect(codeOf(check({ declaredMime: 'image/png', filename: 'id.png', bytes: cut }))).toBe(
      'TRUNCATED',
    );
  });

  it('refuses a JPEG with no end-of-image marker', () => {
    const cut = Buffer.concat([JPEG_HEAD, Buffer.from('exifdata')]);
    expect(codeOf(check({ declaredMime: 'image/jpeg', filename: 'id.jpg', bytes: cut }))).toBe(
      'TRUNCATED',
    );
  });

  it('refuses a file that is only a header', () => {
    expect(codeOf(check({ bytes: PDF_HEAD }))).toBe('TRUNCATED');
  });

  it('finds the PDF EOF marker even with trailing whitespace after it', () => {
    // Real writers pad. Requiring %%EOF to be the final bytes would reject
    // valid documents.
    const padded = Buffer.concat([pdf(), Buffer.from('\n\r\n   \n')]);
    expect(codeOf(check({ bytes: padded }))).toBe('OK');
  });

  it('does not scan the whole file for the marker', () => {
    // A marker far from the end is not an end marker. Bounding the search also
    // keeps validation O(window) rather than O(file).
    const misleading = Buffer.concat([PDF_HEAD, Buffer.from('%%EOF'), Buffer.alloc(4096, 0x41)]);
    expect(codeOf(check({ bytes: misleading }))).toBe('TRUNCATED');
  });
});

describe('validateEvidenceBytes — ordering', () => {
  it('reports the DISALLOWED type rather than the truncation', () => {
    // One reason per rejection, and the most fundamental one wins: telling a
    // caller their SVG is truncated invites them to send a longer SVG.
    expect(codeOf(check({ declaredMime: 'image/svg+xml', bytes: Buffer.alloc(0) }))).toBe('EMPTY');
    expect(codeOf(check({ declaredMime: 'image/svg+xml', bytes: PDF_HEAD }))).toBe(
      'DISALLOWED_FORMAT',
    );
  });

  it('never returns a detected type on a failure', () => {
    const v = check({ bytes: Buffer.from('nope') });
    expect(v.ok).toBe(false);
    expect(v).not.toHaveProperty('detected');
  });
});

describe('extensionForFilename', () => {
  it('returns the lowercased final extension', () => {
    expect(extensionForFilename('A.PDF')).toBe('pdf');
    expect(extensionForFilename('a.b.c.PnG')).toBe('png');
  });

  it('returns null when there is no extension', () => {
    expect(extensionForFilename('passport')).toBeNull();
    expect(extensionForFilename('')).toBeNull();
    expect(extensionForFilename(null)).toBeNull();
  });

  it('ignores a leading dot, which is a hidden file and not an extension', () => {
    expect(extensionForFilename('.gitignore')).toBeNull();
  });

  it('strips directory components before looking', () => {
    expect(extensionForFilename('../../etc/passwd.pdf')).toBe('pdf');
  });
});
