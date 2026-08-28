import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { ServiceCategorySummary } from '@homeservicemarketplace/contracts';

import { SERVICES_COPY, type Lang } from '../copy/services-copy';

// Sprint 9B.18 — choosing services, at catalogue scale.
//
// WHAT THIS REPLACES
//
// A flat cloud of toggle chips, one per selectable category. That works for
// twelve categories and collapses at two hundred: everything is on screen at
// once, nothing is grouped, there is no way to find anything without reading
// all of it, and on a phone it is several screens of tapping.
//
// So: a search box that filters, and groups that expand. The catalogue itself
// is unchanged and still the single source — this reads `useServiceCategories`
// like every other surface and adds no second list of its own.
//
// WHAT IT DELIBERATELY DOES NOT SHOW
//
// Review state. A chip here answers "have I chosen this?" and nothing else.
// Whether an admin has approved it is a different question with a different
// answer for each item, and cramming it into a badge on every chip is what
// made the old screen unreadable — and what made a PENDING item look like a
// validation failure. That belongs to the state list, below this picker.

interface SpecialtyPickerProps {
  categories: ServiceCategorySummary[];
  /** Ids the provider has chosen — approved, pending or otherwise. */
  chosen: string[];
  maxSpecialties: number;
  lang: Lang;
  disabled?: boolean;
  onToggle: (categoryId: string) => void;
}

