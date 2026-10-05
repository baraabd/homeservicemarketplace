import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  api: { post: vi.fn(), defaults: { baseURL: 'https://api.example.test/' } },
  getCsrfToken: () => 'csrf-fixture',
}));

import { api } from '../api';
import { uploadEvidence } from './provider-verification-api';

function installUploadResponse(status: number) {
  const xhr = {
    open: vi.fn(),
    setRequestHeader: vi.fn(),
    upload: {},
    status,
    withCredentials: false,
    onload: null as (() => void) | null,
    send: vi.fn((_file: File) => xhr.onload?.()),
  };
  vi.stubGlobal('XMLHttpRequest', function UploadRequest() {
    return xhr;
  });
  return xhr;
}

describe('restricted identity upload client', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('preserves the uploaded display filename while using the authenticated restricted pipeline', async () => {
    const file = new File(['synthetic png'], 'identity-front.png', { type: 'image/png' });
    const xhr = installUploadResponse(200);
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: { assetId: 'asset-1' } })
      .mockResolvedValueOnce({
        data: { documentId: 'document-1', assetId: 'asset-1', scanState: 'PENDING' },
      });

    const result = await uploadEvidence({ file, kind: 'INDIVIDUAL_IDENTITY' });
    expect(api.post).toHaveBeenNthCalledWith(1, '/v1/me/provider/verification/evidence/prepare', {
      kind: 'INDIVIDUAL_IDENTITY',
      serviceCategoryId: null,
      declaredMimeType: 'image/png',
      sizeBytes: file.size,
      filename: file.name,
    });
    expect(xhr.open).toHaveBeenCalledWith(
      'PUT',
      'https://api.example.test/v1/me/provider/verification/evidence/asset-1/content',
      true,
    );
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('X-CSRF-Token', 'csrf-fixture');
    expect(xhr.send).toHaveBeenCalledWith(file);
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      '/v1/me/provider/verification/evidence/asset-1/finalize',
      {},
    );
    expect(result).toMatchObject({ documentId: 'document-1', scanState: 'PENDING' });
  });

  it('does not finalize or claim success when the authenticated byte upload is refused', async () => {
    installUploadResponse(403);
    vi.mocked(api.post).mockResolvedValueOnce({ data: { assetId: 'asset-1' } });
    await expect(
      uploadEvidence({
        file: new File(['synthetic png'], 'identity.png', { type: 'image/png' }),
        kind: 'INDIVIDUAL_IDENTITY',
      }),
    ).rejects.toThrow('upload failed: 403');
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
