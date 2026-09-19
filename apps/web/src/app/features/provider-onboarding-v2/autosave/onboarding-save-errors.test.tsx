import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import MockAdapter from 'axios-mock-adapter';
import type { ProviderOnboardingStep } from '@homeservicemarketplace/contracts';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import {
  ProviderOnboardingAutosaveProvider,
  useOnboardingAutosave,
} from './ProviderOnboardingAutosaveProvider';

const PATCH = /\/onboarding\/steps\/([A-Z_]+)$/;
let mock: MockAdapter;
let client: QueryClient;
let coordinator: ReturnType<typeof useOnboardingAutosave>;

function Probe() {
  const current = useOnboardingAutosave();
  useEffect(() => {
    coordinator = current;
  }, [current]);
  return (
    <>
      <output data-testid="location-status">{current.statusOf('LOCATION').kind}</output>
      <output data-testid="location-dirty">{String(current.isDirtyStep('LOCATION'))}</output>
    </>
  );
}

beforeEach(() => {
  mock = new MockAdapter(api);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(providerQueryKeys.onboarding.draft(), { version: 1 });
  render(
    <QueryClientProvider client={client}>
      <ProviderOnboardingAutosaveProvider>
        <Probe />
      </ProviderOnboardingAutosaveProvider>
    </QueryClientProvider>,
  );
});

afterEach(() => {
  mock.restore();
  client.clear();
});

describe('rejected onboarding writes', () => {
  it.each([400, 401, 403, 404, 422])(
    '%s stays pending without being resent by navigation, online events or identical edits',
    async (status) => {
      mock.onPatch(PATCH).reply(status, { code: 'VALIDATION_ERROR' });
      await act(async () => {
        coordinator.save('LOCATION', { serviceAreaCity: 'Test city' });
        expect((await coordinator.flushAll()).ok).toBe(false);
      });
      expect(mock.history.patch).toHaveLength(1);

      await act(async () => {
        expect((await coordinator.flushAll()).ok).toBe(false);
        window.dispatchEvent(new Event('online'));
        coordinator.save('LOCATION', { serviceAreaCity: 'Test city' });
        expect((await coordinator.flushAll()).ok).toBe(false);
      });

      expect(mock.history.patch).toHaveLength(1);
      expect(screen.getByTestId('location-status')).toHaveTextContent('error');
      expect(screen.getByTestId('location-dirty')).toHaveTextContent('true');
      expect(coordinator.hasPendingWork).toBe(true);
    },
  );

  it('saves a different step without retrying a rejected step or permitting exit', async () => {
    const steps: string[] = [];
    mock.onPatch(PATCH).reply((config) => {
      const step = config.url!.split('/').at(-1)!;
      steps.push(step);
      return step === 'LOCATION' ? [400, {}] : [200, { version: 2 }];
    });
    await act(async () => {
      coordinator.save('LOCATION', { serviceAreaCity: 'Test city' });
      await coordinator.flushAll();
      coordinator.save('IDENTITY', { displayName: 'Updated name' });
      expect((await coordinator.flushAll()).ok).toBe(false);
    });
    expect(steps).toEqual(['LOCATION', 'IDENTITY']);
    expect(coordinator.statusOf('IDENTITY').kind).toBe('saved');
    expect(coordinator.statusOf('LOCATION').kind).toBe('error');
  });

  it('releases a corrected step, retaining the other fields from the rejected edit', async () => {
    mock.onPatch(PATCH).replyOnce(400, {});
    await act(async () => {
      coordinator.save('LOCATION', { serviceAreaCity: 'Test city', serviceAreaCountryCode: 'IQ' });
      await coordinator.flushAll();
    });
    mock.onPatch(PATCH).reply(200, { version: 2 });
    await act(async () => {
      coordinator.save('LOCATION', { serviceAreaCountryCode: 'SE' });
      expect(await coordinator.flushAll()).toEqual({ ok: true });
    });
    expect(mock.history.patch).toHaveLength(2);
    expect(JSON.parse(mock.history.patch[1].data)).toEqual({
      version: 1,
      serviceAreaCity: 'Test city',
      serviceAreaCountryCode: 'SE',
    });
    expect(coordinator.hasPendingWork).toBe(false);
  });

  it('the explicit retry action sends a held revision once', async () => {
    mock.onPatch(PATCH).reply(400, {});
    await act(async () => {
      coordinator.save('LOCATION', { serviceAreaCity: 'Test city' });
      await coordinator.flushAll();
    });
    await act(async () => {
      const status = coordinator.statusOf('LOCATION');
      if (status.kind !== 'error') throw new Error('Expected a rejected save');
      status.retry();
      await coordinator.flushAll();
    });
    expect(mock.history.patch).toHaveLength(2);
  });

  it('an older rejected request cannot hold back a correction made while it was in flight', async () => {
    let release!: (response: [number, object]) => void;
    mock.onPatch(PATCH).replyOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    mock.onPatch(PATCH).reply(200, { version: 2 });
    let flushing!: ReturnType<typeof coordinator.flushAll>;
    await act(async () => {
      coordinator.save('LOCATION', { serviceAreaCountryCode: 'IQ' });
      flushing = coordinator.flushAll();
    });
    expect(mock.history.patch).toHaveLength(1);
    await act(async () => {
      coordinator.save('LOCATION', { serviceAreaCountryCode: 'SE' });
      release([400, {}]);
      await flushing;
      expect(await coordinator.flushAll()).toEqual({ ok: true });
    });
    expect(JSON.parse(mock.history.patch.at(-1)!.data).serviceAreaCountryCode).toBe('SE');
    expect(coordinator.statusOf('LOCATION').kind).toBe('saved');
  });

  it('an in-flight step remains dirty until the server acknowledges it', async () => {
    let release!: (response: [number, object]) => void;
    mock.onPatch(PATCH).reply(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let flushing!: ReturnType<typeof coordinator.flushAll>;
    await act(async () => {
      coordinator.save('LOCATION' satisfies ProviderOnboardingStep, {
        serviceAreaCity: 'Test city',
      });
      flushing = coordinator.flushAll();
    });
    expect(screen.getByTestId('location-status')).toHaveTextContent('saving');
    expect(screen.getByTestId('location-dirty')).toHaveTextContent('true');
    await act(async () => {
      release([200, { version: 2 }]);
      await flushing;
    });
    expect(screen.getByTestId('location-dirty')).toHaveTextContent('false');
  });
});
