import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

// argon2id parameters tuned for ~50-100ms per verify on commodity hardware.
// Memory-hard by design; review annually per OWASP guidance.
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService implements OnModuleInit {
  // Pre-computed once at boot so login timing is constant-time even for
  // non-existent users (anti-enumeration): we still run a real argon2.verify
  // against this dummy hash when the supplied user has no password on file.
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash('anti-enumeration-dummy', ARGON2_OPTIONS);
  }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  // Always performs a verify operation, even when `hash` is missing, to
  // neutralize user-enumeration via response-time differences on /login.
  async verify(hash: string | null | undefined, plain: string): Promise<boolean> {
    const target = hash && hash.length > 0 ? hash : this.dummyHash;
    try {
      const ok = await argon2.verify(target, plain);
      return ok && hash != null && hash.length > 0;
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }
}