export function SpecialtyPicker({
  categories,
  chosen,
  maxSpecialties,
  lang,
  disabled = false,
  onToggle,
}: SpecialtyPickerProps) {
  const copy = SERVICES_COPY[lang];
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<string[]>([]);

  const label = (c: ServiceCategorySummary) => (lang === 'ar' ? c.labelAr : c.labelEn);

  // `isLeaf` is READ from the catalogue, never inferred from "has no children"
  // — a parent whose last child was retired must not silently become
  // selectable. This is the same rule the server enforces.
  const groups = useMemo(
    () => categories.filter((c) => !c.isLeaf).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  );
  const leaves = useMemo(
    () => categories.filter((c) => c.isLeaf).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  );

  const trimmed = query.trim().toLowerCase();
  // Searching matches BOTH languages regardless of the interface language: a
  // provider reading Arabic may well know the English trade word, and refusing
  // to match it would be an artificial dead end.
  const matches = useMemo(() => {
    if (trimmed === '') return null;
    return leaves.filter(
      (c) =>
        c.labelEn.toLowerCase().includes(trimmed) ||
        c.labelAr.toLowerCase().includes(trimmed) ||
        c.slug.toLowerCase().includes(trimmed),
    );
  }, [leaves, trimmed]);

  const atLimit = chosen.length >= maxSpecialties;

  return (
    <div className="flex flex-col gap-3" data-testid="specialty-picker">
      {/* ── Search ─────────────────────────────────────────────────────── */}
      <div className="min-w-0">
        <label
          htmlFor="specialty-search"
          className="mb-1 block break-words text-slate-900 dark:text-white"
          style={{ fontSize: '14px', fontWeight: 600 }}
        >
          {copy.searchLabel}
        </label>
        <div className="relative flex items-center">
          <Search
            size={16}
            className="pointer-events-none absolute mx-3 text-slate-400"
            aria-hidden="true"
          />
          <input
            id="specialty-search"
            data-testid="specialty-search"
            type="search"
            value={query}
            disabled={disabled}
            placeholder={copy.searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-9 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            style={{ fontSize: '14px', minHeight: '44px' }}
          />
          {query !== '' ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={copy.clearSearch}
              data-testid="specialty-search-clear"
              className="absolute end-0 flex items-center justify-center text-slate-400"
              style={{ minWidth: '44px', minHeight: '44px' }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <p
        className="break-words text-slate-500 dark:text-slate-400"
        style={{ fontSize: '12px' }}
        data-testid="specialty-count"
        // Announced, because the count changing is the feedback that a tap
        // landed — the chip itself is far down a long list.
        role="status"
        aria-live="polite"
      >
        {copy.selectedCount(chosen.length, maxSpecialties)}
        {atLimit ? ` — ${copy.limitReached}` : ''}
      </p>

      {/* ── Results ────────────────────────────────────────────────────── */}
      {matches !== null ? (
        matches.length === 0 ? (
          <div data-testid="specialty-no-results" role="status">
            <p className="break-words text-slate-900 dark:text-white" style={{ fontSize: '14px' }}>
              {copy.noResults}
            </p>
            <p
              className="break-words text-slate-500 dark:text-slate-400"
              style={{ fontSize: '12px' }}
            >
              {copy.noResultsHint}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="specialty-results">
            {matches.map((c) => (
              <li key={c.id}>
                <SpecialtyOption
                  category={c}
                  label={label(c)}
                  checked={chosen.includes(c.id)}
                  // A chip already chosen stays pressable so it can be
                  // un-chosen; only ADDING is blocked at the limit.
                  disabled={disabled || (atLimit && !chosen.includes(c.id))}
                  onToggle={onToggle}
                />
              </li>
            ))}
          </ul>
        )
      ) : (
        /* ── Browse ───────────────────────────────────────────────────── */
        <div className="flex flex-col gap-2" data-testid="specialty-groups">
          <p
            className="break-words text-slate-500 dark:text-slate-400"
            style={{ fontSize: '12px' }}
          >
            {copy.chooseGroup}
          </p>
          {groups.map((group) => {
            const children = leaves.filter((c) => c.parentId === group.id);
            if (children.length === 0) return null;
            const open = openGroups.includes(group.id);
            const chosenHere = children.filter((c) => chosen.includes(c.id)).length;

            return (
              <div
                key={group.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-700"
              >
                <button
                  type="button"
                  data-testid={`specialty-group-${group.id}`}
                  aria-expanded={open}
                  aria-controls={`specialty-group-panel-${group.id}`}
                  onClick={() =>
                    setOpenGroups((prev) =>
                      prev.includes(group.id)
                        ? prev.filter((g) => g !== group.id)
                        : [...prev, group.id],
                    )
                  }
                  className="flex w-full items-center justify-between gap-2 px-3 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  style={{ minHeight: '44px' }}
                >
                  <span
                    className="min-w-0 break-words text-slate-900 dark:text-white"
                    style={{ fontSize: '14px', fontWeight: 600 }}
                  >
                    {label(group)}
                    {chosenHere > 0 ? (
                      <span className="ms-2 text-blue-700" style={{ fontSize: '12px' }}>
                        ({chosenHere})
                      </span>
                    ) : null}
                  </span>
                  <ChevronDown
                    size={18}
                    className={`flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>

                {open ? (
                  <ul
                    id={`specialty-group-panel-${group.id}`}
                    className="flex flex-col gap-2 px-3 pb-3"
                  >
                    {children.map((c) => (
                      <li key={c.id}>
                        <SpecialtyOption
                          category={c}
                          label={label(c)}
                          checked={chosen.includes(c.id)}
                          disabled={disabled || (atLimit && !chosen.includes(c.id))}
                          onToggle={onToggle}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}

          {/* Roots that are themselves selectable — every pre-hierarchy
              category is one, so a flat catalogue still works here. */}
          {leaves.filter((c) => c.parentId === null).length > 0 ? (
            <ul className="flex flex-col gap-2" data-testid="specialty-roots">
              {leaves
                .filter((c) => c.parentId === null)
                .map((c) => (
                  <li key={c.id}>
                    <SpecialtyOption
                      category={c}
                      label={label(c)}
                      checked={chosen.includes(c.id)}
                      disabled={disabled || (atLimit && !chosen.includes(c.id))}
                      onToggle={onToggle}
                    />
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * One selectable specialty.
 *
 * A real checkbox rather than a styled div: it is announced as a checkbox,
 * toggles with space, and participates in the tab order without any of that
 * being reimplemented. The visible row is its label, so the whole row is the
 * hit target.
 */
function SpecialtyOption({
  category,
  label,
  checked,
  disabled,
  onToggle,
}: {
  category: ServiceCategorySummary;
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <label
      data-testid={`specialty-option-${category.id}`}
      data-checked={checked}
      className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 ${
        checked
          ? 'border-blue-500 bg-blue-50/50'
          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
      } ${disabled ? 'opacity-50' : ''}`}
      style={{ minHeight: '44px' }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle(category.id)}
        className="h-5 w-5 flex-shrink-0 accent-blue-600"
      />
      <span
        className="min-w-0 break-words text-slate-900 dark:text-white"
        style={{ fontSize: '14px' }}
      >
        {label}
      </span>
      {checked ? (
        <Check size={16} className="ms-auto flex-shrink-0 text-blue-600" aria-hidden="true" />
      ) : null}
    </label>
  );
}
