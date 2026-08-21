import { UnauthorizedException } from '@nestjs/common';

import type { AppConfigService } from '../../config/app-config.service';
import { SecurityEventsBus } from '../../shared/security-events/security-events.bus';
import type { SessionValidationService } from '../iam/authentication/services/session-validation.service';
import type { TokenService } from '../iam/authentication/services/token.service';
import type { ConversationParticipantGate } from './conversation-participant.gate';
import type { RealtimeIdentityResolver } from './realtime-identity.resolver';
import { RealtimeGateway } from './realtime.gateway';

// Minimal Socket.IO Socket fake — only the surfaces the gateway touches during
// connection / disconnect / subscribe:conversation.
interface FakeSocket {
  handshake: { auth: Record<string, unknown>; headers: Record<string, string> };
  data: unknown;
  joined: string[];
  emitted: Array<{ event: string; payload: unknown }>;
  disconnected: boolean;
  emit(event: string, payload: unknown): void;
  join(room: string): Promise<void>;
  disconnect(close?: boolean): void;
}

function makeSocket(token: string | undefined): FakeSocket {
  const s: FakeSocket = {
    handshake: { auth: token === undefined ? {} : { token }, headers: {} },
    data: undefined,
    joined: [],
    emitted: [],
    disconnected: false,
    emit(event, payload) {
      this.emitted.push({ event, payload });
    },
    async join(room) {
      this.joined.push(room);
    },
    disconnect() {
      this.disconnected = true;
    },
  };
  return s;
}

// Fake Socket.IO Server that records the adapter-aware room operations the
// gateway performs on a revocation. `in(room)` returns the operator object
// exactly as socket.io does, so the call shape is pinned, not just the effect.
function makeServer() {
  const disconnected: Array<{ room: string; close: boolean }> = [];
  const left: string[] = [];
  const server = {
    in(room: string) {
      return {
        async disconnectSockets(close: boolean) {
          disconnected.push({ room, close });
        },
        async socketsLeave(target: string) {
          left.push(target);
        },
      };
    },
    to() {
      return { emit: jest.fn() };
    },
  };
  return { server, disconnected, left };
}

interface Mocks {
  tokens: { verifyAccessToken: jest.Mock };
  config: { get: jest.Mock };
  participantGate: {
    findProviderProfileId: jest.Mock;
    userIsParticipant: jest.Mock;
    currentJtiForSession: jest.Mock;
  };
  sessionValidation: { assertSessionActive: jest.Mock };
  identities: { resolve: jest.Mock };
  securityEvents: SecurityEventsBus;
}

const VALID_CLAIMS = { sub: 'u-1', sid: 'sess-1', jti: 'jti-1', roles: ['seeker'] };

function makeMocks(over: Partial<Mocks> = {}): Mocks {
  return {
    tokens: { verifyAccessToken: jest.fn().mockReturnValue({ ...VALID_CLAIMS }) },
    config: {
      get: jest.fn().mockImplementation((k) => (k === 'REALTIME_SOCKET_IO' ? true : null)),
    },
    participantGate: {
      findProviderProfileId: jest.fn().mockResolvedValue(null),
      userIsParticipant: jest.fn().mockResolvedValue(false),
      currentJtiForSession: jest.fn().mockResolvedValue('jti-1'),
    },
    // Default: the session is live. Individual tests make it reject.
    sessionValidation: { assertSessionActive: jest.fn().mockResolvedValue(undefined) },
    // Default identity: plain customer, no provider profile, no admin role.
    identities: {
      resolve: jest
        .fn()
        .mockResolvedValue({ roles: ['customer'], providerProfileId: null, providerStatus: null }),
    },
    securityEvents: new SecurityEventsBus(),
    ...over,
  } as Mocks;
}

function makeGateway(m: Mocks): RealtimeGateway {
  return new RealtimeGateway(
    m.tokens as unknown as TokenService,
    m.config as unknown as AppConfigService,
    m.participantGate as unknown as ConversationParticipantGate,
    m.sessionValidation as unknown as SessionValidationService,
    m.identities as unknown as RealtimeIdentityResolver,
    m.securityEvents,
  );
}

const revoked = () => new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });

