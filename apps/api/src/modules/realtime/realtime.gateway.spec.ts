import { UnauthorizedException } from '@nestjs/common';

import type { AppConfigService } from '../../config/app-config.service';
import { SecurityEventsBus } from '../../shared/security-events/security-events.bus';
import type { SessionValidationService } from '../iam/authentication/services/session-validation.service';
import type { TokenService } from '../iam/authentication/services/token.service';
import type { ConversationParticipantGate } from './conversation-participant.gate';
import { RealtimeIdentityResolver } from './realtime-identity.resolver';
import {
  MAX_CONVERSATION_ROOMS,
  MAX_PENDING_DELIVERIES_PER_SOCKET,
  RealtimeGateway,
} from './realtime.gateway';
import { REALTIME_TRANSPORT } from './realtime-socket.adapter';

describe('R25 current database identity resolution', () => {
  function identityFixture() {
    const users = {
      listRoles: jest
        .fn()
        .mockResolvedValue([
          { role: { name: 'admin', deletedAt: null } },
          { role: { name: 'provider', deletedAt: null } },
        ]),
    };
    const profiles = {
      findByUserId: jest.fn().mockResolvedValue({ id: 'profile-1', status: 'ACTIVE' }),
    };
    const roles = { listPermissionKeysForUser: jest.fn().mockResolvedValue(['user:read:any']) };
    const capabilities = { can: jest.fn().mockResolvedValue(true) };
    const resolver = new RealtimeIdentityResolver(
      users as never,
      profiles as never,
      roles as never,
      capabilities as never,
    );
    return { users, profiles, roles, capabilities, resolver };
  }

  it('re-reads role grants and provider capability for successive delivery checks without caching JWT claims', async () => {
    const f = identityFixture();
    expect(await f.resolver.resolve('user-1')).toMatchObject({
      roles: ['admin', 'provider'],
      permissions: ['user:read:any'],
      mayViewMarketplace: true,
    });
    f.roles.listPermissionKeysForUser.mockResolvedValue([]);
    f.capabilities.can.mockResolvedValue(false);
    expect(await f.resolver.resolve('user-1')).toMatchObject({
      roles: ['admin', 'provider'],
      permissions: [],
      providerStatus: 'ACTIVE',
      mayViewMarketplace: false,
    });
    expect(f.users.listRoles).toHaveBeenCalledTimes(2);
    expect(f.roles.listPermissionKeysForUser).toHaveBeenNthCalledWith(2, 'user-1');
    expect(f.capabilities.can).toHaveBeenCalledTimes(2);
  });

  it('does not let a deleted provider role survive through an otherwise active profile/capability', async () => {
    const f = identityFixture();
    f.users.listRoles.mockResolvedValue([{ role: { name: 'provider', deletedAt: new Date() } }]);
    expect(await f.resolver.resolve('user-1')).toMatchObject({
      roles: [],
      providerStatus: 'ACTIVE',
      mayViewMarketplace: false,
    });
  });

  it('fails closed when the current permission authority is unavailable', async () => {
    const f = identityFixture();
    f.roles.listPermissionKeysForUser.mockRejectedValue(
      new Error('permission authority unavailable'),
    );
    await expect(f.resolver.resolve('user-1')).rejects.toThrow('permission authority unavailable');
  });
});

// Minimal Socket.IO Socket fake — only the surfaces the gateway touches during
// connection / disconnect / subscribe:conversation.
interface FakeSocket {
  id: string;
  connected: boolean;
  rooms: Set<string>;
  volatile: { emit(event: string, payload: unknown): void };
  handshake: { auth: Record<string, unknown>; headers: Record<string, string> };
  data: unknown;
  joined: string[];
  emitted: Array<{ event: string; payload: unknown }>;
  disconnected: boolean;
  emit(event: string, payload: unknown): void;
  join(room: string): Promise<void>;
  leave(room: string): Promise<void>;
  disconnect(close?: boolean): void;
}

let socketSequence = 0;
function makeSocket(token: string | undefined): FakeSocket {
  const s: FakeSocket = {
    id: `socket-${++socketSequence}`,
    connected: true,
    rooms: new Set(),
    get volatile() {
      return this;
    },
    handshake: {
      auth: token === undefined ? {} : { token },
      headers: { origin: 'http://localhost:5173' },
    },
    data: undefined,
    joined: [],
    emitted: [],
    disconnected: false,
    emit(event, payload) {
      this.emitted.push({ event, payload });
    },
    async join(room) {
      this.joined.push(room);
      this.rooms.add(room);
    },
    async leave(room) {
      this.rooms.delete(room);
    },
    disconnect() {
      this.disconnected = true;
      this.connected = false;
    },
  };
  return s;
}

