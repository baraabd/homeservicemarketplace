import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./api', () => ({ api: { post: vi.fn() } }));
import { api } from './api';
import { uploadAll, uploadFileToPresignedUrl } from './media-api';

const file = () => new File(['synthetic-bytes'], 'photo.png', { type: 'image/png' });
const reservations = (count: number) => Array.from({ length: count }, (_, i) => ({
  uploadUrl: `https://storage.example.test/${i}?signature=synthetic`,
  fileUrl: `https://cdn.example.test/${i}.png`,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
}));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('S05 request upload orchestration', () => {
  it('returns no partial success when the API returns too few reservations', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { items: reservations(1) } });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(uploadAll([file(), file()])).rejects.toThrow(/count/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('omits browser credentials/referrer and refuses redirects on signed PUT', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const selected = file();
    await uploadFileToPresignedUrl(selected, 'https://storage.example.test/put');
    expect(fetch).toHaveBeenCalledWith('https://storage.example.test/put', expect.objectContaining({
      method: 'PUT', body: selected, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    }));
  });
  it('aborts pending peers after one PUT fails rather than leaving uncontrolled work', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { items: reservations(2) } });
    let peerAborted = false;
    vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => {
      if (url.includes('/0?')) return Promise.resolve(new Response(null, { status: 500 }));
      return new Promise<Response>((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => {
          peerAborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      });
    }));
    await expect(uploadAll([file(), file()])).rejects.toThrow('HTTP 500');
    expect(peerAborted).toBe(true);
  });
  it('returns URLs in file order only when every PUT succeeds', async () => {
    const items = reservations(2);
    vi.mocked(api.post).mockResolvedValue({ data: { items } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(uploadAll([file(), file()])).resolves.toEqual(items.map((item) => item.fileUrl));
  });
  it('refuses unsupported/empty media or a cancelled batch before calling the API', async () => {
    await expect(uploadAll([new File(['x'], 'page.html', { type: 'text/html' })])).rejects.toThrow(/limits/);
    await expect(uploadAll([new File([], 'empty.png', { type: 'image/png' })])).rejects.toThrow(/limits/);
    const controller = new AbortController(); controller.abort();
    await expect(uploadAll([file()], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.post).not.toHaveBeenCalled();
  });
  it('does not expose a signed URL from a transport exception', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('https://storage.test/?secret=private'); }));
    await expect(uploadFileToPresignedUrl(file(), 'https://storage.test/put')).rejects.toThrow('Media upload could not reach storage.');
  });
});
