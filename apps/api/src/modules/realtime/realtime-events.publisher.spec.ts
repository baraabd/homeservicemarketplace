import type { RealtimeEvent } from '@homeservicemarketplace/contracts';

import type { RealtimeGateway } from './realtime.gateway';
import { RealtimeEventsPublisher } from './realtime-events.publisher';

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
