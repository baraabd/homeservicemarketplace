import type { AppConfigService } from '../../config/app-config.service';
import type { TokenService } from '../iam/authentication/services/token.service';
import type { ConversationParticipantGate } from './conversation-participant.gate';
import { RealtimeGateway } from './realtime.gateway';

// Minimal Socket.IO Socket fake — only the surfaces the gateway
// touches during connection / disconnect / subscribe:conversation.
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

interface Mocks {
  tokens: { verifyAccessToken: jest.Mock };
  config: { get: jest.Mock };
  participantGate: {
    findProviderProfileId: jest.Mock;
    userIsParticipant: jest.Mock;
  };
}

function makeMocks(over: Partial<Mocks> = {}): Mocks {
  return {
    tokens: { verifyAccessToken: jest.fn() },
    config: {
      get: jest.fn().mockImplementation((k) => (k === 'REALTIME_SOCKET_IO' ? true : null)),
    },
    participantGate: {
      findProviderProfileId: jest.fn().mockResolvedValue(null),
      userIsParticipant: jest.fn().mockResolvedValue(false),
    },
    ...over,
  } as Mocks;
}

function makeGateway(m: Mocks): RealtimeGateway {
  const gw = new RealtimeGateway(
    m.tokens as unknown as TokenService,
    m.config as unknown as AppConfigService,
    m.participantGate as unknown as ConversationParticipantGate,
  );
  // Server is set by NestJS at runtime; tests don't call emitToRoom.
  return gw;
}

describe('RealtimeGateway', () => {
  describe('handshake', () => {
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
  });

  describe('server-owned room joins', () => {
    it('a non-provider, non-admin user joins only user:{id}', async () => {
      const m = makeMocks();
      m.tokens.verifyAccessToken.mockReturnValue({ sub: 'u-1', roles: ['seeker'] });
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.joined).toEqual(['user:u-1']);
      expect(sock.emitted.find((e) => e.event === 'connection.ack')?.payload).toMatchObject({
        userId: 'u-1',
        joinedRooms: ['user:u-1'],
      });
    });

    it('a provider user also joins provider:{profileId}', async () => {
      const m = makeMocks();
      m.tokens.verifyAccessToken.mockReturnValue({ sub: 'u-2', roles: ['provider'] });
      m.participantGate.findProviderProfileId.mockResolvedValue('prof-9');
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.joined).toEqual(['user:u-2', 'provider:prof-9']);
    });

    it('an admin user also joins the admin room', async () => {
      const m = makeMocks();
      m.tokens.verifyAccessToken.mockReturnValue({ sub: 'u-3', roles: ['admin'] });
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.joined).toEqual(['user:u-3', 'admin']);
    });

    it('a seeker user does NOT join the admin room', async () => {
      const m = makeMocks();
      m.tokens.verifyAccessToken.mockReturnValue({ sub: 'u-4', roles: ['seeker'] });
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      expect(sock.joined).not.toContain('admin');
    });
  });

  describe('subscribe:conversation', () => {
    async function connectedSocket(
      m: Mocks,
      sub: string,
      roles: string[] = [],
    ): Promise<{ gw: RealtimeGateway; sock: FakeSocket }> {
      m.tokens.verifyAccessToken.mockReturnValue({ sub, roles });
      const gw = makeGateway(m);
      const sock = makeSocket('jwt');
      await gw.handleConnection(sock as never);
      return { gw, sock };
    }

    it('joins conversation:{id} when the participant gate passes', async () => {
      const m = makeMocks();
      m.participantGate.userIsParticipant.mockResolvedValue(true);
      const { gw, sock } = await connectedSocket(m, 'u-5');
      const res = await gw.handleSubscribeConversation(sock as never, { conversationId: 'c-42' });
      expect(res).toEqual({ ok: true, room: 'conversation:c-42' });
      expect(sock.joined).toContain('conversation:c-42');
    });

    it('refuses with FORBIDDEN when the user is not a participant', async () => {
      const m = makeMocks();
      m.participantGate.userIsParticipant.mockResolvedValue(false);
      const { gw, sock } = await connectedSocket(m, 'u-6');
      const res = await gw.handleSubscribeConversation(sock as never, { conversationId: 'c-99' });
      expect(res).toEqual({ ok: false, code: 'FORBIDDEN' });
      expect(sock.joined).not.toContain('conversation:c-99');
    });

    it('refuses with VALIDATION_ERROR when conversationId is empty', async () => {
      const m = makeMocks();
      const { gw, sock } = await connectedSocket(m, 'u-7');
      const res = await gw.handleSubscribeConversation(sock as never, { conversationId: '' });
      expect(res).toEqual({ ok: false, code: 'VALIDATION_ERROR' });
      expect(m.participantGate.userIsParticipant).not.toHaveBeenCalled();
    });
  });
});
