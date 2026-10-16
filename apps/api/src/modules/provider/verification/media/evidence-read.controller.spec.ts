import { Readable } from 'node:stream';
import type { Request, Response } from 'express';

import type { RestrictedObjectStoragePort } from '../../../../infrastructure/storage/restricted-object-storage.port';
import type { AuthenticatedUser } from '../../../iam/authentication/types/authenticated-user';
import type { PermissionResolverService } from '../../../iam/authorization/services/permission-resolver.service';
import { EvidenceReadController } from './evidence-read.controller';
import type { EvidenceReadService } from './evidence-read.service';

function fixture(error?: Error) {
  const grant = {
    storageKey: 'verification/synthetic-case/synthetic-document.pdf',
    sizeBytes: 7,
    detectedMimeType: 'application/pdf',
    displayFilename: 'synthetic.pdf',
  };
  const headers = new Map<string, string>();
  const stream = Readable.from(['fixture']);
  const pipe = jest.spyOn(stream, 'pipe').mockReturnValue({} as NodeJS.WritableStream);
  const openReadStream = jest.fn(async () => {
    expect(headers.has('Content-Type')).toBe(false);
    expect(headers.has('Content-Disposition')).toBe(false);
    if (error) throw error;
    return stream;
  });
  const controller = new EvidenceReadController(
    { authorizeRead: jest.fn().mockResolvedValue(grant) } as unknown as EvidenceReadService,
    {
      resolveFreshForUser: jest.fn().mockResolvedValue(new Set()),
    } as unknown as PermissionResolverService,
    { openReadStream } as unknown as RestrictedObjectStoragePort,
  );
  const res = {
    setHeader: (key: string, value: string) => headers.set(key, value),
    destroy: jest.fn(),
  };
  const invoke = () =>
    controller.content(
      { id: 'synthetic-owner' } as AuthenticatedUser,
      'synthetic-document',
      { headers: {}, ip: '127.0.0.1' } as Request,
      res as unknown as Response,
    );
  return { grant, headers, openReadStream, pipe, invoke };
}

describe('restricted read storage boundary (G1 / CR-R20-01)', () => {
  it('checks the recorded size before attaching document headers or streaming', async () => {
    const f = fixture();
    await f.invoke();
    expect(f.openReadStream).toHaveBeenCalledWith(f.grant.storageKey, { sizeBytes: 7 });
    expect(f.headers.get('Content-Type')).toBe('application/pdf');
    expect(f.headers.get('Content-Disposition')).toContain('attachment');
    expect(f.headers.get('Cache-Control')).toContain('no-store');
    expect(f.pipe).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'unavailable', 'size-mismatch'])(
    'refuses %s with no document headers or bytes',
    async (reason) => {
      const f = fixture(new Error(reason));
      await expect(f.invoke()).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Document not found.',
      });
      expect(f.headers.has('Content-Type')).toBe(false);
      expect(f.headers.has('Content-Disposition')).toBe(false);
      expect(f.headers.get('Cache-Control')).toContain('no-store');
      expect(f.pipe).not.toHaveBeenCalled();
    },
  );
});
