// R27 — statement statistics and plan inspection (pure helpers + SQL).

const TX_CONTROL =
  /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|DEALLOCATE|SET|SHOW|SELECT\s+\$1\s*$)/i;

/** Split captured pg_stat_statements rows into data statements and control. */
export function classifyStatements(rows) {
  let statements = 0;
  let control = 0;
  const data = [];
  for (const row of rows) {
    const calls = Number(row.calls);
    if (TX_CONTROL.test(row.query)) control += calls;
    else {
      statements += calls;
      data.push(row);
    }
  }
  return { statements, control, data };
}

/** Walk an EXPLAIN (FORMAT JSON) plan into a flat list of scan facts. */
export function scansOf(planJson) {
  const out = [];
  const visit = (node) => {
    if (!node) return;
    if (node['Relation Name']) {
      out.push({
        node: node['Node Type'],
        relation: node['Relation Name'],
        index: node['Index Name'] ?? null,
        estimatedRows: node['Plan Rows'],
      });
    }
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(planJson?.[0]?.Plan);
  return out;
}

/**
 * A sequential scan matters only on a table that is large in this dataset;
 * on a 30-row lookup table it is the right plan and is not reported.
 */
export function seqScanFindings(scans, largeTables) {
  return scans
    .filter((s) => s.node === 'Seq Scan' && largeTables.has(s.relation))
    .map((s) => `${s.relation} (est. ${s.estimatedRows} rows)`);
}

/** Short, stable label for a statement: its verb and the tables it names. */
export function statementLabel(query) {
  const verb = (/^\s*(\w+)/.exec(query)?.[1] ?? '?').toUpperCase();
  const tables = [...new Set([...query.matchAll(/"public"\."(\w+)"/g)].map((m) => m[1]))];
  return `${verb} ${tables.join(',') || '(no table)'}`;
}
