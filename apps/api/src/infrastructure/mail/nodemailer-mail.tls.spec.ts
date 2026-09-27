import { createServer, type Socket } from 'node:net';

import type { AppConfigService } from '../../config/app-config.service';
import { NodemailerMailAdapter } from './nodemailer-mail.adapter';

/** Real loopback SMTP transport, no mocked nodemailer and no external mailbox. */
describe('hardened SMTP downgrade refusal', () => {
  it('does not send an envelope or message when the relay cannot negotiate TLS', async () => {
    const commands: string[] = [];
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => socket.destroy());
      socket.setEncoding('utf8');
      socket.write('220 fixture ESMTP\r\n');
      let buffer = '';
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let boundary: number;
        while ((boundary = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          commands.push(line.split(' ')[0]!.toUpperCase());
          if (/^EHLO /iu.test(line)) socket.write('250-fixture\r\n250 PIPELINING\r\n');
          else if (/^STARTTLS$/iu.test(line)) socket.write('454 TLS is not available\r\n');
          else if (/^QUIT$/iu.test(line)) socket.end('221 Bye\r\n');
          else socket.write('250 OK\r\n');
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected loopback TCP address');
      const values: Record<string, unknown> = {
        SMTP_HOST: '127.0.0.1', SMTP_PORT: address.port, SMTP_SECURE: false,
        SMTP_FROM: 'sender@example.test',
      };
      const config = { get: (key: string) => values[key], isProduction: true } as unknown as AppConfigService;
      const adapter = new NodemailerMailAdapter(config);
      adapter.onModuleInit();
      await expect(adapter.send({
        to: 'recipient@example.test', subject: 'Synthetic TLS rejection', text: 'Never delivered',
      })).rejects.toBeDefined();
      expect(commands).toContain('EHLO');
      expect(commands).toContain('STARTTLS');
      expect(commands).not.toContain('MAIL');
      expect(commands).not.toContain('RCPT');
      expect(commands).not.toContain('DATA');
      expect(commands).not.toContain('AUTH');
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15000);
});
