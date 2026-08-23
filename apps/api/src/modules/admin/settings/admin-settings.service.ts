import { Injectable } from '@nestjs/common';
import {
  ADMIN_SETTINGS_SCHEMA,
  type AdminSettingFieldSchema,
  type AdminSettingsBulkResponse,
  type AdminSettingValue,
  type AdminSettingsValues,
  type AdminSettingHistoryEntry,
  type AdminSettingHistoryResponse,
  type ListSettingsResponse,
  type SettingMutationResponse,
  type UpdateAdminSettingsResponse,
} from '@homeservicemarketplace/contracts';
import type { AuditEventType, Prisma } from '@homeservicemarketplace/database';

import {
  PlatformSettingRepository,
  type PlatformSettingRow,
} from '../../../infrastructure/persistence/settings/platform-setting.repository';
import {
  PlatformSettingHistoryRepository,
  type PlatformSettingHistoryRow,
} from '../../../infrastructure/persistence/settings/platform-setting-history.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { AdminAuditService } from '../admin-audit.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

// Sprint 6.5 — admin platform settings service.
//
// Two surface flavours:
//   • bulk (`getBulk` / `updateBulk`): the canonical UI surface;
//     reads/writes a whitelisted set of keys with per-type validation.
//   • keyed (`list` / `detail` / `upsert` / `remove`): legacy
//     surface for ad-hoc read/write of any key. Kept callable for
//     advanced operators; not the normal path.
//
// Every mutation writes an `ADMIN_SETTING_UPDATED` audit row with
// before/after metadata.
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly settings: PlatformSettingRepository,
    // Sprint 8 — the append-only trail. Written in the SAME transaction as
    // every value change, because a history that commits separately grows
    // holes exactly where someone had a reason to want one.
    private readonly history: PlatformSettingHistoryRepository,
    private readonly audit: AdminAuditService,
    private readonly tx: TransactionRunner,
  ) {}

  // ─── Bulk surface (Sprint 6.5 canonical) ─────────────────────

  async getBulk(): Promise<AdminSettingsBulkResponse> {
    const rows = await this.settings.list();
    const byKey = new Map(rows.map((r) => [r.key, r] as const));
    const values: AdminSettingsValues = {};
    const defaults: AdminSettingsValues = {};
    let lastUpdatedAt: Date | null = null;
    for (const field of ADMIN_SETTINGS_SCHEMA) {
      defaults[field.key] = field.default;
      const row = byKey.get(field.key);
      values[field.key] = row ? row.value : field.default;
      if (row && (!lastUpdatedAt || row.updatedAt > lastUpdatedAt)) {
        lastUpdatedAt = row.updatedAt;
      }
    }
    return {
      values,
      defaults,
      schema: ADMIN_SETTINGS_SCHEMA,
      lastUpdatedAt: lastUpdatedAt ? lastUpdatedAt.toISOString() : null,
    };
  }

  async updateBulk(
    adminUserId: string,
    incoming: AdminSettingsValues,
  ): Promise<UpdateAdminSettingsResponse> {
    const keys = Object.keys(incoming);
    if (keys.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'At least one setting must be provided.', 400);
    }
    // Whitelist + per-key type validation. Both errors surface as
    // VALIDATION_ERROR so the wire shape doesn't differ between
    // "unknown key" and "wrong type".
    const normalised: Record<string, unknown> = {};
    for (const key of keys) {
      const field = ADMIN_SETTINGS_SCHEMA.find((f) => f.key === key);
      if (!field) {
        throw new AppError('VALIDATION_ERROR', `Unknown setting: ${key}`, 400);
      }
      normalised[key] = validateAndNormalise(field, incoming[key]);
    }
    const changedKeys: string[] = [];
    await this.tx.run(async (tx) => {
      for (const key of Object.keys(normalised)) {
        const previous = await this.settings.findByKey(key, tx);
        const previousValue = previous ? previous.value : null;
        const newValue = normalised[key];
        // Idempotent: same value → skip the write but still emit
        // the audit row so the operator's intent is captured.
        const changed = !deepEqual(previousValue, newValue);
        if (changed) {
          await this.settings.upsert(
            { key, value: newValue as Prisma.JsonValue, updatedBy: adminUserId },
            tx,
          );
          // Sprint 8 — same transaction as the write above, so a value can
          // never land without its trail entry.
          //
          // Only on an ACTUAL change. An idempotent same-value write still
          // gets an audit row (the operator's intent is worth recording) but
          // not a history row, because a history of non-changes buries the
          // changes it exists to surface.
          await this.history.append(
            {
              key,
              previousValue,
              newValue: newValue as Prisma.JsonValue,
              changedBy: adminUserId,
              reason: null,
            },
            tx,
          );
          changedKeys.push(key);
        }
        await this.audit.record(
          {
            adminUserId,
            type: 'ADMIN_SETTING_UPDATED' as AuditEventType,
            metadata: {
              key,
              previousValue,
              newValue,
              source: 'bulk',
              changed,
            },
          },
          tx,
        );
      }
    });
    const fresh = await this.getBulk();
    return {
      values: fresh.values,
      changedKeys,
      lastUpdatedAt: fresh.lastUpdatedAt,
    };
  }

  // ─── Legacy keyed surface ────────────────────────────────────

  async list(): Promise<ListSettingsResponse> {
    const rows = await this.settings.list();
    return { items: rows.map(toSummary) };
  }

  async detail(key: string): Promise<AdminSettingValue> {
    const row = await this.settings.findByKey(key);
    if (!row) throw new AppError('NOT_FOUND', 'Setting not found.', 404);
    return toSummary(row);
  }

  /**
   * Sprint 8 — GET /v1/admin/settings/:key/history.
   *
   * Append-only, newest first. Answers "what was this value when that decision
   * was made?", which the current-value row cannot: it is overwritten by the
   * next write, and the next write is usually the one someone is disputing.
   *
   * Readable for ANY key, including ones not in the whitelist. The trail of a
   * key that has since been removed from the schema is exactly the trail most
   * worth keeping readable.
   */
  async historyForKey(
    key: string,
    args: { limit: number; cursor?: string },
  ): Promise<AdminSettingHistoryResponse> {
    // Over-fetch by one to decide whether another page exists, rather than
    // issuing a second COUNT over an append-only table that only grows.
    const rows = await this.history.listByKey({
      key,
      take: args.limit + 1,
      cursor: args.cursor,
    });
    const page = rows.slice(0, args.limit);
    return {
      key,
      items: page.map(toHistoryEntry),
      nextCursor: rows.length > args.limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async upsert(adminUserId: string, key: string, value: unknown): Promise<SettingMutationResponse> {
    const result = await this.tx.run(async (tx) => {
      const previous = await this.settings.findByKey(key, tx);
      const next = await this.settings.upsert(
        { key, value: value as Prisma.JsonValue, updatedBy: adminUserId },
        tx,
      );
      await this.history.append(
        {
          key,
          previousValue: previous?.value ?? null,
          newValue: value as Prisma.JsonValue,
          changedBy: adminUserId,
          reason: null,
        },
        tx,
      );
      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_SETTING_UPDATED' as AuditEventType,
          metadata: {
            key,
            previousValue: previous?.value ?? null,
            newValue: value as Prisma.JsonValue,
            source: 'keyed',
          },
        },
        tx,
      );
      return next;
    });
    return { setting: toSummary(result) };
  }

  async remove(adminUserId: string, key: string): Promise<void> {
    await this.tx.run(async (tx) => {
      const previous = await this.settings.findByKey(key, tx);
      if (!previous) throw new AppError('NOT_FOUND', 'Setting not found.', 404);
      await this.settings.delete(key, tx);
      // A deletion is a change of value, so it belongs in the trail. `null`
      // records "reverted to the schema default", which is what deleting a
      // row actually does — the read path falls back to the default.
      await this.history.append(
        {
          key,
          previousValue: previous.value,
          newValue: null as unknown as Prisma.JsonValue,
          changedBy: adminUserId,
          reason: 'deleted',
        },
        tx,
      );
      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_SETTING_UPDATED' as AuditEventType,
          metadata: {
            key,
            action: 'deleted',
            previousValue: previous.value,
            newValue: null,
            source: 'keyed',
          },
        },
        tx,
      );
    });
  }
}

