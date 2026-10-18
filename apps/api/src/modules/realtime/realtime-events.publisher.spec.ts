import type { RealtimeEvent } from '@homeservicemarketplace/contracts';
import { EventEmitter } from 'node:events';

import type { RealtimeGateway } from './realtime.gateway';
import { RealtimeEventsPublisher } from './realtime-events.publisher';
import { RealtimeEventsController } from './realtime-events.controller';
import { MAX_REALTIME_PAYLOAD_BYTES } from './realtime-socket.adapter';

interface FakeGateway {
  emitToRoom: jest.Mock;
}

function makeGateway(): FakeGateway {
  return { emitToRoom: jest.fn() };
}

function makeEvent(over: Partial<RealtimeEvent> = {}): RealtimeEvent {
  return {
    v: 1,
    type: 'notification.created',
    userId: 'user-1',
    occurredAt: new Date('2026-05-02T10:00:00Z').toISOString(),
    payload: { hello: 'world' },
    ...over,
  } as RealtimeEvent;
}

describe('RealtimeEventsPublisher', () => {
  it('emits a published event to the user-scoped subscriber', () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    const received: RealtimeEvent[] = [];
    const sub = pub.subscribe('user-1').subscribe((e) => received.push(e));

    pub.publish(makeEvent({ userId: 'user-1' }));
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('notification.created');
    sub.unsubscribe();
  });

  it('does NOT cross-deliver events between users', () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    const aReceived: RealtimeEvent[] = [];
    const bReceived: RealtimeEvent[] = [];
    pub.subscribe('user-a').subscribe((e) => aReceived.push(e));
    pub.subscribe('user-b').subscribe((e) => bReceived.push(e));

    pub.publish(makeEvent({ userId: 'user-a' }));
    pub.publish(makeEvent({ userId: 'user-b' }));
    pub.publish(makeEvent({ userId: 'user-b' }));

    expect(aReceived).toHaveLength(1);
    expect(bReceived).toHaveLength(2);
  });

  it('publishFor wraps the envelope with v=1 and an ISO occurredAt', () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    const received: RealtimeEvent[] = [];
    pub.subscribe('user-x').subscribe((e) => received.push(e));

    pub.publishFor('user-x', 'message.created', { id: 'm-1', body: 'hi' });
    expect(received[0]).toMatchObject({
      v: 1,
      type: 'message.created',
      userId: 'user-x',
      payload: { id: 'm-1', body: 'hi' },
    });
    expect(new Date(received[0].occurredAt).toString()).not.toBe('Invalid Date');
  });

  it('teardown removes the listener (no leaks after unsubscribe)', () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    const received: RealtimeEvent[] = [];
    const sub = pub.subscribe('user-1').subscribe((e) => received.push(e));
    sub.unsubscribe();
    pub.publish(makeEvent({ userId: 'user-1' }));
    expect(received).toHaveLength(0);
  });

  it('publish() also fans out to the user:{userId} socket room', () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    pub.publish(makeEvent({ userId: 'user-99' }));
    expect(gw.emitToRoom).toHaveBeenCalledWith(
      'user:user-99',
      expect.objectContaining({ type: 'notification.created', userId: 'user-99' }),
    );
  });

  it('publishToRoom() fans out to the named room with userId=null', () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    pub.publishToRoom('conversation:c-1', 'message.created', { id: 'm-99' });
    expect(gw.emitToRoom).toHaveBeenCalledWith(
      'conversation:c-1',
      expect.objectContaining({ type: 'message.created', userId: null, payload: { id: 'm-99' } }),
    );
  });

  it('publish() never throws even when the gateway emit blows up', () => {
    const gw: FakeGateway = {
      emitToRoom: jest.fn(() => {
        throw new Error('socket dead');
      }),
    };
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    expect(() => pub.publish(makeEvent({ userId: 'user-1' }))).not.toThrow();
  });

  // Sprint 7.6 — actorUserId metadata is hoisted onto the envelope.
  it('publishFor threads `options.actorUserId` onto the envelope', () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    const received: RealtimeEvent[] = [];
    pub.subscribe('user-x').subscribe((e) => received.push(e));

    pub.publishFor('user-x', 'bid.accepted', { id: 'bid-1' }, { actorUserId: 'user-actor' });
    expect(received[0]).toMatchObject({
      type: 'bid.accepted',
      userId: 'user-x',
      actorUserId: 'user-actor',
      payload: { id: 'bid-1' },
    });
    // The same envelope hits the socket room too.
    expect(gw.emitToRoom).toHaveBeenCalledWith(
      'user:user-x',
      expect.objectContaining({ actorUserId: 'user-actor' }),
    );
  });

  it('publishFor defaults envelope.actorUserId to null when no options are provided (backward compatible)', () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    const received: RealtimeEvent[] = [];
    pub.subscribe('user-x').subscribe((e) => received.push(e));

    pub.publishFor('user-x', 'request.available', { requestId: 'r-1' });
    expect(received[0]).toMatchObject({
      type: 'request.available',
      userId: 'user-x',
      actorUserId: null,
    });
  });

  it('publishToRoom threads `options.actorUserId` onto the room envelope', () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    pub.publishToRoom(
      'conversation:c-7',
      'message.created',
      { id: 'm-1' },
      { actorUserId: 'sender-2' },
    );
    expect(gw.emitToRoom).toHaveBeenCalledWith(
      'conversation:c-7',
      expect.objectContaining({
        type: 'message.created',
        userId: null,
        actorUserId: 'sender-2',
      }),
    );
  });
});

