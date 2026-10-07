import { Injectable } from '@nestjs/common';
import {
  ADMIN_SETTINGS_SCHEMA,
  type AdminSettingsBulkResponse,
  type AdminSettingValue,
  type AdminSettingsValues,
  type AdminSettingHistoryEntry,
  type AdminSettingHistoryResponse,
  type ListSettingsResponse,
  type SettingMutationResponse,
  type UpdateAdminSettingsResponse,
} from '@homeservicemarketplace/contracts';
import type { AuditEventType, Prisma, PrismaTx } from '@homeservicemarketplace/database';

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
import { assertWritable, settingEntry, validateSettingValue } from './setting-registry';

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
      // R17-D: every field states whether the platform reads it.
      schema: ADMIN_SETTINGS_SCHEMA.map((field) => ({
        ...field,
        inEffect: field.inEffect !== false,
      })),
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
    // R17-D: one registry decides key, type, range and writability for both
    // the bulk and the keyed surface. The bulk surface is the Settings screen,
    // so it accepts its scalar fields only. A Map holds the result: a key is
    // never used as a property name on a plain object.
    const normalised = new Map<string, unknown>();
    for (const key of keys) {
      const entry = settingEntry(key);
      if (entry.kind !== 'scalar') throw new AppError('VALIDATION_ERROR', 'Unknown setting.', 400);
      assertWritable(entry);
      normalised.set(key, validateSettingValue(entry, incoming[key]));
    }
    const changedKeys: string[] = [];
    await this.tx.run(async (tx) => {
      await this.lockKeys([...normalised.keys()], tx);
      for (const [key, newValue] of normalised) {
        const previous = await this.settings.findByKey(key, tx);
        const previousValue = previous ? previous.value : null;
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

  // Legacy keyed surface (R17-D): the same registry as the bulk surface,
  // plus the structured operator policies whose consumers own a parser
  // (dispute intake/workflow, supported markets). Unknown keys, wrong types,
  // out-of-range values and inert settings are refused before any write.
  async upsert(adminUserId: string, key: string, value: unknown): Promise<SettingMutationResponse> {
    const entry = settingEntry(key);
    assertWritable(entry);
    const newValue = validateSettingValue(entry, value) as Prisma.JsonValue;
    const result = await this.tx.run(async (tx) => {
      await this.lockKeys([key], tx);
      const previous = await this.settings.findByKey(key, tx);
      const previousValue = previous ? previous.value : null;
      const changed = !previous || !deepEqual(previousValue, newValue);
      const row = changed
        ? await this.settings.upsert({ key, value: newValue, updatedBy: adminUserId }, tx)
        : previous;
      if (changed)
        await this.history.append(
          { key, previousValue, newValue, changedBy: adminUserId, reason: null },
          tx,
        );
      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_SETTING_UPDATED' as AuditEventType,
          metadata: { key, previousValue, newValue, source: 'keyed', changed },
        },
        tx,
      );
      return row;
    });
    return { setting: toSummary(result) };
  }

  async remove(adminUserId: string, key: string): Promise<void> {
    // Deleting reverts a registered setting to its default (or, for a policy,
    // to absent, which its consumer treats as disabled). A key outside the
    // registry is not this surface's to delete.
    assertWritable(settingEntry(key));
    await this.tx.run(async (tx) => {
      await this.lockKeys([key], tx);
      const previous = await this.settings.findByKey(key, tx);
      if (!previous) throw new AppError('NOT_FOUND', 'Setting not found.', 404);
      await this.settings.delete(key, tx);
      // A deletion is a change of value, so it belongs in the trail. `null`
      // records "reverted to the default".
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

  /**
   * Serialises writers of the same keys for the rest of the transaction, so
   * each history row's previousValue is what the earlier write left. Sorted,
   * so two multi-key writes always lock in the same order.
   */
  private async lockKeys(keys: string[], tx: PrismaTx): Promise<void> {
    for (const key of [...keys].sort())
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform_setting:${key}`}))`;
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

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}
