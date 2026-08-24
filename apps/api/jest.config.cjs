// The DB- and Redis-gated suites all talk to ONE database. They used to keep
// themselves clean with table-wide TRUNCATE and unscoped deleteMany({}) /
// count(), which is correct only while exactly one suite is running. In
// parallel workers one suite wiped rows another was mid-assertion on — which
// is what CI reported: suites failing together that each pass in isolation.
//
// That was answered here, by pinning `maxWorkers: 1` for any gated run. It
// worked, but it is a workaround rather than a boundary: it hid the missing
// isolation and taxed every future suite with the wall-clock of a serial run.
//
// The boundary now lives in the suites themselves (test/support/db-isolation.ts):
// per-suite fixture namespaces so cleanup is a prefix match over rows the
// suite owns, plus a narrowly scoped Postgres advisory lock for the one suite
// that legitimately mutates a whole table and asserts on table-wide totals.
// With that in place the gated run keeps full parallelism, like the hermetic
// default run always has.
/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  // Runs in every worker before the spec loads. Caps this worker's Prisma
  // pool so the gated run cannot exhaust Postgres' max_connections — see the
  // file for the arithmetic.
  setupFiles: ['<rootDir>/test/support/bound-db-pool.cjs'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          target: 'ES2022',
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          strict: true,
          skipLibCheck: true,
        },
        isolatedModules: true,
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  clearMocks: true,
};
