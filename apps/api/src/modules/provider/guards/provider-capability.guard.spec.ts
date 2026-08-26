import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProviderCapability } from '@homeservicemarketplace/contracts';

import { ProviderCapabilityGuard } from './provider-capability.guard';
import { RequireCapability } from './require-capability.decorator';
import type { ProviderCapabilityService } from '../capability/provider-capability.service';

// Sprint 9B.8 — the guard reads what the route declared and asks for exactly
// that.
//
// The rules themselves live in provider-capability.service.spec.ts. What is
// tested here is the wiring, and the wiring has two properties that matter:
// the right capability is asked for, and forgetting to declare one cannot
// widen access.

function makeCtx(
  user: { id: string } | undefined,
  handler: object = function handler() {},
  cls: object = class Controller {},
) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as Parameters<ProviderCapabilityGuard['canActivate']>[0];
}

function makeCapabilities(allowed: boolean) {
  return {
    can: jest.fn(async () => allowed),
  } as unknown as ProviderCapabilityService & { can: jest.Mock };
}

/** Applies the decorator the way Nest does, so metadata really is read back
 *  through Reflector rather than stubbed. */
function decorated(capability: ProviderCapability): object {
  const target = function handler() {};
  RequireCapability(capability)(target as never, 'handler', {
    value: target,
  } as PropertyDescriptor);
  return target;
}

describe('the declared capability is the one asked for', () => {
  it.each([
    ProviderCapability.SubmitBid,
    ProviderCapability.ManageBookings,
    ProviderCapability.ViewEarnings,
    ProviderCapability.ManageVerification,
    ProviderCapability.EditOwnProfile,
    ProviderCapability.CompleteOnboarding,
  ])('asks for %s when the route declares it', async (capability) => {
    const capabilities = makeCapabilities(true);
    const guard = new ProviderCapabilityGuard(capabilities, new Reflector());

    await guard.canActivate(makeCtx({ id: 'u-1' }, decorated(capability)));

    expect(capabilities.can).toHaveBeenCalledWith('u-1', capability);
  });

  it('lets a handler declaration override the controller declaration', async () => {
    // The common shape: a controller states the rule for most of its routes
    // and one route differs — a profile controller reading with
    // VIEW_OWN_PROFILE and writing with EDIT_OWN_PROFILE.
    const capabilities = makeCapabilities(true);
    const guard = new ProviderCapabilityGuard(capabilities, new Reflector());

    const cls = class Controller {};
    RequireCapability(ProviderCapability.ViewOwnProfile)(cls as never);

    await guard.canActivate(
      makeCtx({ id: 'u-1' }, decorated(ProviderCapability.EditOwnProfile), cls),
    );

    expect(capabilities.can).toHaveBeenCalledWith('u-1', ProviderCapability.EditOwnProfile);
  });

  it('falls back to the controller declaration when the handler has none', async () => {
    const capabilities = makeCapabilities(true);
    const guard = new ProviderCapabilityGuard(capabilities, new Reflector());

    const cls = class Controller {};
    RequireCapability(ProviderCapability.ManageBookings)(cls as never);

    await guard.canActivate(makeCtx({ id: 'u-1' }, function bare() {}, cls));

    expect(capabilities.can).toHaveBeenCalledWith('u-1', ProviderCapability.ManageBookings);
  });
});

describe('forgetting to declare cannot widen access', () => {
  it('defaults to VIEW_MARKETPLACE, which is what every route got before', async () => {
    // The direction of this default is the whole point. A permissive default
    // would mean a new route family ships ungated and nothing fails; this one
    // reproduces the pre-9B.8 behaviour, which was the strict one.
    const capabilities = makeCapabilities(true);
    const guard = new ProviderCapabilityGuard(capabilities, new Reflector());

    await guard.canActivate(makeCtx({ id: 'u-1' }));

    expect(capabilities.can).toHaveBeenCalledWith('u-1', ProviderCapability.ViewMarketplace);
  });

  it('still denies an undeclared route when the capability is withheld', async () => {
    const guard = new ProviderCapabilityGuard(makeCapabilities(false), new Reflector());

    await expect(guard.canActivate(makeCtx({ id: 'u-1' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('denials say nothing', () => {
  it('refuses an unauthenticated request without consulting the service', async () => {
    const capabilities = makeCapabilities(true);
    const guard = new ProviderCapabilityGuard(capabilities, new Reflector());

    await expect(guard.canActivate(makeCtx(undefined))).rejects.toBeInstanceOf(ForbiddenException);
    expect(capabilities.can).not.toHaveBeenCalled();
  });

  it('returns an identical envelope whatever the capability or cause', async () => {
    // The envelope must not become an oracle. A caller who can tell "not
    // verified" from "grant expired" from "suspended" can enumerate the
    // account states of other users by probing.
    const guard = new ProviderCapabilityGuard(makeCapabilities(false), new Reflector());

    const shapes: unknown[] = [];
    for (const capability of [
      ProviderCapability.SubmitBid,
      ProviderCapability.ManageBookings,
      ProviderCapability.ViewEarnings,
    ]) {
      await guard
        .canActivate(makeCtx({ id: 'u-1' }, decorated(capability)))
        .catch((err) => shapes.push((err as ForbiddenException).getResponse()));
    }

    expect(shapes).toHaveLength(3);
    expect(new Set(shapes.map((s) => JSON.stringify(s))).size).toBe(1);
    expect(shapes[0]).toEqual({ code: 'FORBIDDEN' });
  });
});
