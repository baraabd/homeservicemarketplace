import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { AdminAuditService } from '../admin-audit.service';
import { AdminCatalogService, MAX_CATEGORY_DEPTH } from './admin-catalog.service';

// Sprint 8 — catalogue administration.
//
// Two things here are worth more than the CRUD around them:
//
//   1. The CYCLE GUARD. The database CHECK only catches a category naming
//      itself. A to B to A produces a tree that makes every recursive read
//      HANG rather than error, which is the worst failure shape available for
//      a catalogue read on a hot path.
//
//   2. The isLeaf RAILS. isLeaf is what makes a row selectable at all.
//      Flipping it on a held row orphans everyone holding it; flipping it on a
//      row with children makes "what is this provider approved for" ambiguous.

interface Row {
  id: string;
  slug: string;
  labelEn: string;
  labelAr: string;
  icon: string;
  parentId: string | null;
  isLeaf: boolean;
  isActive: boolean;
  sortOrder: number;
  deletedAt: Date | null;
}

function row(over: Partial<Row> & { id: string }): Row {
  return {
    slug: over.id,
    labelEn: 'Label',
    labelAr: 'تسمية',
    icon: 'wrench',
    parentId: null,
    isLeaf: true,
    isActive: true,
    sortOrder: 0,
    deletedAt: null,
    ...over,
  };
}

function build(seed: Row[] = [], opts: { holders?: Record<string, number> } = {}) {
  const rows = new Map(seed.map((r) => [r.id, r]));
  const holders = opts.holders ?? {};

  const serviceCategory = {
    findMany: jest.fn().mockImplementation(() =>
      Promise.resolve(
        [...rows.values()].map((r) => ({
          ...r,
          _count: { providerProfiles: holders[r.id] ?? 0 },
        })),
      ),
    ),
    findFirst: jest
      .fn()
      .mockImplementation(({ where }: { where: { id?: string; slug?: string } }) =>
        Promise.resolve(
          [...rows.values()].find(
            (r) =>
              (where.id === undefined || r.id === where.id) &&
              (where.slug === undefined || r.slug === where.slug),
          ) ?? null,
        ),
      ),
    findUnique: jest
      .fn()
      .mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.get(where.id) ?? null),
      ),
    count: jest
      .fn()
      .mockImplementation(({ where }: { where: { parentId?: string } }) =>
        Promise.resolve([...rows.values()].filter((r) => r.parentId === where.parentId).length),
      ),
    create: jest.fn().mockImplementation(({ data }: { data: Partial<Row> }) => {
      const created = row({ id: `cat-${rows.size + 1}`, ...data } as Partial<Row> & { id: string });
      rows.set(created.id, created);
      return Promise.resolve(created);
    }),
    update: jest
      .fn()
      .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const next = { ...(rows.get(where.id) as Row), ...data };
        rows.set(where.id, next);
        return Promise.resolve(next);
      }),
  };

  const equipmentCatalogItem = {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest
      .fn()
      .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'eq-1', isActive: true, sortOrder: 0, ...data }),
      ),
    update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'eq-1',
        code: 'DRILL',
        labelEn: 'Drill',
        labelAr: 'مثقاب',
        categoryId: null,
        isActive: true,
        sortOrder: 0,
        ...data,
      }),
    ),
  };

  const providerProfileServiceCategory = {
    count: jest
      .fn()
      .mockImplementation(({ where }: { where: { serviceCategoryId: string } }) =>
        Promise.resolve(holders[where.serviceCategoryId] ?? 0),
      ),
  };

  const client = { serviceCategory, equipmentCatalogItem, providerProfileServiceCategory };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new AdminCatalogService(
    { client } as unknown as PrismaService,
    audit as unknown as AdminAuditService,
    { run: <T>(fn: (t: unknown) => Promise<T>) => fn(client) } as unknown as TransactionRunner,
  );

  return { service, audit, serviceCategory, equipmentCatalogItem, rows };
}

