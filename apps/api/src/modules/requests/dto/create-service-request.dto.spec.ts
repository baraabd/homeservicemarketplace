import { ValidationPipe } from '@nestjs/common';

import { CreateServiceRequestDto } from './create-service-request.dto';

// R06 — the request-creation wire accepts asset ids and nothing else.
//
// Run through the SAME pipe options main.ts installs globally, because the
// refusal of `mediaUrls` is a property of `forbidNonWhitelisted`, not of a
// decorator on this class.

const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const parse = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: CreateServiceRequestDto });

const base = {
  customServiceText: 'Fix a leaking tap',
  scheduleType: 'ASAP',
  manualAddress: { line1: '1 Test Street', city: 'Aleppo' },
};
const id = (n: number) => `clr06asset${String(n).padStart(15, '0')}`;

describe('CreateServiceRequestDto — attachments (R06)', () => {
  it('accepts a request without attachments', async () => {
    await expect(parse(base)).resolves.toMatchObject({ scheduleType: 'ASAP' });
    await expect(parse({ ...base, mediaAssetIds: [] })).resolves.toMatchObject({
      mediaAssetIds: [],
    });
  });

  it('accepts server-issued asset ids', async () => {
    await expect(parse({ ...base, mediaAssetIds: [id(1), id(2)] })).resolves.toMatchObject({
      mediaAssetIds: [id(1), id(2)],
    });
  });

  it.each([
    ['an external URL', ['https://evil.example/tracker.gif']],
    ['a same-origin file URL', ['http://localhost:4000/v1/media/files/requests/u/x.jpg']],
    ['a URL this server once issued', ['http://localhost:4000/v1/media/files/requests/ref/a.png']],
    ['an asset id in the wrong field', [id(1)]],
    ['a non-array', 'https://evil.example/x.jpg'],
  ])('refuses the legacy mediaUrls field carrying %s', async (_label, mediaUrls) => {
    await expect(parse({ ...base, mediaUrls })).rejects.toMatchObject({ status: 400 });
  });

  it('tolerates an EMPTY legacy mediaUrls list, so a pre-R06 bundle can still post without media', async () => {
    // Rollout compatibility: older web bundles send `mediaUrls: []` on every
    // request. Nothing reads the field; it only must not fail the request.
    await expect(parse({ ...base, mediaUrls: [] })).resolves.toMatchObject({ mediaUrls: [] });
  });

  it.each([
    ['a URL in place of an id', ['https://evil.example/x.jpg']],
    ['a storage key in place of an id', ['requests/abc/def.jpg']],
    ['a path traversal', ['../../../etc/passwd']],
    ['a non-string', [42]],
    ['an object', [{ id: id(1) }]],
    ['a repeated id', [id(1), id(1)]],
    ['more ids than the attachment cap', Array.from({ length: 7 }, (_, i) => id(i))],
    ['a non-array', id(1)],
  ])('refuses %s', async (_label, mediaAssetIds) => {
    await expect(parse({ ...base, mediaAssetIds })).rejects.toMatchObject({ status: 400 });
  });

  it('refuses client-supplied ownership or claim fields', async () => {
    for (const extra of [
      { seekerUserId: 'someone-else' },
      { ownerUserId: 'someone-else' },
      { serviceRequestId: 'another-request' },
    ]) {
      await expect(parse({ ...base, ...extra })).rejects.toMatchObject({ status: 400 });
    }
  });
});
