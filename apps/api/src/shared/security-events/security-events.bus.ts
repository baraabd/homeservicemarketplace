import { Injectable, Logger } from '@nestjs/common';

// D-2 / D-4 — post-commit security notifications.
//
// When a security-sensitive mutation commits (logout, logout-all, password
// reset, admin suspend/lock, role change, provider status change), two things
// must happen:
//
//   1. the REST surface must stop accepting the affected access tokens — that
//      is handled authoritatively by SessionValidationService reading the
//      Session row, so it needs no notification at all; and
//   2. any ALREADY-CONNECTED WebSocket must be torn down — a socket that
//      completed its handshake before the revocation would otherwise keep
//      receiving events forever, because there is no per-message re-auth.
//
// (2) needs the IAM / admin / provider services to reach the Socket.IO
// gateway. Injecting the gateway directly would create a module cycle:
// RealtimeModule already imports AuthenticationModule for TokenService, so
// AuthenticationModule importing RealtimeModule back would need forwardRef and
// would couple auth to the transport.
//
// This bus breaks that. Publishers depend only on the bus; the gateway
// subscribes to it at init. Swapping the transport, or running with the
// realtime channel switched off entirely, changes nothing for the publishers.
//
// ── Delivery semantics ───────────────────────────────────────────────────────
// Handlers are invoked AFTER the publisher's database transaction commits (the
// call sites are all outside `tx.run`). Emission is fire-and-forget and a
// throwing handler is logged and swallowed: a socket that could not be kicked
// must never roll back the suspension that caused it. The REST-side revocation
// is already durable in Postgres at that point, so the security decision does
// not depend on this bus succeeding.
//
// Cross-instance fan-out is NOT this bus's job. It is in-process only; the
// gateway's handler uses Socket.IO's Redis adapter, whose `disconnectSockets`
// is cluster-wide, so one instance receiving the logout evicts sockets on all
// of them.

export interface SessionRevokedEvent {
  /** Owner of the revoked session. */
  userId: string;
  /** The single session that was revoked. */
  sessionId: string;
}

export interface AllSessionsRevokedEvent {
  userId: string;
  /** Why every session was killed — audit/log context only, never authz. */
  reason: 'logout-all' | 'password-reset' | 'account-suspended' | 'roles-changed';
}

export interface RolesChangedEvent {
  userId: string;
}

export interface ProviderStatusChangedEvent {
  /** Null when the provider profile is not linked to a user account. */
  userId: string | null;
  providerProfileId: string;
  /** The status the profile now has. */
  status: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';
}

type Handler<T> = (event: T) => void | Promise<void>;

@Injectable()
export class SecurityEventsBus {
  private readonly logger = new Logger(SecurityEventsBus.name);

  private readonly sessionRevoked: Array<Handler<SessionRevokedEvent>> = [];
  private readonly allSessionsRevoked: Array<Handler<AllSessionsRevokedEvent>> = [];
  private readonly rolesChanged: Array<Handler<RolesChangedEvent>> = [];
  private readonly providerStatusChanged: Array<Handler<ProviderStatusChangedEvent>> = [];

  onSessionRevoked(handler: Handler<SessionRevokedEvent>): void {
    this.sessionRevoked.push(handler);
  }

  onAllSessionsRevoked(handler: Handler<AllSessionsRevokedEvent>): void {
    this.allSessionsRevoked.push(handler);
  }

  onRolesChanged(handler: Handler<RolesChangedEvent>): void {
    this.rolesChanged.push(handler);
  }

  onProviderStatusChanged(handler: Handler<ProviderStatusChangedEvent>): void {
    this.providerStatusChanged.push(handler);
  }

  // Publishers. All return void: a failed side effect must never fail (or
  // roll back) the mutation that has already committed.
  emitSessionRevoked(event: SessionRevokedEvent): void {
    this.dispatch('session.revoked', this.sessionRevoked, event);
  }

  emitAllSessionsRevoked(event: AllSessionsRevokedEvent): void {
    this.dispatch('session.revoked-all', this.allSessionsRevoked, event);
  }

  emitRolesChanged(event: RolesChangedEvent): void {
    this.dispatch('roles.changed', this.rolesChanged, event);
  }

  emitProviderStatusChanged(event: ProviderStatusChangedEvent): void {
    this.dispatch('provider.status-changed', this.providerStatusChanged, event);
  }

  private dispatch<T>(name: string, handlers: Array<Handler<T>>, event: T): void {
    for (const handler of handlers) {
      try {
        const result = handler(event);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err: unknown) => this.logFailure(name, err));
        }
      } catch (err) {
        this.logFailure(name, err);
      }
    }
  }

  private logFailure(name: string, err: unknown): void {
    // Never log the event payload — it carries user ids, and for some events
    // the reason is security-sensitive context.
    this.logger.warn({
      msg: 'security-events.handler.failed',
      event: name,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
