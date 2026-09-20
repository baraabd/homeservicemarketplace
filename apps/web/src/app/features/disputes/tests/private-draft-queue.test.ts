import { describe, expect, it, vi } from 'vitest';
import type { DisputeDraftContent, DisputeDraftView } from '@homeservicemarketplace/contracts';
import { PrivateDraftQueue, type DraftTransport } from '../workspace/private-draft-queue';
const empty: DisputeDraftContent = { issueCode: '', requestedOutcome: '', statement: '', step: 0 };
const initial: DisputeDraftView = { version: 0, content: empty, savedAt: null, expiresAt: null };
const a = { ...empty, statement: 'Unsent private statement A' };
const b = { ...empty, statement: 'Unsent private statement B' };
function ack(packet: { version: number; content: DisputeDraftContent }): DisputeDraftView {
  return {
    version: packet.version + 1,
    content: packet.content,
    savedAt: '2026-09-20T10:00:00Z',
    expiresAt: '2026-09-21T10:00:00Z',
  };
}
function setup(overrides: Partial<DraftTransport> = {}) {
  const transport = {
    save: vi.fn(async (p) => ack(p)),
    read: vi.fn(async () => initial),
    ...overrides,
  };
  return { transport, q: new PrivateDraftQueue(initial, transport) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
describe('Private draft acknowledged revision queue', () => {
  it('never creates an empty draft or calls a disabled endpoint', async () => {
    const { q, transport } = setup();
    expect(await q.flush()).toBe(true);
    expect(transport.save).not.toHaveBeenCalled();
    expect(q.getSnapshot().state).toBe('empty');
    const disabled = new PrivateDraftQueue(undefined, transport);
    disabled.update(a, false);
    expect(await disabled.flush()).toBe(true);
    expect(transport.save).not.toHaveBeenCalled();
  });
  it('never says saved before the exact backend acknowledgement', async () => {
    const wait = deferred<DisputeDraftView>();
    const { q } = setup({ save: () => wait.promise });
    q.update(a, false);
    const pending = q.flush();
    expect(q.getSnapshot()).toMatchObject({ state: 'saving', unsaved: true, busy: true });
    await Promise.resolve();
    wait.resolve(ack({ version: 0, content: a }));
    expect(await pending).toBe(true);
    expect(q.getSnapshot()).toMatchObject({ state: 'saved', unsaved: false, busy: false });
  });
  it('serializes typing during a save and shares the same flush promise', async () => {
    const wait = deferred<DisputeDraftView>();
    const save = vi
      .fn()
      .mockImplementationOnce(() => wait.promise)
      .mockImplementation(async (p) => ack(p));
    const { q } = setup({ save });
    q.update(a, false);
    const pending = q.flush();
    expect(q.flush()).toBe(pending);
    await Promise.resolve();
    q.update(b, false);
    wait.resolve(ack({ version: 0, content: a }));
    expect(await pending).toBe(true);
    expect(save.mock.calls.map(([p]) => p)).toEqual([
      { version: 0, content: a },
      { version: 1, content: b },
    ]);
  });
  it('replays a lost acknowledgement packet before sending a subsequent edit', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (p) => ack(p));
    const { q } = setup({ save });
    q.update(a, false);
    expect(await q.flush()).toBe(false);
    q.update(b, false);
    expect(q.getSnapshot().state).toBe('error');
    expect(await q.flush()).toBe(true);
    expect(save.mock.calls.map(([p]) => p)).toEqual([
      { version: 0, content: a },
      { version: 0, content: a },
      { version: 1, content: b },
    ]);
  });
  it('also resolves a lost packet after the user types back to the original value', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (p) => ack(p));
    const { q } = setup({ save });
    q.update(a, false);
    await q.flush();
    q.update(empty, false);
    expect(q.getSnapshot().unsaved).toBe(true);
    expect(await q.flush()).toBe(true);
    expect(save.mock.calls[2][0]).toEqual({ version: 1, content: empty });
  });
  it('halts on conflict until a deliberate reload, without overwriting local prose', async () => {
    const save = vi.fn().mockRejectedValue({ response: { status: 409 } });
    const current = { ...ack({ version: 5, content: b }) };
    const { q } = setup({ save, read: async () => current });
    q.update(a, false);
    expect(await q.flush()).toBe(false);
    expect(await q.flush()).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(q.getSnapshot()).toMatchObject({ state: 'conflict', unsaved: true });
    expect(await q.reload()).toEqual(b);
    expect(q.getSnapshot()).toMatchObject({ state: 'saved', unsaved: false });
  });
  it('retains pending prose when an explicit reload fails', async () => {
    const { q } = setup({
      read: async () => {
        throw new Error('offline');
      },
    });
    q.update(a, false);
    expect(await q.reload()).toBeNull();
    expect(q.getSnapshot()).toMatchObject({ state: 'error', unsaved: true });
    expect(await q.flush()).toBe(true);
  });
  it('rejects mismatched content or revision acknowledgements', async () => {
    const { q } = setup({ save: async (p) => ({ ...ack(p), version: 99 }) });
    q.update(a, false);
    expect(await q.flush()).toBe(false);
    expect(q.getSnapshot()).toMatchObject({ state: 'error', unsaved: true });
  });
  it('pauses new writes on lost authority and stops follow-up work after unmount', async () => {
    const wait = deferred<DisputeDraftView>();
    const save = vi.fn(() => wait.promise);
    const { q } = setup({ save });
    q.update(a, true);
    expect(await q.flush()).toBe(false);
    expect(save).not.toHaveBeenCalled();
    q.update(a, false);
    const first = q.flush();
    await Promise.resolve();
    q.update(b, false);
    q.setActive(false);
    wait.resolve(ack({ version: 0, content: a }));
    expect(await first).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(q.getSnapshot().unsaved).toBe(true);
  });
});