describe('RealtimeGateway', () => {
  describe('handshake — transport', () => {
    it('rejects an unauthenticated socket (no token)', async () => {
      const m = makeMocks();
      const gw = makeGateway(m);
      const sock = makeSocket(undefined);
      await gw.handleConnection(sock as never);
      expect(sock.disconnected).toBe(true);
      expect(sock.emitted[0]).toMatchObject({
        event: 'error',
        payload: { code: 'AUTH_INVALID_CREDENTIALS' },
      });
      expect(sock.joined).toEqual([]);
    });

    it('rejects an invalid token (verify throws)', async () => {
      const m = makeMocks();
      m.tokens.verifyAccessToken.mockImplementation(() => {
        throw new Error('jwt malformed');
      });
      const gw = makeGateway(m);
      const sock = makeSocket('bad-jwt');
      await gw.handleConnection(sock as never);
      expect(sock.disconnected).toBe(true);
      expect(sock.emitted[0]).toMatchObject({
        event: 'error',
        payload: { code: 'AUTH_INVALID_CREDENTIALS' },
      });
    });

    it('rejects every connection when REALTIME_SOCKET_IO=off', async () => {
      const m = makeMocks();
      m.config.get.mockImplementation((k) => (k === 'REALTIME_SOCKET_IO' ? false : null));
      const gw = makeGateway(m);
      const sock = makeSocket('valid');
      await gw.handleConnection(sock as never);
      expect(sock.disconnected).toBe(true);
      expect(sock.emitted[0]).toMatchObject({
        event: 'error',
        payload: { code: 'REALTIME_DISABLED' },
      });
      // verifyAccessToken must NOT run — the flag check is the door.
      expect(m.tokens.verifyAccessToken).not.toHaveBeenCalled();
    });

    it('authenticates via auth.token when present (mobile / native clients)', async () => {
      const m = makeMocks();
      const gw = makeGateway(m);
      const sock = makeSocket('jwt-from-auth');
      await gw.handleConnection(sock as never);
      expect(m.tokens.verifyAccessToken).toHaveBeenCalledWith('jwt-from-auth');
      expect(sock.disconnected).toBe(false);
      expect(sock.joined).toContain('user:u-1');
    });

    it('authenticates via Authorization: Bearer header', async () => {
      const m = makeMocks();
      const gw = makeGateway(m);
      const sock = makeSocket(undefined);
      sock.handshake.headers.authorization = 'Bearer jwt-from-header';
      await gw.handleConnection(sock as never);
      expect(m.tokens.verifyAccessToken).toHaveBeenCalledWith('jwt-from-header');
      expect(sock.disconnected).toBe(false);
    });

    it('authenticates web clients via the hsm_at cookie', async () => {
      const m = makeMocks();
      const gw = makeGateway(m);
      const sock = makeSocket(undefined);
      sock.handshake.headers.cookie = 'hsm_csrf=csrftok; hsm_at=jwt-from-cookie; other=x';
      await gw.handleConnection(sock as never);
      expect(m.tokens.verifyAccessToken).toHaveBeenCalledWith('jwt-from-cookie');
      expect(sock.disconnected).toBe(false);
      expect(sock.joined).toContain('user:u-1');
    });

    it('treats an empty / whitespace auth.token as absent and falls through to the cookie', async () => {
      const m = makeMocks();
      const gw = makeGateway(m);
      const sock = makeSocket('   '); // whitespace-only
      sock.handshake.headers.cookie = 'hsm_at=real-jwt';
      await gw.handleConnection(sock as never);
      expect(m.tokens.verifyAccessToken).toHaveBeenCalledWith('real-jwt');
    });

    it('rejects a CSRF token sent as auth.token (verify throws)', async () => {
      const m = makeMocks();
      m.tokens.verifyAccessToken.mockImplementation(() => {
        throw new Error('jwt malformed');
      });
      const gw = makeGateway(m);
      const sock = makeSocket('hsm_csrf_token_value');
      await gw.handleConnection(sock as never);
      expect(sock.disconnected).toBe(true);
      expect(sock.emitted[0]).toMatchObject({
        event: 'error',
        payload: { code: 'AUTH_INVALID_CREDENTIALS' },
      });
    });

    it('rejects when neither auth.token nor cookie carries an access token', async () => {
      const m = makeMocks();
      const gw = makeGateway(m);
      const sock = makeSocket(undefined);
      sock.handshake.headers.cookie = 'hsm_csrf=just-the-csrf';
      await gw.handleConnection(sock as never);
      expect(sock.disconnected).toBe(true);
      expect(m.tokens.verifyAccessToken).not.toHaveBeenCalled();
    });

    it('cookie path tolerates URL-encoded values and multiple cookies', async () => {
      const m = makeMocks();
      const gw = makeGateway(m);
      const sock = makeSocket(undefined);
      sock.handshake.headers.cookie = 'unrelated=x; hsm_at=jwt%2Eencoded; trailing=y';
      await gw.handleConnection(sock as never);
      expect(m.tokens.verifyAccessToken).toHaveBeenCalledWith('jwt.encoded');
    });

    it('auth.token wins over cookie when both are present', async () => {
      const m = makeMocks();
      const gw = makeGateway(m);
      const sock = makeSocket('jwt-from-auth');
      sock.handshake.headers.cookie = 'hsm_at=jwt-from-cookie';
      await gw.handleConnection(sock as never);
      expect(m.tokens.verifyAccessToken).toHaveBeenCalledWith('jwt-from-auth');
    });
  });

  // ── D-4: the handshake runs the SAME authoritative check REST runs ─────────
  describe('handshake — session validation (D-4)', () => {
    it('runs assertSessionActive with the token claims', async () => {
      const m = makeMocks();
      const gw = makeGateway(m);
      await gw.handleConnection(makeSocket('jwt') as never);
      expect(m.sessionValidation.assertSessionActive).toHaveBeenCalledWith({
        userId: 'u-1',
        sessionId: 'sess-1',
        jti: 'jti-1',
      });
    });

    it('REJECTS a handshake whose session was revoked (logout / logout-all / reset)', async () => {
      const m = makeMocks();
      m.sessionValidation.assertSessionActive.mockRejectedValue(revoked());
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.disconnected).toBe(true);
      expect(sock.joined).toEqual([]);
      expect(sock.emitted[0]).toMatchObject({
        event: 'error',
        payload: { code: 'AUTH_INVALID_CREDENTIALS' },
      });
    });

    it('REJECTS a handshake from a globally suspended account', async () => {
      // assertSessionActive folds account standing into the same check, so a
      // suspended owner is refused for the same reason a revoked session is —
      // and with the same opaque code, so the two are indistinguishable.
      const m = makeMocks();
      m.sessionValidation.assertSessionActive.mockRejectedValue(revoked());
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.disconnected).toBe(true);
      expect(sock.joined).toEqual([]);
    });

    it.each([
      ['missing sid', { sub: 'u-1', jti: 'j-1', roles: [] }],
      ['missing jti', { sub: 'u-1', sid: 's-1', roles: [] }],
      ['missing sub', { sid: 's-1', jti: 'j-1', roles: [] }],
    ])('rejects a token with %s before any lookup', async (_label, claims) => {
      const m = makeMocks();
      m.tokens.verifyAccessToken.mockReturnValue(claims);
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.disconnected).toBe(true);
      expect(m.sessionValidation.assertSessionActive).not.toHaveBeenCalled();
    });

    it('FAILS CLOSED when the identity lookup throws', async () => {
      // Without current roles we cannot decide room membership; guessing would
      // either over-grant (admin room) or under-grant.
      const m = makeMocks();
      m.identities.resolve.mockRejectedValue(new Error('db down'));
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.disconnected).toBe(true);
      expect(sock.joined).toEqual([]);
    });
  });

  // ── D-4: room membership is decided by CURRENT database facts ─────────────
  describe('server-owned room joins (D-4)', () => {
    it('a plain customer joins only user:{id} and session:{sid}', async () => {
      const m = makeMocks();
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.joined).toEqual(['user:u-1', 'session:sess-1']);
      expect(sock.emitted.find((e) => e.event === 'connection.ack')?.payload).toMatchObject({
        userId: 'u-1',
        joinedRooms: ['user:u-1', 'session:sess-1'],
      });
    });

    it('an ACTIVE provider also joins provider:{profileId}', async () => {
      const m = makeMocks();
      m.identities.resolve.mockResolvedValue({
        roles: ['provider'],
        providerProfileId: 'prof-9',
        providerStatus: 'ACTIVE',
      });
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.joined).toEqual(['user:u-1', 'session:sess-1', 'provider:prof-9']);
    });

    it.each(['DRAFT', 'PENDING_REVIEW', 'SUSPENDED', 'REJECTED'])(
      'a %s provider connects but NEVER joins the provider marketplace room',
      async (status) => {
        const m = makeMocks();
        m.identities.resolve.mockResolvedValue({
          roles: ['provider', 'customer'],
          providerProfileId: 'prof-9',
          providerStatus: status,
        });
        const gw = makeGateway(m);
        const sock = makeSocket('jwt');
        await gw.handleConnection(sock as never);

        // Connecting is allowed: they may still use Customer features and see
        // their own status. Marketplace fan-out is what is withheld.
        expect(sock.disconnected).toBe(false);
        expect(sock.joined).toContain('user:u-1');
        expect(sock.joined).not.toContain('provider:prof-9');
      },
    );

    it('an admin joins the admin room based on the CURRENT role, not the token claim', async () => {
      const m = makeMocks();
      // Token says seeker; the database says admin. The database wins.
      m.tokens.verifyAccessToken.mockReturnValue({ ...VALID_CLAIMS, roles: ['seeker'] });
      m.identities.resolve.mockResolvedValue({
        roles: ['admin'],
        providerProfileId: null,
        providerStatus: null,
      });
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.joined).toContain('admin');
    });

    it('a token claiming admin does NOT reach the admin room once the role is revoked', async () => {
      // This is the D-4 privilege-escalation case: the old gateway trusted
      // `claims.roles`, so a token minted before the revocation kept admin
      // broadcast access until it expired.
      const m = makeMocks();
      m.tokens.verifyAccessToken.mockReturnValue({ ...VALID_CLAIMS, roles: ['admin'] });
      m.identities.resolve.mockResolvedValue({
        roles: ['customer'],
        providerProfileId: null,
        providerStatus: null,
      });
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.joined).not.toContain('admin');
    });

    it('a customer never joins the admin room', async () => {
      const m = makeMocks();
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.joined).not.toContain('admin');
    });
  });

  // ── D-4: already-connected sockets are evicted post-commit ────────────────
  describe('post-connection enforcement (D-4)', () => {
    function bootWithServer() {
      const m = makeMocks();
      const gw = makeGateway(m);
      const { server, disconnected, left } = makeServer();
      gw.afterInit(server as never);
      return { m, gw, disconnected, left };
    }

    it('logout disconnects only the sockets of THAT session', async () => {
      const { m, disconnected } = bootWithServer();
      m.securityEvents.emitSessionRevoked({ userId: 'u-1', sessionId: 'sess-1' });
      await flush();
      expect(disconnected).toEqual([{ room: 'session:sess-1', close: true }]);
      // The user's other devices (user:u-1) are untouched.
      expect(disconnected.map((d) => d.room)).not.toContain('user:u-1');
    });

    it.each(['logout-all', 'password-reset', 'account-suspended'] as const)(
      '%s disconnects every socket the user holds',
      async (reason) => {
        const { m, disconnected } = bootWithServer();
        m.securityEvents.emitAllSessionsRevoked({ userId: 'u-1', reason });
        await flush();
        expect(disconnected).toEqual([{ room: 'user:u-1', close: true }]);
      },
    );

    it('closes the underlying connection, not just the namespace', async () => {
      // disconnectSockets(false) would let the client keep the transport open.
      const { m, disconnected } = bootWithServer();
      m.securityEvents.emitAllSessionsRevoked({ userId: 'u-1', reason: 'logout-all' });
      await flush();
      expect(disconnected[0].close).toBe(true);
    });

    it('a role change disconnects the user so they re-handshake with fresh roles', async () => {
      const { m, disconnected } = bootWithServer();
      m.securityEvents.emitRolesChanged({ userId: 'u-1' });
      await flush();
      expect(disconnected).toEqual([{ room: 'user:u-1', close: true }]);
    });

    it.each(['SUSPENDED', 'REJECTED', 'DRAFT', 'PENDING_REVIEW'] as const)(
      'provider status %s evicts the marketplace room WITHOUT killing the session',
      async (status) => {
        // The whole point of separating the axes: losing marketplace access
        // must not log the person out of their Customer persona.
        const { m, disconnected, left } = bootWithServer();
        m.securityEvents.emitProviderStatusChanged({
          userId: 'u-1',
          providerProfileId: 'prof-9',
          status,
        });
        await flush();
        expect(left).toEqual(['provider:prof-9']);
        expect(disconnected).toEqual([]);
      },
    );

    it('promotion to ACTIVE revokes nothing', async () => {
      const { m, disconnected, left } = bootWithServer();
      m.securityEvents.emitProviderStatusChanged({
        userId: 'u-1',
        providerProfileId: 'prof-9',
        status: 'ACTIVE',
      });
      await flush();
      expect(left).toEqual([]);
      expect(disconnected).toEqual([]);
    });

    it('a failing eviction never propagates back to the caller', async () => {
      // The mutation that triggered this already committed and REST is already
      // enforcing it; a socket that could not be kicked must not undo that.
      const m = makeMocks();
      const gw = makeGateway(m);
      gw.afterInit({
        in: () => ({
          disconnectSockets: async () => {
            throw new Error('adapter unavailable');
          },
          socketsLeave: async () => undefined,
        }),
      } as never);
      expect(() =>
        m.securityEvents.emitAllSessionsRevoked({ userId: 'u-1', reason: 'logout-all' }),
      ).not.toThrow();
      await flush();
    });
  });

  describe('subscribe:conversation', () => {
    async function connectedSocket(m: Mocks): Promise<{ gw: RealtimeGateway; sock: FakeSocket }> {
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      return { gw, sock };
    }

    it('joins conversation:{id} when the participant gate passes', async () => {
      const m = makeMocks();
      m.participantGate.userIsParticipant.mockResolvedValue(true);
      const { gw, sock } = await connectedSocket(m);
      const res = await gw.handleSubscribeConversation(sock as never, { conversationId: 'c-42' });
      expect(res).toEqual({ ok: true, room: 'conversation:c-42' });
      expect(sock.joined).toContain('conversation:c-42');
    });

    it('refuses with FORBIDDEN when the user is not a participant', async () => {
      const m = makeMocks();
      m.participantGate.userIsParticipant.mockResolvedValue(false);
      const { gw, sock } = await connectedSocket(m);
      const res = await gw.handleSubscribeConversation(sock as never, { conversationId: 'c-99' });
      expect(res).toEqual({ ok: false, code: 'FORBIDDEN' });
      expect(sock.joined).not.toContain('conversation:c-99');
    });

    it('refuses with VALIDATION_ERROR when conversationId is empty', async () => {
      const m = makeMocks();
      const { gw, sock } = await connectedSocket(m);
      const res = await gw.handleSubscribeConversation(sock as never, { conversationId: '' });
      expect(res).toEqual({ ok: false, code: 'VALIDATION_ERROR' });
      expect(m.participantGate.userIsParticipant).not.toHaveBeenCalled();
    });

    // D-4 — a security-sensitive client event revalidates the session, so a
    // socket whose eviction was missed still cannot subscribe to anything new.
    it('revalidates the session and DISCONNECTS when authorization was revoked after connect', async () => {
      const m = makeMocks();
      m.participantGate.userIsParticipant.mockResolvedValue(true);
      const { gw, sock } = await connectedSocket(m);

      // Session dies AFTER the handshake succeeded.
      m.sessionValidation.assertSessionActive.mockRejectedValue(revoked());

      const res = await gw.handleSubscribeConversation(sock as never, { conversationId: 'c-42' });
      expect(res).toEqual({ ok: false, code: 'AUTH_INVALID_CREDENTIALS' });
      expect(sock.disconnected).toBe(true);
      expect(sock.joined).not.toContain('conversation:c-42');
      // The participant gate must not even be consulted for a dead session.
      expect(m.participantGate.userIsParticipant).not.toHaveBeenCalled();
    });

    it('rejects a subscribe from a socket with no established identity', async () => {
      const m = makeMocks();
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      // Never connected: data is undefined.
      await expect(
        gw.handleSubscribeConversation(sock as never, { conversationId: 'c-1' }),
      ).rejects.toBeDefined();
    });
  });
});

// The security bus dispatches asynchronously (handlers may be async and are
// fire-and-forget). Yield the microtask queue so their effects are observable.
async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}