// A socket as `fetchSockets` returns it (possibly on another instance).
interface FakeRemoteSocket {
  data: { providerConversationRooms?: string[] };
  left: string[];
  leave(room: string): void;
}
function remoteSocket(providerConversationRooms: string[]): FakeRemoteSocket {
  return {
    data: { providerConversationRooms },
    left: [],
    leave(room) {
      this.left.push(room);
    },
  };
}

// Fake Socket.IO Server that records the adapter-aware room operations the
// gateway performs on a revocation. `in(room)` returns the operator object
// exactly as socket.io does, so the call shape is pinned, not just the effect.
function makeServer(members: Record<string, FakeRemoteSocket[]> = {}) {
  const disconnected: Array<{ room: string; close: boolean }> = [];
  const left: string[] = [];
  const server = {
    [REALTIME_TRANSPORT]: {
      isReady: jest.fn().mockReturnValue(true),
      reserve: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    },
    on: jest.fn(),
    serverSideEmit: jest.fn(),
    in(room: string) {
      return {
        async fetchSockets() {
          return members[room] ?? [];
        },
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
    mayReceiveConversation: jest.Mock;
    currentJtiForSession: jest.Mock;
  };
  sessionValidation: { assertSessionActive: jest.Mock };
  identities: { resolve: jest.Mock };
  securityEvents: SecurityEventsBus;
}

const VALID_CLAIMS = {
  sub: 'u-1',
  sid: 'sess-1',
  jti: 'jti-1',
  roles: ['seeker'],
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function makeMocks(over: Partial<Mocks> = {}): Mocks {
  return {
    tokens: { verifyAccessToken: jest.fn().mockReturnValue({ ...VALID_CLAIMS }) },
    config: {
      get: jest
        .fn()
        .mockImplementation(
          (k) =>
            ({ REALTIME_SOCKET_IO: true, FRONTEND_URL: 'http://localhost:5173', CORS_ORIGINS: [] })[
              k as 'REALTIME_SOCKET_IO'
            ] ?? null,
        ),
    },
    participantGate: {
      findProviderProfileId: jest.fn().mockResolvedValue(null),
      userIsParticipant: jest.fn().mockResolvedValue(false),
      mayReceiveConversation: jest.fn().mockResolvedValue({ allowed: false }),
      currentJtiForSession: jest.fn().mockResolvedValue('jti-1'),
    },
    // Default: the session is live. Individual tests make it reject.
    sessionValidation: { assertSessionActive: jest.fn().mockResolvedValue(undefined) },
    // Default identity: plain customer, no provider profile, no admin role.
    identities: {
      resolve: jest.fn().mockResolvedValue({
        roles: ['customer'],
        permissions: [],
        mayViewMarketplace: false,
        providerProfileId: null,
        providerStatus: null,
      }),
    },
    securityEvents: new SecurityEventsBus(),
    ...over,
  } as Mocks;
}

const createdGateways: RealtimeGateway[] = [];
afterEach(() => {
  for (const gateway of createdGateways.splice(0)) gateway.onModuleDestroy();
});

function makeGateway(m: Mocks): RealtimeGateway {
  const gateway = new RealtimeGateway(
    m.tokens as unknown as TokenService,
    m.config as unknown as AppConfigService,
    m.participantGate as unknown as ConversationParticipantGate,
    m.sessionValidation as unknown as SessionValidationService,
    m.identities as unknown as RealtimeIdentityResolver,
    m.securityEvents,
  );
  gateway.server = makeServer().server as never;
  createdGateways.push(gateway);
  return gateway;
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
        permissions: [],
        mayViewMarketplace: true,
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
        permissions: ['user:read:any'],
        mayViewMarketplace: false,
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

    it('losing provider status also leaves the conversations joined as the provider, not those joined as a customer', async () => {
      const m = makeMocks();
      const gw = makeGateway(m);
      const asProvider = remoteSocket(['conversation:c-7', 'conversation:c-8']);
      const { server, disconnected } = makeServer({
        'provider-conversations:prof-9': [asProvider],
      });
      gw.afterInit(server as never);
      m.securityEvents.emitProviderStatusChanged({
        userId: 'u-1',
        providerProfileId: 'prof-9',
        status: 'SUSPENDED',
      });
      await flush();
      expect(asProvider.left).toEqual([
        'conversation:c-7',
        'conversation:c-8',
        'provider-conversations:prof-9',
      ]);
      // A conversation joined as a customer was never recorded here, so it is
      // not left; and the session is not killed.
      expect(asProvider.left).not.toContain('conversation:c-1');
      expect(disconnected).toEqual([]);
    });

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
        on: jest.fn(),
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
      m.participantGate.mayReceiveConversation.mockResolvedValue({ allowed: true, side: 'SEEKER' });
      const { gw, sock } = await connectedSocket(m);
      const res = await gw.handleSubscribeConversation(sock as never, { conversationId: 'c-42' });
      expect(res).toEqual({ ok: true, room: 'conversation:c-42' });
      expect(sock.joined).toContain('conversation:c-42');
    });

    it('refuses with FORBIDDEN when the user is not a participant', async () => {
      const m = makeMocks();
      m.participantGate.mayReceiveConversation.mockResolvedValue({ allowed: false });
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
      expect(m.participantGate.mayReceiveConversation).not.toHaveBeenCalled();
    });

    // D-4 — a security-sensitive client event revalidates the session, so a
    // socket whose eviction was missed still cannot subscribe to anything new.
    it('revalidates the session and DISCONNECTS when authorization was revoked after connect', async () => {
      const m = makeMocks();
      m.participantGate.mayReceiveConversation.mockResolvedValue({ allowed: true, side: 'SEEKER' });
      const { gw, sock } = await connectedSocket(m);

      // Session dies AFTER the handshake succeeded.
      m.sessionValidation.assertSessionActive.mockRejectedValue(revoked());

      const res = await gw.handleSubscribeConversation(sock as never, { conversationId: 'c-42' });
      expect(res).toEqual({ ok: false, code: 'AUTH_INVALID_CREDENTIALS' });
      expect(sock.disconnected).toBe(true);
      expect(sock.joined).not.toContain('conversation:c-42');
      // The participant gate must not even be consulted for a dead session.
      expect(m.participantGate.mayReceiveConversation).not.toHaveBeenCalled();
    });

    // R12 — a provider-side participant is held to the REST provider rule.
    it('a provider-side subscription is recorded so losing provider access can find it', async () => {
      const m = makeMocks();
      m.identities.resolve.mockResolvedValue({
        roles: ['provider'],
        permissions: [],
        providerProfileId: 'prof-9',
        providerStatus: 'ACTIVE',
        mayViewMarketplace: true,
      });
      m.participantGate.mayReceiveConversation.mockResolvedValue({
        allowed: true,
        side: 'PROVIDER',
        providerProfileId: 'prof-9',
      });
      const { gw, sock } = await connectedSocket(m);
      const res = await gw.handleSubscribeConversation(sock as never, { conversationId: 'c-7' });
      expect(res).toEqual({ ok: true, room: 'conversation:c-7' });
      expect(sock.joined).toEqual(
        expect.arrayContaining(['conversation:c-7', 'provider-conversations:prof-9']),
      );
      expect(
        (sock.data as { providerConversationRooms?: string[] }).providerConversationRooms,
      ).toEqual(['conversation:c-7']);
    });

    it('a provider refused by the gate (no booking access) joins nothing', async () => {
      const m = makeMocks();
      m.participantGate.mayReceiveConversation.mockResolvedValue({ allowed: false });
      const { gw, sock } = await connectedSocket(m);
      const res = await gw.handleSubscribeConversation(sock as never, { conversationId: 'c-7' });
      expect(res).toEqual({ ok: false, code: 'FORBIDDEN' });
      expect(sock.joined.filter((r) => r.startsWith('conversation:'))).toEqual([]);
      expect(sock.joined.filter((r) => r.startsWith('provider-conversations:'))).toEqual([]);
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

describe('R25 realtime authorization and budgets', () => {
  const event = (over: Record<string, unknown> = {}) => ({
    v: 1 as const,
    type: 'notification.created' as const,
    userId: 'u-1',
    occurredAt: new Date().toISOString(),
    payload: { id: 'notification-1' },
    ...over,
  });
  const packets = (socket: FakeSocket) =>
    socket.emitted.filter((entry) => entry.event === 'realtime.event');
  async function connected() {
    const m = makeMocks();
    const gw = makeGateway(m);
    const sock = makeSocket('signed-jwt');
    await gw.handleConnection(sock as never);
    expect(sock.disconnected).toBe(false);
    return { m, gw, sock };
  }

  it('keeps the original jti and rejects a rotated credential even if the session row names a new jti', async () => {
    const { m, gw, sock } = await connected();
    m.participantGate.currentJtiForSession.mockResolvedValue('rotated-jti');
    m.sessionValidation.assertSessionActive.mockImplementation(async ({ jti }) => {
      if (jti !== 'rotated-jti') throw revoked();
    });
    const result = await gw.handleSubscribeConversation(sock as never, { conversationId: 'c-1' });
    expect(result).toEqual({ ok: false, code: 'AUTH_INVALID_CREDENTIALS' });
    expect(m.participantGate.currentJtiForSession).not.toHaveBeenCalled();
    expect(sock.data).toMatchObject({ jti: VALID_CLAIMS.jti, expiresAt: VALID_CLAIMS.exp * 1000 });
    expect(JSON.stringify(sock.data)).not.toContain('signed-jwt');
  });

  it.each([undefined, NaN, Infinity, 1.5, 1])(
    'rejects malformed or expired exp=%s before database authority',
    async (exp) => {
      const m = makeMocks();
      m.tokens.verifyAccessToken.mockReturnValue({ ...VALID_CLAIMS, exp });
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.disconnected).toBe(true);
      expect(m.sessionValidation.assertSessionActive).not.toHaveBeenCalled();
    },
  );

  it('disconnects an idle socket at the ORIGINAL access-token expiry', async () => {
    jest.useFakeTimers();
    try {
      const m = makeMocks();
      m.tokens.verifyAccessToken.mockReturnValue({
        ...VALID_CLAIMS,
        exp: Math.floor(Date.now() / 1000) + 2,
      });
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.disconnected).toBe(false);
      await jest.advanceTimersByTimeAsync(2_100);
      expect(sock.disconnected).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['https://attacker.invalid', 'null', 'http://localhost:5173.attacker.invalid'])(
    'rejects browser Origin %s before parsing credentials',
    async (origin) => {
      const m = makeMocks();
      const gw = makeGateway(m);
      const sock = makeSocket(undefined);
      sock.handshake.headers.cookie = 'hsm_at=jwt';
      sock.handshake.headers.origin = origin;
      await gw.handleConnection(sock as never);
      expect(sock.disconnected).toBe(true);
      expect(m.tokens.verifyAccessToken).not.toHaveBeenCalled();
    },
  );

  it('rejects originless cookies but allows an originless explicit native bearer credential', async () => {
    const m = makeMocks();
    const gw = makeGateway(m);
    const cookie = makeSocket(undefined);
    cookie.handshake.headers.cookie = 'hsm_at=jwt';
    delete cookie.handshake.headers.origin;
    await gw.handleConnection(cookie as never);
    expect(cookie.disconnected).toBe(true);
    const native = makeSocket('jwt');
    delete native.handshake.headers.origin;
    await gw.handleConnection(native as never);
    expect(native.disconnected).toBe(false);
  });

  it('refuses a socket when the registered adapter cannot reserve a cluster slot', async () => {
    const m = makeMocks();
    const gw = makeGateway(m);
    const transport = (gw.server as unknown as ReturnType<typeof makeServer>['server'])[
      REALTIME_TRANSPORT
    ];
    transport.reserve.mockResolvedValue(false);
    const sock = makeSocket('jwt');
    await gw.handleConnection(sock as never);
    expect(sock.disconnected).toBe(true);
    expect(sock.emitted).toContainEqual({
      event: 'error',
      payload: { code: 'REALTIME_CONNECTION_LIMIT' },
    });
    expect(sock.joined).toEqual([]);
  });

  it('requires a managed and healthy transport for new subscriptions and delivery', async () => {
    const { gw, sock } = await connected();
    const server = gw.server as unknown as ReturnType<typeof makeServer>['server'];
    server[REALTIME_TRANSPORT].isReady.mockReturnValue(false);
    gw.emitToRoom('user:u-1', event());
    expect(await gw.handleSubscribeConversation(sock as never, { conversationId: 'c-1' })).toEqual({
      ok: false,
      code: 'REALTIME_UNAVAILABLE',
    });
    await flush();
    expect(packets(sock)).toEqual([]);
    expect(server.serverSideEmit).not.toHaveBeenCalled();
  });

  it('does not write a packet whose original expiry passed during the final database session check', async () => {
    const { m, gw, sock } = await connected();
    m.sessionValidation.assertSessionActive.mockImplementationOnce(async () => {
      (sock.data as { expiresAt: number }).expiresAt = Date.now() - 1;
    });
    gw.emitToRoom('user:u-1', event());
    await flush();
    expect(packets(sock)).toEqual([]);
    expect(sock.disconnected).toBe(true);
  });

  it('gives every connection an explicit REST snapshot recovery contract', async () => {
    const { sock } = await connected();
    expect(sock.emitted.find((item) => item.event === 'connection.ack')?.payload).toMatchObject({
      recovery: { mode: 'rest', required: true, maxWindow: 200 },
    });
  });

  it('does not join a legacy ACTIVE provider who lacks the current marketplace capability', async () => {
    const m = makeMocks();
    m.identities.resolve.mockResolvedValue({
      roles: ['provider'],
      permissions: [],
      providerProfileId: 'prof-9',
      providerStatus: 'ACTIVE',
      mayViewMarketplace: false,
    });
    const gw = makeGateway(m);
    const sock = makeSocket('jwt');
    await gw.handleConnection(sock as never);
    expect(sock.disconnected).toBe(false);
    expect(sock.rooms.has('provider:prof-9')).toBe(false);
  });

  it('denies a current admin without the current read permission', async () => {
    const m = makeMocks();
    m.identities.resolve.mockResolvedValue({
      roles: ['admin'],
      permissions: [],
      providerProfileId: null,
      providerStatus: null,
      mayViewMarketplace: false,
    });
    const gw = makeGateway(m);
    const sock = makeSocket('jwt');
    await gw.handleConnection(sock as never);
    expect(sock.rooms.has('admin')).toBe(false);
  });

  it('rechecks admin permission before delivery even when the role and existing room survive', async () => {
    const m = makeMocks();
    m.identities.resolve.mockResolvedValue({
      roles: ['admin'],
      permissions: ['user:read:any'],
      providerProfileId: null,
      providerStatus: null,
      mayViewMarketplace: false,
    });
    const gw = makeGateway(m);
    const sock = makeSocket('jwt');
    await gw.handleConnection(sock as never);
    m.identities.resolve.mockResolvedValue({
      roles: ['admin'],
      permissions: [],
      providerProfileId: null,
      providerStatus: null,
      mayViewMarketplace: false,
    });
    gw.emitToRoom('admin', event({ userId: null, type: 'provider.status_changed' }) as never);
    await flush();
    expect(packets(sock)).toEqual([]);
    expect(sock.rooms.has('admin')).toBe(false);
    expect(sock.disconnected).toBe(false);
  });

  it('denies provider marketplace events sent to the personal room after capability loss', async () => {
    const { m, gw, sock } = await connected();
    const identity = {
      roles: ['provider'],
      permissions: [],
      providerProfileId: 'prof-9',
      providerStatus: 'ACTIVE',
      mayViewMarketplace: true,
    };
    m.identities.resolve.mockResolvedValue(identity);
    gw.emitToRoom('user:u-1', event({ type: 'request.available' }) as never);
    await flush();
    expect(packets(sock)).toHaveLength(1);
    m.identities.resolve.mockResolvedValue({ ...identity, mayViewMarketplace: false });
    gw.emitToRoom('user:u-1', event({ type: 'request.available' }) as never);
    await flush();
    expect(packets(sock)).toHaveLength(1);
    // The personal decision/history stream remains available.
    gw.emitToRoom('user:u-1', event());
    await flush();
    expect(packets(sock)).toHaveLength(2);
  });

  it('revalidates an established conversation before delivery without relying on revocation fan-out', async () => {
    const { m, gw, sock } = await connected();
    m.participantGate.mayReceiveConversation.mockResolvedValue({ allowed: true, side: 'SEEKER' });
    await gw.handleSubscribeConversation(sock as never, { conversationId: 'c-private' });
    m.participantGate.mayReceiveConversation.mockResolvedValue({ allowed: false });
    gw.emitToRoom(
      'conversation:c-private',
      event({ userId: null, type: 'message.created' }) as never,
    );
    await flush();
    expect(packets(sock)).toEqual([]);
    expect(sock.rooms.has('conversation:c-private')).toBe(false);
  });

  it('rejects logout that commits while conversation authorization is in flight', async () => {
    const { m, gw, sock } = await connected();
    m.participantGate.mayReceiveConversation.mockResolvedValue({ allowed: true, side: 'SEEKER' });
    await gw.handleSubscribeConversation(sock as never, { conversationId: 'c-private' });
    let release!: (value: { allowed: true; side: 'SEEKER' }) => void;
    m.participantGate.mayReceiveConversation.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    gw.emitToRoom(
      'conversation:c-private',
      event({ userId: null, type: 'message.created' }) as never,
    );
    m.sessionValidation.assertSessionActive.mockRejectedValue(revoked());
    release({ allowed: true, side: 'SEEKER' });
    await flush();
    expect(packets(sock)).toEqual([]);
    expect(sock.disconnected).toBe(true);
  });

  it('never forwards a foreign recipient through an otherwise valid room', async () => {
    const { gw, sock } = await connected();
    gw.emitToRoom('user:u-1', event({ userId: 'another-user' }) as never);
    await flush();
    expect(packets(sock)).toEqual([]);
  });

  it.each([{}, 123, ['c-1'], 'conversation:c-1', 'c'.repeat(129)])(
    'validates untrusted conversation id before authority lookups (%p)',
    async (conversationId) => {
      const { m, gw, sock } = await connected();
      expect(
        await gw.handleSubscribeConversation(sock as never, { conversationId } as never),
      ).toEqual({
        ok: false,
        code: 'VALIDATION_ERROR',
      });
      expect(m.participantGate.mayReceiveConversation).not.toHaveBeenCalled();
    },
  );

  it('serializes concurrent subscriptions without exceeding room or lookup budgets', async () => {
    const { m, gw, sock } = await connected();
    m.participantGate.mayReceiveConversation.mockResolvedValue({ allowed: true, side: 'SEEKER' });
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        gw.handleSubscribeConversation(sock as never, { conversationId: `c-${index}` }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((result) => !result.ok && result.code === 'REALTIME_RATE_LIMIT'),
    ).toHaveLength(39);
    expect(m.participantGate.mayReceiveConversation).toHaveBeenCalledTimes(1);
    expect([...sock.rooms].filter((room) => room.startsWith('conversation:'))).toHaveLength(1);
  });

  it('bounds sequential conversation membership without accepting a client room name', async () => {
    const { m, gw, sock } = await connected();
    m.participantGate.mayReceiveConversation.mockResolvedValue({ allowed: true, side: 'SEEKER' });
    for (let index = 0; index < MAX_CONVERSATION_ROOMS; index++) {
      expect(
        await gw.handleSubscribeConversation(sock as never, { conversationId: `c-${index}` }),
      ).toEqual({
        ok: true,
        room: `conversation:c-${index}`,
      });
    }
    expect(
      await gw.handleSubscribeConversation(sock as never, { conversationId: 'one-too-many' }),
    ).toEqual({
      ok: false,
      code: 'REALTIME_ROOM_LIMIT',
    });
    expect([...sock.rooms].filter((room) => room.startsWith('conversation:'))).toHaveLength(
      MAX_CONVERSATION_ROOMS,
    );
  });

  it('bounds slow authorization queues and closes a client instead of retaining unlimited packets', async () => {
    const { m, gw, sock } = await connected();
    let release!: () => void;
    m.sessionValidation.assertSessionActive.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    for (let index = 0; index <= MAX_PENDING_DELIVERIES_PER_SOCKET + 1; index++)
      gw.emitToRoom('user:u-1', event());
    expect(sock.disconnected).toBe(true);
    expect(sock.emitted).toContainEqual({
      event: 'error',
      payload: { code: 'REALTIME_BACKPRESSURE' },
    });
    const pending = gw as unknown as { deliveries: unknown[]; activeDeliveries: number };
    expect(pending.deliveries.length + pending.activeDeliveries).toBeLessThanOrEqual(
      MAX_PENDING_DELIVERIES_PER_SOCKET,
    );
    await Promise.resolve();
    release?.();
    await flush();
    expect(packets(sock)).toEqual([]);
  });
});
