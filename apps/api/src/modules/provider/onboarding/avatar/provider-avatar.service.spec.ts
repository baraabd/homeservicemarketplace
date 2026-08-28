import { AppError } from '../../../../shared/errors/app-error';
import { AVATAR_KEY_PREFIX, avatarOwnerRef } from './avatar-policy';
import {
  AVATAR_MAX_BYTES,
  ProviderAvatarService,
  mimeForAvatarKey,
} from './provider-avatar.service';

// Sprint 9B.17 — finalize: the only point at which an uploaded object becomes
// a provider's avatar, and the only point at which this server sees the bytes.
//
// Every test here is a refusal the brief names as a release blocker: ownership,
// spoofed MIME, oversized content, cross-user access, and the retry that must
// not turn into a conflict.

const SECRET = 'test-secret-that-is-long-enough-for-hmac';
const USER = 'u-1';
const OTHER = 'u-2';

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const HTML = new Uint8Array(Buffer.from('<!doctype html><script>x</script>', 'utf8'));

const ownKey = (name = 'photo.png') =>
  `${AVATAR_KEY_PREFIX}${avatarOwnerRef(USER, SECRET)}/${name}`;

interface StoredFixture {
  sizeBytes: number;
  head: Uint8Array;
}

function build(
  options: {
    stored?: StoredFixture | null;
    currentImageUrl?: string | null;
    version?: number;
  } = {},
) {
  const { stored = { sizeBytes: 2048, head: PNG }, currentImageUrl = null, version = 3 } = options;

  const view = (imageUrl: string | null) => ({
    version,
    data: { profileImageUrl: imageUrl },
  });

  const storage = {
    presignUpload: jest.fn(),
    readObjectHead: jest.fn(async () => stored),
    publicUrlForKey: jest.fn((key: string) => `https://cdn.test/${key}`),
  };
  const wizard = {
    get: jest.fn(async () => view(currentImageUrl)),
    patchStep: jest.fn(async (_u: string, _s: string, body: { profileImageUrl?: string | null }) =>
      view(body.profileImageUrl ?? null),
    ),
  };
  const config = { get: (k: string) => (k === 'JWT_ACCESS_SECRET' ? SECRET : undefined) };

  const service = new ProviderAvatarService(storage as never, config as never, wizard as never);
  return { service, storage, wizard };
}

async function refusal(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (err) {
    return err as AppError;
  }
  throw new Error('expected a refusal, got none');
}

describe('ProviderAvatarService.finalize — what it accepts', () => {
  it('links an object it owns, whose bytes match the key it minted', async () => {
    const { service, wizard } = build();
    const key = ownKey();

    await service.finalize(USER, { key, version: 3 });

    // Written through the SAME versioned step path as every other field.
    expect(wizard.patchStep).toHaveBeenCalledWith(USER, 'IDENTITY', {
      version: 3,
      profileImageUrl: `https://cdn.test/${key}`,
    });
  });

  it('recomputes the URL from the key rather than trusting one from the client', async () => {
    const { service, storage } = build();
    await service.finalize(USER, { key: ownKey(), version: 3 });
    expect(storage.publicUrlForKey).toHaveBeenCalledWith(ownKey());
  });

  it('reads only a short head, not the whole object', async () => {
    // An avatar route that pulled entire files into memory would be a trivially
    // reachable memory-pressure lever, and on S3 an egress bill.
    const { service, storage } = build();
    await service.finalize(USER, { key: ownKey(), version: 3 });
    const [, byteCount] = storage.readObjectHead.mock.calls[0] as unknown as [string, number];
    expect(byteCount).toBeLessThanOrEqual(64);
  });
});

describe('ProviderAvatarService.finalize — ownership', () => {
  it("REFUSES another provider's key, and never touches storage", async () => {
    const { service, storage, wizard } = build();
    const foreign = `${AVATAR_KEY_PREFIX}${avatarOwnerRef(OTHER, SECRET)}/photo.png`;

    const err = await refusal(() => service.finalize(USER, { key: foreign, version: 3 }));

    expect(err.status).toBe(400);
    // Refused on the key alone: reading first would confirm to a prober that
    // some other provider's object exists.
    expect(storage.readObjectHead).not.toHaveBeenCalled();
    expect(wizard.patchStep).not.toHaveBeenCalled();
  });

  it('REFUSES a key in the restricted evidence namespace', async () => {
    const { service, wizard } = build();
    const err = await refusal(() =>
      service.finalize(USER, { key: 'verification/case-1/passport.png', version: 3 }),
    );
    expect(err.status).toBe(400);
    expect(wizard.patchStep).not.toHaveBeenCalled();
  });

  it('REFUSES a portfolio key belonging to the same user', async () => {
    // Public, and theirs — but not an avatar. Namespaces are not
    // interchangeable just because the owner matches.
    const { service, wizard } = build();
    const err = await refusal(() =>
      service.finalize(USER, { key: 'portfolio/abc/photo.png', version: 3 }),
    );
    expect(err.status).toBe(400);
    expect(wizard.patchStep).not.toHaveBeenCalled();
  });
});

