import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import type {
  AdminSettingFieldSchema,
  AdminSettingsValues,
} from '@homeservicemarketplace/contracts';

import { useAdminSettings, useUpdateAdminSettings } from '../../hooks/admin/useAdminSettings';

// Sprint 6.5 — extracted, real, API-driven Settings section.
// Replaces the prior PricingSettingsSection that used setTimeout(500)
// to fake persistence. Layout:
//
//   • Loads /v1/admin/settings on mount (whitelisted bulk).
//   • Renders one editor per schema field (integer / string / email
//     / currency / boolean).
//   • PATCHes /v1/admin/settings with only the changed fields.
//   • Client-side validation mirrors the server-side rules so the
//     operator sees errors before they hit the network.
//   • Loading / saving / error / success states are all explicit.

export function SettingsSection({ lang }: { lang: string }) {
  const isAr = lang === 'ar';
  const settingsQuery = useAdminSettings();
  const save = useUpdateAdminSettings();

  const data = settingsQuery.data;
  const [draft, setDraft] = useState<AdminSettingsValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  // Hydrate the draft from the most recent server payload.
  useEffect(() => {
    if (data) setDraft({ ...data.values });
  }, [data]);

  const dirtyKeys = useMemo(() => {
    if (!data) return [] as string[];
    const keys: string[] = [];
    for (const field of data.schema) {
      if (!shallowEqual(draft[field.key], data.values[field.key])) {
        keys.push(field.key);
      }
    }
    return keys;
  }, [draft, data]);

  const isDirty = dirtyKeys.length > 0;

  const L = {
    title: isAr ? 'الإعدادات' : 'Settings',
    save: isAr ? 'حفظ التغييرات' : 'Save changes',
    saving: isAr ? 'جارٍ الحفظ…' : 'Saving…',
    saved: isAr ? 'تم الحفظ' : 'Saved',
    revert: isAr ? 'إلغاء' : 'Discard',
    loading: isAr ? 'جارٍ التحميل…' : 'Loading…',
    failed: isAr ? 'تعذّر تحميل الإعدادات.' : 'Could not load settings.',
    saveFailed: isAr ? 'فشل الحفظ.' : 'Save failed.',
    lastUpdated: isAr ? 'آخر تحديث:' : 'Last updated:',
    never: isAr ? 'لم يُعدَّل بعد' : 'never',
    fixErrors: isAr ? 'يرجى تصحيح الأخطاء قبل الحفظ.' : 'Please fix the errors before saving.',
  };

  const onSave = async () => {
    if (!data || !isDirty) return;
    // Client-side validation pass; mirrors the server-side rules.
    const fieldErrors: Record<string, string> = {};
    const payload: AdminSettingsValues = {};
    for (const key of dirtyKeys) {
      const field = data.schema.find((f) => f.key === key)!;
      const next = draft[key];
      const err = validateClient(field, next);
      if (err) {
        fieldErrors[key] = err;
      } else {
        payload[key] = next;
      }
    }
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      setServerError(null);
      return;
    }
    setServerError(null);
    try {
      await save.mutateAsync({ values: payload });
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
          ? err.message
          : L.saveFailed;
      setServerError(message);
    }
  };

  const onRevert = () => {
    if (!data) return;
    setDraft({ ...data.values });
    setErrors({});
    setServerError(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2
          className="text-slate-900 dark:text-white"
          style={{ fontSize: '22px', fontWeight: 800 }}
        >
          {L.title}
        </h2>
        <p className="text-slate-400" style={{ fontSize: '11px' }}>
          {L.lastUpdated}{' '}
          <strong>
            {data?.lastUpdatedAt
              ? new Date(data.lastUpdatedAt).toLocaleString(isAr ? 'ar' : 'en')
              : L.never}
          </strong>
        </p>
      </div>

      {settingsQuery.isPending ? (
        <p className="text-slate-400 py-12 text-center" role="status" style={{ fontSize: '13px' }}>
          {L.loading}
        </p>
      ) : settingsQuery.isError ? (
        <p
          className="text-rose-600 px-4 py-2 rounded-2xl bg-rose-50 dark:bg-rose-900/30"
          role="status"
          style={{ fontSize: '13px' }}
        >
          {L.failed}
        </p>
      ) : data ? (
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-5 flex flex-col gap-4">
          {data.schema.map((field) => (
            <FieldEditor
              key={field.key}
              field={field}
              value={draft[field.key]}
              defaultValue={data.defaults[field.key]}
              error={errors[field.key]}
              onChange={(v) => setDraft((d) => ({ ...d, [field.key]: v }))}
            />
          ))}

          <div className="flex items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-700">
            <button
              type="button"
              onClick={onSave}
              disabled={!isDirty || save.isPending}
              className="px-3 py-1.5 rounded-2xl bg-blue-600 text-white disabled:opacity-50 flex items-center gap-1.5"
              style={{ fontSize: '12px', fontWeight: 700 }}
            >
              <Save size={13} />
              {save.isPending ? L.saving : L.save}
            </button>
            <button
              type="button"
              onClick={onRevert}
              disabled={!isDirty || save.isPending}
              className="px-3 py-1.5 rounded-2xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-50"
              style={{ fontSize: '12px', fontWeight: 700 }}
            >
              {L.revert}
            </button>
            {save.isSuccess && !isDirty ? (
              <span className="text-green-600" role="status" style={{ fontSize: '11px' }}>
                ✓ {L.saved}
              </span>
            ) : null}
            {Object.keys(errors).length > 0 ? (
              <span className="text-rose-600" role="status" style={{ fontSize: '11px' }}>
                {L.fixErrors}
              </span>
            ) : null}
            {serverError ? (
              <span className="text-rose-600" role="status" style={{ fontSize: '11px' }}>
                {serverError}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateClient(field: AdminSettingFieldSchema, value: unknown): string | null {
  switch (field.type) {
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'Must be an integer.';
      if (field.min !== undefined && value < field.min) return `Must be ≥ ${field.min}.`;
      if (field.max !== undefined && value > field.max) return `Must be ≤ ${field.max}.`;
      return null;
    case 'string':
      if (typeof value !== 'string' || value.trim().length === 0) return 'Must not be empty.';
      return null;
    case 'boolean':
      if (typeof value !== 'boolean') return 'Must be true or false.';
      return null;
    case 'email':
      if (
        typeof value !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase())
      )
        return 'Must be a valid email address.';
      return null;
    case 'currency':
      if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value))
        return 'Must be a 3-letter ISO code (e.g., USD).';
      return null;
    default:
      return null;
  }
}

function FieldEditor({
  field,
  value,
  defaultValue,
  error,
  onChange,
}: {
  field: AdminSettingFieldSchema;
  value: unknown;
  defaultValue: unknown;
  error: string | undefined;
  onChange: (v: unknown) => void;
}) {
  const id = `setting-${field.key}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-slate-700 dark:text-slate-200"
        style={{ fontSize: '13px', fontWeight: 700 }}
      >
        {field.key}
      </label>
      <p className="text-slate-500" style={{ fontSize: '11px' }}>
        {field.description}{' '}
        <span className="text-slate-400">
          (default: <code>{String(defaultValue)}</code>)
        </span>
      </p>
      {field.type === 'integer' ? (
        <input
          id={id}
          type="number"
          value={typeof value === 'number' ? value : ''}
          min={field.min}
          max={field.max}
          step={1}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange('' as unknown as number);
            const parsed = Number.parseInt(raw, 10);
            onChange(Number.isNaN(parsed) ? raw : parsed);
          }}
          className="px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          style={{ fontSize: '13px' }}
        />
      ) : field.type === 'boolean' ? (
        <label className="flex items-center gap-2" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="text-slate-600 dark:text-slate-300" style={{ fontSize: '12px' }}>
            {value ? 'enabled' : 'disabled'}
          </span>
        </label>
      ) : (
        <input
          id={id}
          type={field.type === 'email' ? 'email' : 'text'}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => {
            // Normalise currency codes to uppercase as they're typed.
            const raw = e.target.value;
            onChange(field.type === 'currency' ? raw.toUpperCase() : raw);
          }}
          className="px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          style={{ fontSize: '13px' }}
        />
      )}
      {error ? (
        <p className="text-rose-600" role="alert" style={{ fontSize: '11px' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
