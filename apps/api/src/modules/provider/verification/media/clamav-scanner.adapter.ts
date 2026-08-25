import { Injectable } from '@nestjs/common';
import { connect, type Socket } from 'node:net';

import { AppConfigService } from '../../../../config/app-config.service';
import { MalwareScannerPort, type ScanVerdict } from './malware-scanner.port';

// Sprint 9B.4 — the production scanner: clamd, spoken directly.
//
// docs/adr/0009-restricted-identity-media.md §5
//
// NO NEW DEPENDENCY, deliberately. An antivirus client library is a meaningful
// amount of third-party code sitting directly in front of untrusted bytes, on
// the one path in this system that handles files chosen by strangers. The wire
// format it would wrap is: one null-terminated command, length-prefixed chunks,
// and a single line of reply. That is cheaper to write than to audit, so it is
// written here against node:net.
//
// INSTREAM, from clamd's protocol documentation:
//
//     -> zINSTREAM\0
//     -> <uint32 be length><bytes>   (repeated)
//     -> <uint32 be 0>               (end of stream)
//     <- stream: OK\0
//        stream: <Signature> FOUND\0
//        <text> ERROR\0
//
// Everything that is not a positive OK or a positive FOUND is a FAILURE, never
// a clean file. That asymmetry is the whole adapter: a scanner that could not
// do its job must leave evidence unreadable and retryable, and the one outcome
// that must never be reachable by accident is CLEAN.

/** clamd enforces its own per-chunk ceiling (StreamMaxLength). 64 KiB is
 *  comfortably under every default and keeps a large upload from becoming one
 *  enormous frame after it has been streamed this far. */
const CHUNK_BYTES = 64 * 1024;

const DEFAULT_PORT = 3310;
const DEFAULT_TIMEOUT_MS = 30_000;

@Injectable()
export class ClamAvMalwareScanner extends MalwareScannerPort {
  readonly scannerId = 'clamav';
  readonly isRealScanner = true;

  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(config: AppConfigService) {
    super();
    const host = (config.get('CLAMAV_HOST') as string | undefined) ?? '';
    if (host.trim() === '') {
      // At construction, not at first scan: a misconfigured scanner must stop
      // the process rather than surface as an unexplained scan failure hours
      // later, on the one path where "not scanned" and "clean" must never be
      // confusable.
      throw new Error('CLAMAV_HOST is required when the clamav scanner driver is selected.');
    }
    this.host = host.trim();
    this.port = Number(config.get('CLAMAV_PORT') ?? DEFAULT_PORT);
    this.timeoutMs = Number(config.get('CLAMAV_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);
  }

  /**
   * Scan one body.
   *
   * RESOLVES rather than throws, always. The caller sweeps a batch, and an
   * adapter that threw would abandon every remaining asset in it because one
   * socket was refused.
   */
  async scan({ bytes }: { bytes: Uint8Array; assetId: string }): Promise<ScanVerdict> {
    try {
      const reply = await this.converse(bytes);
      return this.interpret(reply);
    } catch (err) {
      // Classify, never describe. `reason` is logged, so it carries no host,
      // no port, no path and nothing derived from the file.
      return { state: 'FAILED', scannerId: this.scannerId, reason: classify(err) };
    }
  }

  private converse(bytes: Uint8Array): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const socket: Socket = connect({ host: this.host, port: this.port });
      const out: Buffer[] = [];
      let settled = false;

      const done = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        fn();
      };

      socket.setTimeout(this.timeoutMs);
      socket.on('timeout', () => done(() => reject(new TimeoutError())));
      socket.on('error', (e) => done(() => reject(e)));
      socket.on('data', (d: Buffer) => out.push(d));
      socket.on('close', () =>
        done(() => {
          const text = Buffer.concat(out).toString('utf8').replace(/\0/g, '').trim();
          if (text === '') reject(new Error('empty-reply'));
          else resolve(text);
        }),
      );

      socket.on('connect', () => {
        socket.write(Buffer.from('zINSTREAM\0'));
        for (let at = 0; at < bytes.length; at += CHUNK_BYTES) {
          const slice = bytes.subarray(at, Math.min(at + CHUNK_BYTES, bytes.length));
          const header = Buffer.alloc(4);
          header.writeUInt32BE(slice.length, 0);
          socket.write(header);
          socket.write(Buffer.from(slice));
        }
        // Zero length terminates the stream and asks for the verdict.
        socket.write(Buffer.alloc(4));
      });
    });
  }

  /**
   * Turn one line of clamd into a verdict.
   *
   * FOUND is checked before OK. A signature name is attacker-influenced only in
   * the sense that it names what was detected, and the ordering means a reply
   * that somehow contains both words is treated as the more restrictive of the
   * two.
   */
  private interpret(reply: string): ScanVerdict {
    if (/\bFOUND\b/.test(reply)) {
      // "stream: Eicar-Test-Signature FOUND" -> "Eicar-Test-Signature"
      const match = /:\s*(.+?)\s+FOUND\b/.exec(reply);
      return {
        state: 'INFECTED',
        scannerId: this.scannerId,
        // The malware name, not the file. Recorded so "what was it?" has an
        // answer without keeping the bytes.
        signature: (match?.[1] ?? 'unknown').slice(0, 200),
      };
    }

    if (/\bERROR\b/.test(reply)) {
      return { state: 'FAILED', scannerId: this.scannerId, reason: 'scanner-error' };
    }

    if (/\bOK\b/.test(reply)) {
      return { state: 'CLEAN', scannerId: this.scannerId };
    }

    // Anything unrecognised is a failure. Guessing here is guessing about
    // whether a file is safe.
    return { state: 'FAILED', scannerId: this.scannerId, reason: 'unrecognised-reply' };
  }
}

class TimeoutError extends Error {
  constructor() {
    super('timeout');
    this.name = 'TimeoutError';
  }
}

/** A stable, non-sensitive classifier for a transport failure. */
function classify(err: unknown): string {
  const e = err as { name?: string; code?: string; message?: string };
  if (e?.name === 'TimeoutError') return 'timeout';
  switch (e?.code) {
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'connection-failed';
    case 'ECONNRESET':
    case 'EPIPE':
      return 'connection-reset';
    default:
      return e?.message === 'empty-reply' ? 'empty-reply' : 'transport-error';
  }
}
