import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../api', () => ({ api: { post: vi.fn() } }));
import { putAvatarBytes } from './provider-avatar-api';
afterEach(() => vi.unstubAllGlobals());
describe('avatar write-once upload', () => {
  it.each([200, 412])('sends the signed precondition and handles status %i', async (status) => {
    const xhr = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      upload: {},
      status,
      onload: null as (() => void) | null,
      send: vi.fn(() => xhr.onload?.()),
    };
    vi.stubGlobal('XMLHttpRequest', function Upload() {
      return xhr;
    });
    const promise = putAvatarBytes(
      new Blob(['synthetic'], { type: 'image/png' }),
      'https://storage.example.test/avatar',
    );
    if (status === 200) await expect(promise).resolves.toBeUndefined();
    else await expect(promise).rejects.toThrow('upload-failed-412');
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('If-None-Match', '*');
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
  });
});
