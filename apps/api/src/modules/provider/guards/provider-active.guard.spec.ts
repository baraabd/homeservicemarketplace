import { ForbiddenException } from '@nestjs/common';
import { ProviderCapability } from '@homeservicemarketplace/contracts';

import { ProviderActiveGuard } from './provider-active.guard';
import type { ProviderCapabilityService } from '../capability/provider-capability.service';

// Sprint 7 — the guard is now a translator, not a decision-maker.
//
// What it must do:
//   * ask ProviderCapabilityService for VIEW_MARKETPLACE (never compare a
//     status string, never read the profile itself);
//   * turn a denial into the SAME opaque { code: 'FORBIDDEN' } envelope for
//     every cause, so a caller cannot distinguish "no profile" from "not
//     approved" from "account suspended" by probing.
//
// The rules themselves are tested in provider-capability.service.spec.ts.
// Duplicating them here would recreate the two-homes-for-one-rule problem
// this refactor removes.

function makeCtx(user: { id: string } | undefined) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as Parameters<ProviderActiveGuard['canActivate']>[0];
}

function makeCapabilities(can: boolean | (() => Promise<boolean>)) {
  return {
    can: jest.fn(typeof can === 'function' ? can : async () => can),
  } as unknown as ProviderCapabilityService & { can: jest.Mock };
}

describe('ProviderActiveGuard', () => {
  it('allows the request when VIEW_MARKETPLACE is held', async () => {
    const capabilities = makeCapabilities(true);
    const guard = new ProviderActiveGuard(capabilities);

    await expect(guard.canActivate(makeCtx({ id: 'u-1' }))).resolves.toBe(true);
  });

  it('asks for VIEW_MARKETPLACE specifically, for the calling user', async () => {
    // Pins the capability CODE. If a later refactor asks for the wrong one —
    // say EDIT_OWN_PROFILE — every marketplace route silently opens to
    // providers who merely finished onboarding.
    const capabilities = makeCapabilities(true);
    const guard = new ProviderActiveGuard(capabilities);

    await guard.canActivate(makeCtx({ id: 'u-42' }));

    expect(capabilities.can).toHaveBeenCalledWith('u-42', ProviderCapability.ViewMarketplace);
  });

  it('rejects with an opaque FORBIDDEN when the capability is withheld', async () => {
    const capabilities = makeCapabilities(false);
    const guard = new ProviderActiveGuard(capabilities);

    await expect(guard.canActivate(makeCtx({ id: 'u-1' }))).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(makeCtx({ id: 'u-1' }))).rejects.toMatchObject({
      response: { code: 'FORBIDDEN' },
    });
  });

  it('rejects with the SAME envelope whatever the underlying cause', async () => {
    // The envelope must not become an oracle. A caller who can tell "no
    // profile" from "account suspended" apart can enumerate account states of
    // other users by probing, so every denial looks identical from outside.
    const guard = new ProviderActiveGuard(makeCapabilities(false));

    const shapes: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      await guard.canActivate(makeCtx({ id: `u-${i}` })).catch((err) => {
        shapes.push((err as ForbiddenException).getResponse());
      });
    }
    expect(shapes).toEqual([{ code: 'FORBIDDEN' }, { code: 'FORBIDDEN' }, { code: 'FORBIDDEN' }]);
  });

  it('rejects when there is no authenticated user, without consulting capabilities', async () => {
    // Reaching the capability service with an undefined user would be a
    // lookup on `undefined`; failing before that keeps the guard honest about
    // requiring JwtAuthGuard in front of it.
    const capabilities = makeCapabilities(true);
    const guard = new ProviderActiveGuard(capabilities);

    await expect(guard.canActivate(makeCtx(undefined))).rejects.toThrow(ForbiddenException);
    expect(capabilities.can).not.toHaveBeenCalled();
  });

  it('does not swallow an error from the capability service', async () => {
    // Fail closed and LOUD. A capability service that throws (database down)
    // must not be caught and turned into `true`, and equally must not be
    // silently turned into a 403 that hides an outage.
    const capabilities = makeCapabilities(async () => {
      throw new Error('database unavailable');
    });
    const guard = new ProviderActiveGuard(capabilities);

    await expect(guard.canActivate(makeCtx({ id: 'u-1' }))).rejects.toThrow(/database unavailable/);
  });
});
