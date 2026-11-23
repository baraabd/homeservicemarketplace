import { describe, expect, it, vi } from 'vitest';

const animate = () =>
  document.createElement('div').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 10_000 });

describe('Happy DOM WAAPI cancellation compatibility', () => {
  it('cancels without an observer and without an unhandled rejection', async () => {
    const animation = animate();
    animation.cancel();
    // Let rejection reporting run. Vitest must still fail on any unhandled error.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(animation.playState).toBe('idle');
    expect(animation.currentTime).toBeNull();
  });

  it('preserves AbortError for a consumer awaiting the original finished promise', async () => {
    const animation = animate();
    const finished = animation.finished;
    animation.cancel();
    await expect(finished).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not mark an idle animation promise handled', () => {
    const animation = new Animation();
    const observer = vi.spyOn(animation.finished, 'catch');
    animation.cancel();
    expect(observer).not.toHaveBeenCalled();
    expect(animation.playState).toBe('idle');
    observer.mockRestore();
  });

  it('preserves normal completion and its finish event', async () => {
    const animation = animate();
    const onFinish = vi.fn();
    animation.addEventListener('finish', onFinish);
    animation.finish();
    await expect(animation.finished).resolves.toBe(animation);
    expect(onFinish).toHaveBeenCalledOnce();
    expect(animation.playState).toBe('finished');
    animation.cancel();
  });
});
