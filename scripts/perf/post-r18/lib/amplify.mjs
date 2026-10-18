// R27 — grow the real-API dataset to a size where plans mean something.
//
// Planner choices on a 40-row table say nothing about production, so after
// the real-API seed the request -> bid -> booking graph is cloned K times
// inside the lane database. Clones keep every column of a real row (status,
// amounts, owners) with fresh ids, foreign keys remapped to the clone of the
// same generation, idempotency keys cleared, and creation times spread over
// 180 days so ordering and cursors see realistic spread.
// Completed clones finish at the next day boundary, deliberately exercising
// timestamp ties and the id tie-breaker. Every tenth completed generation is
// soft-deleted. These are declared synthetic distributions, not production data.
//
// Limits, stated in the report: clones belong to the same few real users, so
// per-user histories are heavy (a worst case for per-user lists) while the
// user, notification and ledger tables stay small. Money tables are not
// cloned; nothing here writes a ledger or a balance.

const CLONE_PREFIX = 'r27c';

async function columns(db, table) {
  const { rows } = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  if (rows.length === 0) throw new Error(`table ${table} not found`);
  return rows.map((r) => r.column_name);
}

const q = (name) => `"${name.replace(/"/g, '""')}"`;

/** Build "INSERT ... SELECT" with per-column replacement expressions. */
function cloneSql(table, cols, from, overrides) {
  const target = cols.map(q).join(', ');
  const select = cols.map((c) => overrides[c] ?? `src.${q(c)}`).join(', ');
  return `INSERT INTO ${q(table)} (${target}) SELECT ${select} ${from}`;
}

export async function amplify(db, copies) {
  if (!Number.isInteger(copies) || copies < 1 || copies > 2000) {
    throw new Error('copies must be an integer between 1 and 2000');
  }
  const { rows: prior } = await db.query(
    `SELECT 1 FROM "ServiceRequest" WHERE id LIKE '${CLONE_PREFIX}%' LIMIT 1`,
  );
  if (prior.length) throw new Error('the lane database is already amplified; reset it first');
  const spread = (idExpr) =>
    `src."createdAt" - make_interval(days => abs(hashtext(${idExpr})) % 180, secs => abs(hashtext(${idExpr} || 's')) % 86400)`;
  await db.query('BEGIN');
  try {
    await db.query(
      `CREATE TEMP TABLE r27_req ON COMMIT DROP AS
         SELECT s.id AS old_id, g.k, '${CLONE_PREFIX}' || g.k || '_' || s.id AS new_id
           FROM "ServiceRequest" s, generate_series(1, $1::int) AS g(k)
          WHERE s.id NOT LIKE '${CLONE_PREFIX}%'`,
      [copies],
    );
    await db.query(
      `CREATE TEMP TABLE r27_bid ON COMMIT DROP AS
         SELECT b.id AS old_id, m.k, '${CLONE_PREFIX}' || m.k || '_' || b.id AS new_id, m.new_id AS request_id
           FROM "Bid" b JOIN r27_req m ON m.old_id = b."requestId"`,
    );

    const reqCols = await columns(db, 'ServiceRequest');
    await db.query(
      cloneSql(
        'ServiceRequest',
        reqCols,
        'FROM "ServiceRequest" src JOIN r27_req m ON m.old_id = src.id',
        {
          id: 'm.new_id',
          idempotencyKey: 'NULL',
          createdAt: spread('m.new_id'),
          updatedAt: spread('m.new_id'),
        },
      ),
    );
    const bidCols = await columns(db, 'Bid');
    await db.query(
      cloneSql('Bid', bidCols, 'FROM "Bid" src JOIN r27_bid m ON m.old_id = src.id', {
        id: 'm.new_id',
        requestId: 'm.request_id',
        createdAt: spread('m.new_id'),
        updatedAt: spread('m.new_id'),
        submittedAt: spread('m.new_id'),
      }),
    );
    const bookingCols = await columns(db, 'Booking');
    const completedAt = `date_trunc('day', ${spread('mb.new_id')}) + INTERVAL '1 day'`;
    await db.query(
      cloneSql(
        'Booking',
        bookingCols,
        `FROM "Booking" src
           JOIN r27_bid mb ON mb.old_id = src."bidId"
           JOIN r27_req mr ON mr.old_id = src."requestId" AND mr.k = mb.k`,
        {
          id: `'${CLONE_PREFIX}' || mb.k || '_' || src.id`,
          requestId: 'mr.new_id',
          bidId: 'mb.new_id',
          createdAt: spread('mb.new_id'),
          updatedAt: `CASE WHEN src.status = 'COMPLETED' THEN ${completedAt} ELSE ${spread('mb.new_id')} END`,
          deletedAt: `CASE WHEN src."deletedAt" IS NOT NULL THEN src."deletedAt"
            WHEN src.status = 'COMPLETED' AND mb.k % 10 = 0 THEN ${completedAt} + INTERVAL '1 hour'
            ELSE NULL END`,
        },
      ),
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
  await db.query('ANALYZE "ServiceRequest", "Bid", "Booking"');
  return rowCounts(db);
}

export async function rowCounts(db) {
  const counts = {};
  for (const table of [
    'User',
    'ProviderProfile',
    'ServiceRequest',
    'Bid',
    'Booking',
    'Notification',
    'AuditLog',
  ]) {
    try {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${q(table)}`);
      counts[table] = rows[0].n;
    } catch {
      counts[table] = null;
    }
  }
  return counts;
}
