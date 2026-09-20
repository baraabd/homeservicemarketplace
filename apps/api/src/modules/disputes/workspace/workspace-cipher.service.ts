import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfigService } from '../../../config/app-config.service';
import { AppError } from '../../../shared/errors/app-error';

/** AEAD context prevents swapping private fields across cases or owners.
 * No decryption output leaves this boundary before authentication succeeds.
 * Configuration is optional while the workflow is disabled; absent keys fail closed.
 */
@Injectable()
export class WorkspaceCipher {
  constructor(private readonly config: AppConfigService) {}
  private keys() {
    try {
      const active = this.config.get('DISPUTE_PRIVATE_ACTIVE_KEY');
      const keys: unknown = JSON.parse(this.config.get('DISPUTE_PRIVATE_KEYS_JSON') || '{}');
      if (!active || !keys || typeof keys !== 'object' || Array.isArray(keys))
        throw new Error('unconfigured');
      const parsed = new Map<string, Buffer>();
      for (const [id, value] of Object.entries(keys)) {
        if (
          !/^[a-zA-Z0-9_-]{1,32}$/.test(id) ||
          typeof value !== 'string' ||
          !/^[A-Za-z0-9+/]{43}=$/.test(value)
        )
          throw new Error('invalid');
        const key = Buffer.from(value, 'base64');
        if (key.length !== 32 || key.toString('base64') !== value) throw new Error('invalid');
        parsed.set(id, key);
      }
      if (!parsed.has(active) || parsed.size > 10) throw new Error('invalid');
      return { active, keys: parsed };
    } catch {
      // Do not attach a parser cause: it can contain the key material.
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Private case storage is unavailable.', 503);
    }
  }
  ready(): void {
    this.keys();
  }
  seal(bytes: Uint8Array, context: string): string {
    const { active, keys } = this.keys();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keys.get(active)!, nonce, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(`HSM-DISPUTE-V1:${context}`));
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return JSON.stringify({
      v: 1,
      k: active,
      n: nonce.toString('base64'),
      t: cipher.getAuthTag().toString('base64'),
      c: encrypted.toString('base64'),
    });
  }
  open(envelope: string, context: string): Buffer {
    const { keys } = this.keys();
    try {
      if (envelope.length > 8 * 1024 * 1024) throw new Error('oversized');
      const value: unknown = JSON.parse(envelope);
      if (!value || typeof value !== 'object') throw new Error('invalid');
      const { v, k, n, t, c } = value as Record<string, unknown>;
      if (
        v !== 1 ||
        typeof k !== 'string' ||
        typeof n !== 'string' ||
        typeof t !== 'string' ||
        typeof c !== 'string' ||
        !keys.has(k)
      )
        throw new Error('invalid');
      const nonce = Buffer.from(n, 'base64');
      const tag = Buffer.from(t, 'base64');
      if (nonce.length !== 12 || tag.length !== 16) throw new Error('invalid');
      const decipher = createDecipheriv('aes-256-gcm', keys.get(k)!, nonce, { authTagLength: 16 });
      decipher.setAAD(Buffer.from(`HSM-DISPUTE-V1:${context}`));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(c, 'base64')), decipher.final()]);
    } catch {
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Private case data could not be verified.', 503);
    }
  }
  encode(value: unknown, context: string): string {
    return this.seal(Buffer.from(JSON.stringify(value)), context);
  }
  decode<T>(value: string, context: string): T {
    try {
      return JSON.parse(this.open(value, context).toString('utf8')) as T;
    } catch {
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Private case data could not be verified.', 503);
    }
  }
}
