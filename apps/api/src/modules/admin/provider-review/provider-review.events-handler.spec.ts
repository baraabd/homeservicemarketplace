import { AdminProviderReviewEventsHandler } from './provider-review.events-handler';

it('publishes the already-persisted notification only after outbox commit', async () => {
  const realtime = { publishFor: jest.fn() };
  const handler = new AdminProviderReviewEventsHandler(realtime as never);
  const createdAt = new Date('2026-09-15T12:00:00Z');
  const tx = {
    notification: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'n1',
        userId: 'provider-1',
        type: 'SYSTEM',
        title: 'Application needs changes',
        body: 'Open your application.',
        resourceType: 'REVIEW',
        resourceId: 'profile-1',
        deepLink: '/provider/onboarding',
        metadata: null,
        readAt: null,
        createdAt,
      }),
    },
  };
  const result = await handler.handle(
    { payload: { notificationId: 'n1', actorUserId: 'admin-1' } } as never,
    tx as never,
  );
  expect(realtime.publishFor).not.toHaveBeenCalled();
  await result?.afterCommit?.();
  expect(realtime.publishFor).toHaveBeenCalledWith(
    'provider-1',
    'notification.created',
    expect.objectContaining({ id: 'n1', createdAt: createdAt.toISOString() }),
    { actorUserId: 'admin-1' },
  );
});