describe('ProviderAvatarService.finalize — what actually landed', () => {
  it('REFUSES when nothing is there', async () => {
    // A dropped PUT must not leave a profile pointing at a 404.
    const { service, wizard } = build({ stored: null });
    const err = await refusal(() => service.finalize(USER, { key: ownKey(), version: 3 }));
    expect(err.status).toBe(400);
    expect(wizard.patchStep).not.toHaveBeenCalled();
  });

  it('REFUSES an object larger than the ceiling, measured by the BACKEND', async () => {
    // The declared size was a claim made at presign; this is the measurement.
    const { service, wizard } = build({
      stored: { sizeBytes: AVATAR_MAX_BYTES + 1, head: PNG },
    });
    const err = await refusal(() => service.finalize(USER, { key: ownKey(), version: 3 }));
    expect(err.status).toBe(400);
    expect(wizard.patchStep).not.toHaveBeenCalled();
  });

  it('REFUSES a SPOOFED type: .png key, JPEG bytes', async () => {
    const { service, wizard } = build({ stored: { sizeBytes: 2048, head: JPEG } });
    const err = await refusal(() =>
      service.finalize(USER, { key: ownKey('photo.png'), version: 3 }),
    );
    expect(err.status).toBe(400);
    expect(wizard.patchStep).not.toHaveBeenCalled();
  });

  it('REFUSES a script payload uploaded to an image key', async () => {
    // The one that matters: this URL is served publicly and cached for a year.
    const { service, wizard } = build({ stored: { sizeBytes: 40, head: HTML } });
    const err = await refusal(() =>
      service.finalize(USER, { key: ownKey('photo.png'), version: 3 }),
    );
    expect(err.status).toBe(400);
    expect(wizard.patchStep).not.toHaveBeenCalled();
  });

  it('accepts JPEG bytes under a .jpg key', async () => {
    const { service, wizard } = build({ stored: { sizeBytes: 2048, head: JPEG } });
    await service.finalize(USER, { key: ownKey('photo.jpg'), version: 3 });
    expect(wizard.patchStep).toHaveBeenCalled();
  });
});

describe('ProviderAvatarService.finalize — retries', () => {
  it('is IDEMPOTENT: re-finalizing the stored avatar is a no-op success', async () => {
    // A dropped response leaves the client unable to tell whether the save
    // landed, and its only sane move is to repeat the request. That repeat must
    // not come back as a 409 about a version it was never told about.
    const key = ownKey();
    const { service, wizard } = build({ currentImageUrl: `https://cdn.test/${key}` });

    const view = await service.finalize(USER, { key, version: 3 });

    expect(wizard.patchStep).not.toHaveBeenCalled();
    expect(view.data.profileImageUrl).toBe(`https://cdn.test/${key}`);
  });

  it('still writes when the stored avatar is a DIFFERENT object (replace)', async () => {
    const { service, wizard } = build({ currentImageUrl: 'https://cdn.test/avatars/old/x.png' });
    await service.finalize(USER, { key: ownKey(), version: 3 });
    expect(wizard.patchStep).toHaveBeenCalled();
  });
});

describe('ProviderAvatarService.remove', () => {
  it('clears the avatar through the same versioned write', async () => {
    const { service, wizard } = build({ currentImageUrl: 'https://cdn.test/avatars/a/b.png' });
    await service.remove(USER, 3);
    expect(wizard.patchStep).toHaveBeenCalledWith(USER, 'IDENTITY', {
      version: 3,
      profileImageUrl: null,
    });
  });

  it('is a no-op when there is nothing to remove', async () => {
    const { service, wizard } = build({ currentImageUrl: null });
    await service.remove(USER, 3);
    expect(wizard.patchStep).not.toHaveBeenCalled();
  });
});

describe('mimeForAvatarKey', () => {
  it.each([
    ['a.jpg', 'image/jpeg'],
    ['a.png', 'image/png'],
    ['a.webp', 'image/webp'],
  ])('maps %s', (name, expected) => {
    expect(mimeForAvatarKey(`avatars/ref/${name}`)).toBe(expected);
  });

  it.each(['a.gif', 'a.mp4', 'a.svg', 'a.pdf', 'noextension'])(
    'returns null for %s, which finalize then refuses',
    (name) => {
      expect(mimeForAvatarKey(`avatars/ref/${name}`)).toBeNull();
    },
  );
});