describe('R25 realtime event identity and SSE bounds', () => {
  it('uses the same durable creation id on replay even after readAt changed', () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    pub.publishFor('user-1', 'notification.created', {
      id: 'durable-1',
      createdAt: '2026-05-02T10:00:00.000Z',
      readAt: null,
    });
    pub.publishFor('user-1', 'notification.created', {
      id: 'durable-1',
      createdAt: '2026-05-02T10:00:00.000Z',
      readAt: '2026-05-02T10:01:00.000Z',
    });
    const first = gw.emitToRoom.mock.calls[0][1];
    const replay = gw.emitToRoom.mock.calls[1][1];
    expect(first.eventId).toMatch(/^[a-f0-9]{64}$/);
    expect(replay.eventId).toBe(first.eventId);
    expect(first.revision).toBe(Date.parse('2026-05-02T10:00:00.000Z'));
  });

  it('scopes immutable nested message identities to their conversation and recipient channel', () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    const payload = {
      conversationId: 'c-1',
      message: { id: 'm-1', body: 'private', createdAt: '2026-05-02T10:00:00.000Z' },
    };
    pub.publishToRoom('conversation:c-1', 'message.created', payload);
    pub.publishToRoom('conversation:c-1', 'message.created', payload);
    pub.publishToRoom('conversation:c-2', 'message.created', { ...payload, conversationId: 'c-2' });
    expect(gw.emitToRoom.mock.calls[0][1].eventId).toBe(gw.emitToRoom.mock.calls[1][1].eventId);
    expect(gw.emitToRoom.mock.calls[0][1].eventId).not.toBe(gw.emitToRoom.mock.calls[2][1].eventId);
  });

  it('uses a persisted state revision deterministically without treating delivery time as a version', () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    pub.publishFor('user-1', 'booking.status_changed', {
      bookingId: 'b-1',
      to: 'COMPLETED',
      revision: 4,
    });
    pub.publishFor('user-1', 'booking.status_changed', {
      to: 'COMPLETED',
      revision: 4,
      bookingId: 'b-1',
    });
    pub.publishFor('user-1', 'booking.status_changed', { bookingId: 'b-1', to: 'COMPLETED' });
    expect(gw.emitToRoom.mock.calls[0][1].eventId).toBe(gw.emitToRoom.mock.calls[1][1].eventId);
    expect(gw.emitToRoom.mock.calls[0][1].revision).toBe(4);
    expect(gw.emitToRoom.mock.calls[2][1].revision).toBeUndefined();
  });

  it('drops oversized or unserializable payloads before SSE or Redis fan-out', () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    const seen: RealtimeEvent[] = [];
    const subscription = pub.subscribe('user-1').subscribe((event) => seen.push(event));
    pub.publish(makeEvent({ payload: { data: 'x'.repeat(65_537) } }));
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    pub.publish(makeEvent({ payload: cyclic }));
    expect(seen).toEqual([]);
    expect(gw.emitToRoom).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it('registers listeners only on actual subscriptions and enforces per-user connection count', () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    for (let index = 0; index < 100; index++) pub.subscribe('user-1');
    const subscriptions = Array.from({ length: 6 }, () => pub.subscribe('user-1').subscribe());
    const denied = jest.fn();
    pub.subscribe('user-1').subscribe({ error: denied });
    expect(denied).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'REALTIME_CONNECTION_LIMIT' }),
    );
    subscriptions[0].unsubscribe();
    const accepted = pub.subscribe('user-1').subscribe({ error: denied });
    expect(denied).toHaveBeenCalledTimes(1);
    for (const subscription of subscriptions) subscription.unsubscribe();
    accepted.unsubscribe();
  });

  it('checks the original subscriber authority before every SSE event and stops after revocation', async () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    const allowed = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const seen: RealtimeEvent[] = [];
    const error = jest.fn();
    pub.subscribe('user-1', allowed).subscribe({ next: (event) => seen.push(event), error });
    pub.publish(makeEvent());
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toHaveLength(1);
    pub.publish(makeEvent());
    await new Promise((resolve) => setImmediate(resolve));
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'AUTH_INVALID_CREDENTIALS' }),
    );
    expect(seen).toHaveLength(1);
    pub.publish(makeEvent());
    expect(allowed).toHaveBeenCalledTimes(2);
  });

  it('bounds an SSE subscriber whose authorization service has stalled', async () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    let release!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const seen = jest.fn();
    const error = jest.fn();
    pub.subscribe('user-1', () => pending).subscribe({ next: seen, error });
    for (let index = 0; index < 20; index++) pub.publish(makeEvent());
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'REALTIME_BACKPRESSURE' }),
    );
    release(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen).not.toHaveBeenCalled();
  });

  it('bounds aggregate SSE work across separate users while their session authority is stalled', async () => {
    const gw = makeGateway();
    const pub = new RealtimeEventsPublisher(gw as unknown as RealtimeGateway);
    let release!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const subscriptions = Array.from({ length: 32 }, (_, index) => {
      const userId = `user-${index}`;
      const subscription = pub.subscribe(userId, () => pending).subscribe();
      for (let packet = 0; packet < 16; packet++) pub.publish(makeEvent({ userId }));
      return subscription;
    });
    const error = jest.fn();
    pub.subscribe('overflow-user', () => pending).subscribe({ error });
    pub.publish(makeEvent({ userId: 'overflow-user' }));
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'REALTIME_BACKPRESSURE' }),
    );
    expect((pub as unknown as { pendingSse: number }).pendingSse).toBe(512);
    release(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(pub as unknown as { pendingSse: number; pendingSseBytes: number }).toMatchObject({
      pendingSse: 0,
      pendingSseBytes: 0,
    });
    for (const subscription of subscriptions) subscription.unsubscribe();
  });
});