describe('the category tree', () => {
  it('nests children under their parent', async () => {
    // Nested SERVER-side. Handed over flat, the client rebuilds the tree on
    // every render and two clients disagree about where an orphan belongs.
    const h = build([
      row({ id: 'root', isLeaf: false }),
      row({ id: 'leaf-a', parentId: 'root' }),
      row({ id: 'leaf-b', parentId: 'root' }),
    ]);

    const { roots } = await h.service.categoryTree();

    expect(roots).toHaveLength(1);
    expect(roots[0].children.map((c) => c.id)).toEqual(['leaf-a', 'leaf-b']);
  });

  it('surfaces an ORPHAN as a root rather than dropping it', async () => {
    // A row whose parent was soft-deleted must stay visible on the one screen
    // that could repair it. Silently omitting it makes a category unreachable.
    const h = build([row({ id: 'lost', parentId: 'gone' })]);

    const { roots } = await h.service.categoryTree();

    expect(roots.map((r) => r.id)).toEqual(['lost']);
  });

  it('reports how many providers hold each category', async () => {
    // Shown next to the isLeaf and isActive toggles because both are safe on
    // an unheld row and consequential on a held one.
    const h = build([row({ id: 'held' })], { holders: { held: 7 } });

    const { roots } = await h.service.categoryTree();

    expect(roots[0].providerCount).toBe(7);
  });

  it('includes RETIRED rows', async () => {
    // A screen that hides retired categories cannot un-retire one.
    const h = build([row({ id: 'retired', isActive: false })]);

    const { roots } = await h.service.categoryTree();

    expect(roots.map((r) => r.id)).toEqual(['retired']);
  });
});

