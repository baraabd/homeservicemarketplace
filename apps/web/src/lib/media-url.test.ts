import { describe, expect, it } from 'vitest';

import { resolveMediaUrl } from './media-url';

const BASE = 'http://localhost:4000';

describe('resolveMediaUrl', () => {
  it('returns empty string for nullish / empty input', () => {
    expect(resolveMediaUrl(null, BASE)).toBe('');
    expect(resolveMediaUrl(undefined, BASE)).toBe('');
    expect(resolveMediaUrl('', BASE)).toBe('');
    expect(resolveMediaUrl('   ', BASE)).toBe('');
  });

  it('passes through an absolute http(s) URL unchanged (no double-prefix)', () => {
    const abs = 'https://cdn.example.com/v1/media/files/abc.jpg';
    expect(resolveMediaUrl(abs, BASE)).toBe(abs);
    const absApi = 'http://localhost:4000/v1/media/files/abc.jpg';
    expect(resolveMediaUrl(absApi, BASE)).toBe(absApi);
  });

  it('passes through data: and blob: URLs unchanged', () => {
    expect(resolveMediaUrl('data:image/png;base64,AAAA', BASE)).toBe('data:image/png;base64,AAAA');
    expect(resolveMediaUrl('blob:http://localhost:4000/uuid', BASE)).toBe(
      'blob:http://localhost:4000/uuid',
    );
  });

  it('passes through protocol-relative URLs unchanged', () => {
    expect(resolveMediaUrl('//cdn.example.com/a.jpg', BASE)).toBe('//cdn.example.com/a.jpg');
  });

  it('prefixes a root-relative API path with the base URL', () => {
    expect(resolveMediaUrl('/v1/media/files/requests/u1/a.jpg', BASE)).toBe(
      'http://localhost:4000/v1/media/files/requests/u1/a.jpg',
    );
  });

  it('expands a bare storage key into the file-serve route', () => {
    expect(resolveMediaUrl('requests/u1/a.jpg', BASE)).toBe(
      'http://localhost:4000/v1/media/files/requests/u1/a.jpg',
    );
  });

  it('does not double the slash when base has a trailing slash', () => {
    expect(resolveMediaUrl('/v1/media/files/a.jpg', 'http://localhost:4000/')).toBe(
      'http://localhost:4000/v1/media/files/a.jpg',
    );
  });
});
