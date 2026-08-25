import { createServer, type Server, type Socket } from 'node:net';

import { ClamAvMalwareScanner } from './clamav-scanner.adapter';

// Sprint 9B.4 — the production scanner adapter, against a real socket.
//
// clamd's INSTREAM protocol is spoken over TCP with node:net, so this adapter
// adds NO dependency: an antivirus client library is a large amount of
// third-party code sitting directly in front of untrusted bytes, and the wire
// format here is a command, length-prefixed chunks, and one line of reply.
//
// These tests run a real clamd-speaking server on a loopback port rather than
// mocking the socket. A mock would assert that this adapter calls the methods
// this adapter calls; a server asserts it speaks the protocol.

/** Reads an INSTREAM conversation and replies with `reply`. */
function fakeClamd(options: {
  reply?: string;
  /** Never answer, to exercise the timeout. */
  silent?: boolean;
  /** Close the connection mid-conversation. */
  hangUp?: boolean;
  onChunks?: (chunks: Buffer[]) => void;
}): Promise<{ server: Server; port: number }> {
  const server = createServer((socket: Socket) => {
    const chunks: Buffer[] = [];
    let buffer = Buffer.alloc(0);
    let sawCommand = false;

    socket.on('data', (data: Buffer) => {
      if (options.hangUp) {
        socket.destroy();
        return;
      }
      buffer = Buffer.concat([buffer, data]);

      if (!sawCommand) {
        const nul = buffer.indexOf(0);
        if (nul < 0) return;
        sawCommand = true;
        buffer = buffer.subarray(nul + 1);
      }

      // Length-prefixed chunks until a zero length.
      for (;;) {
        if (buffer.length < 4) return;
        const len = buffer.readUInt32BE(0);
        if (len === 0) {
          buffer = buffer.subarray(4);
          options.onChunks?.(chunks);
          if (!options.silent) socket.end(Buffer.from(`${options.reply ?? 'stream: OK'}\0`));
          return;
        }
        if (buffer.length < 4 + len) return;
        chunks.push(Buffer.from(buffer.subarray(4, 4 + len)));
        buffer = buffer.subarray(4 + len);
      }
    });
    socket.on('error', () => undefined);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : 0 });
    });
  });
}

function scanner(port: number, over: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    CLAMAV_HOST: '127.0.0.1',
    CLAMAV_PORT: port,
    CLAMAV_TIMEOUT_MS: 5000,
    ...over,
  };
  return new ClamAvMalwareScanner({ get: (k: string) => values[k] } as never);
}

const BYTES = new Uint8Array(Buffer.from('%PDF-1.4 evidence'));

describe('ClamAvMalwareScanner', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    // Every server closed, every time. A leaked listener is what turns one
    // careless suite into another suite's mysterious failure.
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  });

  async function start(options: Parameters<typeof fakeClamd>[0]) {
    const { server, port } = await fakeClamd(options);
    servers.push(server);
    return port;
  }

  it('identifies itself and claims to be real', () => {
    const s = scanner(1);
    expect(s.scannerId).toBe('clamav');
    expect(s.isRealScanner).toBe(true);
  });

  it('returns CLEAN when clamd says OK', async () => {
    const port = await start({ reply: 'stream: OK' });
    await expect(scanner(port).scan({ bytes: BYTES, assetId: 'a1' })).resolves.toEqual({
      state: 'CLEAN',
      scannerId: 'clamav',
    });
  });

  it('returns INFECTED with the signature clamd named', async () => {
    const port = await start({ reply: 'stream: Eicar-Test-Signature FOUND' });
    await expect(scanner(port).scan({ bytes: BYTES, assetId: 'a1' })).resolves.toEqual({
      state: 'INFECTED',
      scannerId: 'clamav',
      signature: 'Eicar-Test-Signature',
    });
  });

  it('treats a clamd ERROR as a scan failure, not a clean file', async () => {
    // The whole family of "clamd could not do its job" answers must never
    // become CLEAN. SCAN_FAILED is retryable; CLEAN is not recoverable.
    const port = await start({ reply: 'INSTREAM size limit exceeded. ERROR' });
    const v = await scanner(port).scan({ bytes: BYTES, assetId: 'a1' });
    expect(v.state).toBe('FAILED');
  });

  it('treats an unrecognised reply as a failure rather than guessing', async () => {
    const port = await start({ reply: 'something nobody has seen before' });
    const v = await scanner(port).scan({ bytes: BYTES, assetId: 'a1' });
    expect(v.state).toBe('FAILED');
  });

  it('fails when clamd cannot be reached at all', async () => {
    // Port 1 on loopback: nothing listens there.
    const v = await scanner(1).scan({ bytes: BYTES, assetId: 'a1' });
    expect(v.state).toBe('FAILED');
  });

  it('fails when clamd hangs up mid-conversation', async () => {
    const port = await start({ hangUp: true });
    const v = await scanner(port).scan({ bytes: BYTES, assetId: 'a1' });
    expect(v.state).toBe('FAILED');
  });

  it('fails on timeout instead of hanging forever', async () => {
    const port = await start({ silent: true });
    const v = await scanner(port, { CLAMAV_TIMEOUT_MS: 150 }).scan({
      bytes: BYTES,
      assetId: 'a1',
    });
    expect(v.state).toBe('FAILED');
    expect(v.state === 'FAILED' && v.reason).toMatch(/timeout/i);
  });

  it('streams the body in bounded chunks rather than one write', async () => {
    // A 10 MiB upload must not become a single 10 MiB frame. clamd has its own
    // per-chunk ceiling, and buffering the whole file defeats the point of
    // having streamed it this far.
    let seen: Buffer[] = [];
    const port = await start({ onChunks: (c) => (seen = c) });
    const big = new Uint8Array(200_000);
    await scanner(port).scan({ bytes: big, assetId: 'a1' });
    expect(seen.length).toBeGreaterThan(1);
    expect(Buffer.concat(seen).length).toBe(big.length);
    for (const c of seen) expect(c.length).toBeLessThanOrEqual(65_536);
  });

  it('never puts the host, port or file bytes into a failure reason', async () => {
    // The reason is logged. It classifies; it does not describe infrastructure
    // or content.
    const v = await scanner(1).scan({
      bytes: new Uint8Array(Buffer.from('SENTINELCONTENT')),
      assetId: 'a1',
    });
    const text = v.state === 'FAILED' ? v.reason : '';
    expect(text).not.toContain('127.0.0.1');
    expect(text).not.toContain('SENTINELCONTENT');
    expect(text).not.toMatch(/\b\d{1,5}\b/);
  });

  it('reports a failure rather than throwing, so one bad scan cannot crash a sweep', async () => {
    // The caller loops over a batch. An adapter that throws would abandon
    // every remaining asset in it.
    await expect(scanner(1).scan({ bytes: BYTES, assetId: 'a1' })).resolves.toBeDefined();
  });

  it('refuses to construct without a host', () => {
    expect(() => scanner(1, { CLAMAV_HOST: '' })).toThrow(/clamav/i);
  });
});
