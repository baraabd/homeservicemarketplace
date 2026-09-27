import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function baselineProblems(document) {
  const errors = [];
  if (!document || document.schemaVersion !== 1 || !/^[a-f0-9]{40}$/u.test(document.baselineSha ?? '')) return ['Invalid release baseline'];
  if (document.repository !== 'baraabd/homeservicemarketplace') errors.push('Wrong baseline repository');
  for (const role of ['integration', 'migrations', 'contracts', 'operations']) {
    if (document.owners?.[role] !== 'baraabd') errors.push(`Missing accountable owner: ${role}`);
  }
  if (!Array.isArray(document.sprints) || document.sprints.length !== 10) return [...errors, 'Exactly R01-R10 must be inventoried'];
  const ids = document.sprints.map((sprint) => sprint?.id);
  for (let index = 1; index <= 10; index += 1) if (ids.filter((id) => id === `R${String(index).padStart(2, '0')}`).length !== 1) errors.push(`Missing or duplicate sprint: R${String(index).padStart(2, '0')}`);
  for (const sprint of document.sprints) {
    if (!sprint || sprint.owner !== 'baraabd' || !['BLOCKED', 'NOT_STARTED', 'IN_PROGRESS'].includes(sprint.status)) { errors.push('Unowned or falsely certified sprint'); continue; }
    for (const field of ['finding', 'action', 'requiredEvidence']) if (typeof sprint[field] !== 'string' || !sprint[field].trim()) errors.push(`Missing ${field}: ${sprint.id}`);
    for (const field of ['source', 'tests']) {
      if (!Array.isArray(sprint[field]) || !sprint[field].length || sprint[field].some((entry) => typeof entry !== 'string' || !entry || entry.includes('..') || path.isAbsolute(entry) || entry.includes('\\'))) errors.push(`Invalid ${field}: ${sprint.id}`);
    }
    if (!Array.isArray(sprint.dependencies) || sprint.dependencies.some((id) => !ids.includes(id) || id >= sprint.id)) errors.push(`Invalid dependency order: ${sprint.id}`);
  }
  if (!Array.isArray(document.reservations) || !document.reservations.length) return [...errors, 'Missing shared-file reservations'];
  const paths = new Set();
  for (const reservation of document.reservations) {
    if (!reservation || typeof reservation.path !== 'string' || !reservation.path || reservation.path.includes('..') || reservation.path.includes('\\') || path.isAbsolute(reservation.path) || paths.has(reservation.path)) { errors.push('Invalid or duplicate shared reservation'); continue; }
    paths.add(reservation.path);
    if (!Object.hasOwn(document.owners ?? {}, reservation.role) || !Array.isArray(reservation.serialOrder) || !reservation.serialOrder.length || new Set(reservation.serialOrder).size !== reservation.serialOrder.length || reservation.serialOrder.some((id) => !ids.includes(id))) errors.push(`Invalid reservation ownership/order: ${reservation.path}`);
  }
  if (document.protection?.status !== 'BLOCKED' || document.protection?.branchProtected !== false || document.protection?.administrationReadHttpStatus !== 403) errors.push('Observed protection blocker must not be silently certified');
  return errors;
}

export async function verifyBaseline(root) {
  const document = JSON.parse(await readFile(path.join(root, 'docs/production-readiness/r01/BASELINE.json'), 'utf8'));
  const errors = baselineProblems(document);
  if (errors.length) return errors;
  for (const sprint of document.sprints) {
    for (const reference of [...sprint.source, ...sprint.tests]) {
      try { await stat(path.join(root, reference)); }
      catch { errors.push(`Missing source/test reference: ${reference}`); }
    }
  }
  return errors;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyBaseline(fileURLToPath(new URL('../../', import.meta.url))).then((errors) => {
    for (const error of errors) console.error(`FAIL ${error}`);
    console.log(errors.length ? 'BLOCKED baseline registry' : 'PASS source-backed baseline registry; sprint completion is not implied');
    if (errors.length) process.exitCode = 1;
  }).catch(() => { console.error('FAIL baseline input is unreadable'); process.exitCode = 1; });
}
