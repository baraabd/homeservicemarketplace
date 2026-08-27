import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';

import { api } from '../../../../lib/api';
import { downloadEvidenceDocument, filenameFromDisposition } from './evidence-download';

// Sprint 9B.12 — opening a restricted identity document.
//
// Two properties are worth a test here, and neither is "it downloads":
//
//   1. The request goes through the authenticated client at the ONE route that
//      serves restricted evidence. A bare link to the object store would work
//      in a demo and silently skip the audit.
//   2. The object URL is released. Holding one open keeps the bytes of someone
//      else's passport alive in the page for as long as the tab lives, which is
//      the lifetime the streaming design exists to avoid.

let mock: MockAdapter;
let created: string[];
let revoked: string[];
let clicks: Array<{ href: string; download: string }>;

beforeEach(() => {
  mock = new MockAdapter(api);
  created = [];
  revoked = [];
  clicks = [];

  // jsdom implements neither, and a real navigation to blob: would be
  // "Not implemented" noise rather than a signal.
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => {
      const url = `blob:mock-${created.length}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
  });

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push({ href: this.href, download: this.download });
  });

  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  mock.restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('filenameFromDisposition', () => {
  it('prefers the RFC 5987 form, which is the one that survives Arabic names', () => {
    const header = 'attachment; filename="_.pdf"; filename*=UTF-8\'\'%D9%87%D9%88%D9%8A%D8%A9.pdf';
    expect(filenameFromDisposition(header)).toBe('هوية.pdf');
  });

  it('falls back to the quoted form', () => {
    expect(filenameFromDisposition('attachment; filename="passport.jpg"')).toBe('passport.jpg');
  });

  it('falls back again when the escape is malformed rather than throwing', () => {
    // A bad percent-escape is not worth failing a download over.
    const header = 'attachment; filename="passport.jpg"; filename*=UTF-8\'\'%E0%A4%A';
    expect(filenameFromDisposition(header)).toBe('passport.jpg');
  });

  it('returns null when there is nothing to read', () => {
    expect(filenameFromDisposition(undefined)).toBeNull();
    expect(filenameFromDisposition('attachment')).toBeNull();
    expect(filenameFromDisposition('attachment; filename=""')).toBeNull();
  });
});

describe('downloadEvidenceDocument', () => {
  it('asks the audited evidence route through the authenticated client', async () => {
    // Not the object store, and not a signed URL: this route is the only one
    // that serves restricted evidence, and it is the one that writes the audit.
    let url: string | undefined;
    let responseType: string | undefined;
    mock.onGet(/verification\/documents/).reply((config) => {
      url = config.url;
      responseType = config.responseType;
      return [200, 'bytes', { 'content-disposition': 'attachment; filename="passport.jpg"' }];
    });

    await downloadEvidenceDocument('doc-1');

    expect(url).toBe('/v1/verification/documents/doc-1/content');
    expect(responseType).toBe('blob');
  });

  it('names the saved file what the server said to call it', async () => {
    mock
      .onGet(/verification\/documents/)
      .reply(200, 'bytes', { 'content-disposition': 'attachment; filename="passport.jpg"' });

    await downloadEvidenceDocument('doc-1');

    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toBe('passport.jpg');
  });

  it('falls back to the document id when the server sent no name', async () => {
    mock.onGet(/verification\/documents/).reply(200, 'bytes');

    await downloadEvidenceDocument('doc-1');

    expect(clicks[0].download).toBe('doc-1');
  });

  it('releases the object URL', async () => {
    mock.onGet(/verification\/documents/).reply(200, 'bytes');

    await downloadEvidenceDocument('doc-1');
    // Released one task later, not inline — a synchronous revoke can cancel a
    // download the browser has not finished handing off.
    expect(revoked).toEqual([]);
    vi.runAllTimers();

    expect(revoked).toEqual(created);
    expect(created).toHaveLength(1);
  });

  it('leaves no anchor behind in the document', async () => {
    mock.onGet(/verification\/documents/).reply(200, 'bytes');

    await downloadEvidenceDocument('doc-1');

    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('rejects on a denial so the caller can say the attempt was recorded', async () => {
    // The server answers a denial and a missing document identically, on
    // purpose. This layer must not pretend to know which happened.
    mock.onGet(/verification\/documents/).reply(404);

    await expect(downloadEvidenceDocument('doc-1')).rejects.toMatchObject({
      response: { status: 404 },
    });
    expect(clicks).toHaveLength(0);
  });

  it('escapes the document id into the path', async () => {
    let url: string | undefined;
    mock.onGet(/verification\/documents/).reply((config) => {
      url = config.url;
      return [200, 'bytes'];
    });

    await downloadEvidenceDocument('a/../b');

    expect(url).toBe('/v1/verification/documents/a%2F..%2Fb/content');
  });
});
