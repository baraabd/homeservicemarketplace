import type { AppConfigService } from '../../config/app-config.service';
import type { LocalDiskStorageAdapter } from './local-disk-storage.adapter';
import type { LocalDiskRestrictedStorageAdapter } from './local-disk-restricted-storage.adapter';

jest.mock('./s3-storage.adapter', () => {
  throw new Error('public S3 adapter must not load for local storage');
});
jest.mock('./s3-restricted-storage.adapter', () => {
  throw new Error('restricted S3 adapter must not load for local storage');
});

import { selectPublicStorage, selectRestrictedStorage } from './storage.module';

describe('StorageModule local startup boundary', () => {
  const config = {
    get: jest.fn((key: string) => (key === 'STORAGE_DRIVER' ? 'local' : undefined)),
  } as unknown as AppConfigService;

  it('returns the local public adapter without loading the AWS-backed adapter', async () => {
    const local = {} as LocalDiskStorageAdapter;
    await expect(selectPublicStorage(config, local)).resolves.toBe(local);
  });

  it('returns the local restricted adapter without loading the AWS-backed adapter', async () => {
    const local = {} as LocalDiskRestrictedStorageAdapter;
    await expect(selectRestrictedStorage(config, local)).resolves.toBe(local);
  });
});