describe('creating a category', () => {
  it('creates a selectable leaf by default', async () => {
    // Matching every pre-Sprint-8 row: a category is selectable unless
    // someone deliberately makes it a heading.
    const h = build();
    const out = await h.service.createCategory('admin-1', {
      slug: 'boiler-repair',
      labelEn: 'Boiler repair',
      labelAr: 'إصلاح السخان',
    });

    expect(out.category.isLeaf).toBe(true);
    expect(out.category.parentId).toBeNull();
  });

  it('rejects a duplicate slug', async () => {
    const h = build([row({ id: 'x', slug: 'plumbing' })]);

    await expect(
      h.service.createCategory('admin-1', {
        slug: 'plumbing',
        labelEn: 'Plumbing',
        labelAr: 'سباكة',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses to nest under a SELECTABLE category', async () => {
    // A parent that is itself selectable lets a provider hold both the group
    // and the specialties under it, which makes "what are they approved for"
    // ambiguous at exactly the moment it matters.
    const h = build([row({ id: 'leafy', isLeaf: true })]);

    await expect(
      h.service.createCategory('admin-1', {
        slug: 'child',
        labelEn: 'Child',
        labelAr: 'فرع',
        parentId: 'leafy',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses to exceed the depth bound', async () => {
    // Two levels is what the wizard renders. A deeper chain is a row the UI
    // has no way to display.
    const h = build([
      row({ id: 'root', isLeaf: false }),
      row({ id: 'mid', parentId: 'root', isLeaf: false }),
    ]);

    await expect(
      h.service.createCategory('admin-1', {
        slug: 'deep',
        labelEn: 'Deep',
        labelAr: 'عميق',
        parentId: 'mid',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(MAX_CATEGORY_DEPTH).toBe(2);
  });

  it('audits the creation with the fields that decide selectability', async () => {
    const h = build();
    await h.service.createCategory('admin-1', {
      slug: 'group',
      labelEn: 'Group',
      labelAr: 'مجموعة',
      isLeaf: false,
    });

    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADMIN_CATEGORY_CREATED',
        metadata: expect.objectContaining({ slug: 'group', isLeaf: false }),
      }),
      expect.anything(),
    );
  });
});

describe('the cycle guard', () => {
  it('refuses a category as its own parent', async () => {
    const h = build([row({ id: 'a', isLeaf: false })]);

    await expect(h.service.updateCategory('admin-1', 'a', { parentId: 'a' })).rejects.toMatchObject(
      { status: 400 },
    );
  });

  it('refuses a two-hop cycle', async () => {
    // A → B → A. The database CHECK does not catch this; only walking the
    // ancestor chain does.
    const h = build([
      row({ id: 'a', isLeaf: false }),
      row({ id: 'b', parentId: 'a', isLeaf: false }),
    ]);

    await expect(h.service.updateCategory('admin-1', 'a', { parentId: 'b' })).rejects.toMatchObject(
      { status: 400 },
    );
  });

  it('allows a legitimate re-parent', async () => {
    const h = build([
      row({ id: 'root-1', isLeaf: false }),
      row({ id: 'root-2', isLeaf: false }),
      row({ id: 'leaf', parentId: 'root-1' }),
    ]);

    const out = await h.service.updateCategory('admin-1', 'leaf', { parentId: 'root-2' });

    expect(out.category.parentId).toBe('root-2');
  });

  it('allows promotion to a root', async () => {
    // `null` is distinguished from `undefined`: "make this top-level" versus
    // "I am not editing the parent".
    const h = build([row({ id: 'root', isLeaf: false }), row({ id: 'leaf', parentId: 'root' })]);

    const out = await h.service.updateCategory('admin-1', 'leaf', { parentId: null });

    expect(out.category.parentId).toBeNull();
  });

  it('terminates on data that is ALREADY cyclic', async () => {
    // The guard prevents cycles but cannot undo one that predates it. Without
    // the hop counter, an unbounded walk over corrupt data never returns —
    // and a hung request is harder to diagnose than a failed one.
    const h = build([
      row({ id: 'a', parentId: 'b', isLeaf: false }),
      row({ id: 'b', parentId: 'a', isLeaf: false }),
      row({ id: 'c', isLeaf: true }),
    ]);

    await expect(h.service.updateCategory('admin-1', 'c', { parentId: 'a' })).rejects.toMatchObject(
      { status: 400 },
    );
  });
});

describe('the isLeaf rails', () => {
  it('refuses to un-select a category providers HOLD', async () => {
    // Their competency stops being selectable while they keep it, and nothing
    // in the UI can explain the state.
    const h = build([row({ id: 'held' })], { holders: { held: 3 } });

    await expect(
      h.service.updateCategory('admin-1', 'held', { isLeaf: false }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('names how many providers are affected', async () => {
    // "Cannot do that" sends an admin looking. "3 providers hold this" tells
    // them what to fix.
    const h = build([row({ id: 'held' })], { holders: { held: 3 } });

    await expect(h.service.updateCategory('admin-1', 'held', { isLeaf: false })).rejects.toThrow(
      /3/,
    );
  });

  it('allows un-selecting an UNHELD category', async () => {
    const h = build([row({ id: 'unheld' })]);

    const out = await h.service.updateCategory('admin-1', 'unheld', { isLeaf: false });

    expect(out.category.isLeaf).toBe(false);
  });

  it('refuses to make a group with children selectable', async () => {
    // A provider could then hold the group AND its specialties, and "what are
    // they approved for" stops having one answer.
    const h = build([row({ id: 'group', isLeaf: false }), row({ id: 'child', parentId: 'group' })]);

    await expect(
      h.service.updateCategory('admin-1', 'group', { isLeaf: true }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('allows making an EMPTY group selectable again', async () => {
    const h = build([row({ id: 'group', isLeaf: false })]);

    const out = await h.service.updateCategory('admin-1', 'group', { isLeaf: true });

    expect(out.category.isLeaf).toBe(true);
  });

  it('audits before AND after', async () => {
    // "isLeaf was changed" is not an audit trail. "isLeaf went true to false
    // while 0 providers held it" is.
    const h = build([row({ id: 'x' })]);
    await h.service.updateCategory('admin-1', 'x', { isLeaf: false });

    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADMIN_CATEGORY_UPDATED',
        metadata: expect.objectContaining({
          before: expect.objectContaining({ isLeaf: true }),
          after: expect.objectContaining({ isLeaf: false }),
          providerCount: 0,
        }),
      }),
      expect.anything(),
    );
  });

  it('404s on a category that does not exist', async () => {
    const h = build();
    await expect(
      h.service.updateCategory('admin-1', 'ghost', { isActive: false }),
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('the equipment catalogue', () => {
  it('normalises a code to UPPER_SNAKE', async () => {
    // A code is a stable identifier clients key i18n off. "van" and "Van"
    // arriving as two rows would be two capabilities for one thing, and
    // matching would find neither reliably.
    const h = build();
    const out = await h.service.createEquipment('admin-1', {
      code: 'power drill',
      labelEn: 'Power drill',
      labelAr: 'مثقاب كهربائي',
    });

    expect(out.item.code).toBe('POWER_DRILL');
  });

  it('rejects a duplicate code', async () => {
    const h = build();
    h.equipmentCatalogItem.findUnique.mockResolvedValue({ id: 'eq-0', code: 'DRILL' });

    await expect(
      h.service.createEquipment('admin-1', {
        code: 'drill',
        labelEn: 'Drill',
        labelAr: 'مثقاب',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects an unknown category link', async () => {
    const h = build();

    await expect(
      h.service.createEquipment('admin-1', {
        code: 'DRILL',
        labelEn: 'Drill',
        labelAr: 'مثقاب',
        categoryId: 'ghost',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('allows an item with no category — a ladder is a ladder', async () => {
    const h = build();
    const out = await h.service.createEquipment('admin-1', {
      code: 'LADDER',
      labelEn: 'Ladder',
      labelAr: 'سلم',
    });

    expect(out.item.categoryId).toBeNull();
  });

  it('retires an item without deleting it', async () => {
    // A code a saved draft references cannot be removed without breaking that
    // draft, so there is no delete route at all.
    const h = build();
    h.equipmentCatalogItem.findUnique.mockResolvedValue({
      id: 'eq-1',
      code: 'DRILL',
      categoryId: null,
      isActive: true,
    });

    const out = await h.service.updateEquipment('admin-1', 'eq-1', { isActive: false });

    expect(out.item.isActive).toBe(false);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ADMIN_EQUIPMENT_UPDATED' }),
      expect.anything(),
    );
  });
});
