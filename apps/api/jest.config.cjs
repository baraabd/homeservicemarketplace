// The DB- and Redis-gated suites all talk to ONE database, and two of them
// truncate shared tables (User, Session, VerificationToken, AuditEvent) during
// setup. Run in parallel workers, one suite wipes rows another is mid-assertion
// on — which is exactly what CI reported: three suites failing together that
// each pass in isolation. That reads as a broken test but is really a missing
// isolation boundary.
//
// Serialising whenever a gate is on is the fix that cannot be forgotten. A
// `--runInBand` typed onto one command line protects only that command; this
// protects every invocation, local or CI. The hermetic default run (no gates,
// no database) keeps full parallelism and full speed.
const dbBackedRun =
  process.env.RUN_DB_INTEGRATION === '1' || process.env.RUN_REDIS_INTEGRATION === '1';

/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  ...(dbBackedRun ? { maxWorkers: 1 } : {}),
  roots: ['<rootDir>/src', '<rootDir>/test'],
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