describe('R25 direct SSE response authorization and backpressure', () => {
  const opened: Array<{ destroy(): void }> = [];

  afterEach(() => {
    for (const response of opened.splice(0)) response.destroy();
    jest.useRealTimers();
  });

  function fixture(lifetimeSeconds = 60) {
    const gateway = { emitToRoom: jest.fn(), mayReceiveEvent: jest.fn().mockResolvedValue(true) };
    const publisher = new RealtimeEventsPublisher(gateway as unknown as RealtimeGateway);
    const sessions = { assertSessionActive: jest.fn().mockResolvedValue(undefined) };
    const tokens = {
      verifyAccessToken: jest.fn().mockReturnValue({
        sub: 'user-1',
        sid: 'session-1',
        jti: 'original-jti',
        exp: Math.floor(Date.now() / 1000) + lifetimeSeconds,
      }),
    };
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableLength: 0,
      status: jest.fn(),
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn().mockReturnValue(true),
      destroy: jest.fn(() => {
        response.destroyed = true;
        response.emit('close');
      }),
    });
    opened.push(response);
    const controller = new RealtimeEventsController(
      publisher,
      sessions as never,
      tokens as never,
      gateway as never,
    );
    const user = { id: 'user-1', sessionId: 'session-1', jti: 'original-jti', roles: [] };
    const request = {
      header: (name: string) =>
        name === 'authorization' ? 'Bearer signed-original-token' : undefined,
    };
    const start = () => controller.events(user, request as never, response as never);
    return { gateway, publisher, sessions, tokens, response, controller, user, request, start };
  }

  it('writes correctly framed events only after current recipient and original-session checks', async () => {
    const f = fixture();
    f.start();
    f.publisher.publish(makeEvent());
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.sessions.assertSessionActive).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId: 'session-1',
      jti: 'original-jti',
    });
    expect(f.gateway.mayReceiveEvent).toHaveBeenCalledWith(
      'user-1',
      'user:user-1',
      expect.objectContaining({ eventId: expect.any(String) }),
    );
    expect(f.response.write.mock.calls[0][0]).toBe('retry: 15000\n\n');
    expect(f.response.write.mock.calls[1][0]).toMatch(
      /^id: [a-f0-9]{64}\nevent: notification.created\ndata: \{/,
    );
    expect(f.response.write.mock.calls[1][0]).toMatch(/\n\n$/);
  });

  it('hard-destroys an unwritable response and discards the upstream queue instead of waiting for drain', async () => {
    const f = fixture();
    f.response.write.mockReturnValueOnce(true).mockReturnValueOnce(false);
    f.start();
    f.publisher.publish(makeEvent());
    f.publisher.publish(makeEvent());
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.response.destroy).toHaveBeenCalledTimes(1);
    expect(f.response.write).toHaveBeenCalledTimes(2);
    expect(
      f.publisher as unknown as {
        subscribers: number;
        pendingSse: number;
        pendingSseBytes: number;
      },
    ).toMatchObject({ subscribers: 0, pendingSse: 0, pendingSseBytes: 0 });
    f.response.emit('drain');
    f.publisher.publish(makeEvent());
    expect(f.response.write).toHaveBeenCalledTimes(2);
  });

  it('enforces the response byte budget before adding a frame to an already buffered response', async () => {
    const f = fixture();
    f.start();
    f.response.writableLength = MAX_REALTIME_PAYLOAD_BYTES - 10;
    f.publisher.publish(makeEvent());
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.response.destroy).toHaveBeenCalledTimes(1);
    expect(f.response.write).toHaveBeenCalledTimes(1);
  });

  it('hard-closes on original access expiry while a recipient check is pending and never flushes it later', async () => {
    jest.useFakeTimers();
    const f = fixture(1);
    let release!: (allowed: boolean) => void;
    f.gateway.mayReceiveEvent.mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );
    f.start();
    f.publisher.publish(makeEvent());
    await jest.advanceTimersByTimeAsync(1_001);
    expect(f.response.destroyed).toBe(true);
    release(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(f.sessions.assertSessionActive).not.toHaveBeenCalled();
    expect(f.response.write).toHaveBeenCalledTimes(1);
    expect((f.publisher as unknown as { pendingSse: number }).pendingSse).toBe(0);
  });

  it('blocks a packet if the original session is revoked after its recipient check', async () => {
    const f = fixture();
    f.sessions.assertSessionActive.mockRejectedValue(new Error('revoked'));
    f.start();
    f.publisher.publish(makeEvent());
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.response.destroyed).toBe(true);
    expect(f.response.write).toHaveBeenCalledTimes(1);
    expect(f.sessions.assertSessionActive).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId: 'session-1',
      jti: 'original-jti',
    });
  });

  it('detects idle session revocation on the bounded heartbeat without waiting for a business event', async () => {
    jest.useFakeTimers();
    const f = fixture();
    f.start();
    f.sessions.assertSessionActive.mockRejectedValue(new Error('revoked'));
    await jest.advanceTimersByTimeAsync(10_001);
    expect(f.response.destroyed).toBe(true);
    expect(f.response.write).toHaveBeenCalledTimes(1);
  });

  it('rejects a credential whose original claims no longer match the guarded request before opening the response', () => {
    const f = fixture();
    f.tokens.verifyAccessToken.mockReturnValue({
      sub: 'user-1',
      sid: 'session-1',
      jti: 'another-jti',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(f.start).toThrow();
    expect(f.response.flushHeaders).not.toHaveBeenCalled();
    expect(f.response.write).not.toHaveBeenCalled();
  });
});