function toHistoryEntry(row: PlatformSettingHistoryRow): AdminSettingHistoryEntry {
  return {
    id: row.id,
    key: row.key,
    previousValue: row.previousValue ?? null,
    newValue: row.newValue,
    changedBy: row.changedBy,
    changedAt: row.changedAt.toISOString(),
    reason: row.reason,
  };
}

function toSummary(row: PlatformSettingRow): AdminSettingValue {
  return {
    key: row.key,
    value: row.value,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

// ─── per-type validation ────────────────────────────────────────

function validateAndNormalise(field: AdminSettingFieldSchema, value: unknown): unknown {
  switch (field.type) {
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw new AppError('VALIDATION_ERROR', `\`${field.key}\` must be an integer.`, 400);
      }
      if (field.min !== undefined && value < field.min) {
        throw new AppError('VALIDATION_ERROR', `\`${field.key}\` must be ≥ ${field.min}.`, 400);
      }
      if (field.max !== undefined && value > field.max) {
        throw new AppError('VALIDATION_ERROR', `\`${field.key}\` must be ≤ ${field.max}.`, 400);
      }
      return value;
    }
    case 'string': {
      if (typeof value !== 'string') {
        throw new AppError('VALIDATION_ERROR', `\`${field.key}\` must be a string.`, 400);
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new AppError('VALIDATION_ERROR', `\`${field.key}\` must not be empty.`, 400);
      }
      if (trimmed.length > 1000) {
        throw new AppError('VALIDATION_ERROR', `\`${field.key}\` exceeds 1000 chars.`, 400);
      }
      return trimmed;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw new AppError('VALIDATION_ERROR', `\`${field.key}\` must be true or false.`, 400);
      }
      return value;
    }
    case 'email': {
      if (typeof value !== 'string') {
        throw new AppError(
          'VALIDATION_ERROR',
          `\`${field.key}\` must be a valid email address.`,
          400,
        );
      }
      const normalised = value.trim().toLowerCase();
      if (!EMAIL_RE.test(normalised)) {
        throw new AppError(
          'VALIDATION_ERROR',
          `\`${field.key}\` must be a valid email address.`,
          400,
        );
      }
      return normalised;
    }
    case 'currency': {
      if (typeof value !== 'string' || !CURRENCY_RE.test(value)) {
        throw new AppError(
          'VALIDATION_ERROR',
          `\`${field.key}\` must be an ISO-4217 3-letter uppercase code.`,
          400,
        );
      }
      return value;
    }
    default: {
      // Exhaustiveness check — TS will complain if a new
      // AdminSettingType is added without a case here.
      const _exhaustive: never = field.type;
      void _exhaustive;
      throw new AppError('VALIDATION_ERROR', `Unsupported setting type.`, 400);
    }
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}
