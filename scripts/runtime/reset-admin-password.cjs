// One-off DEV helper: resets a user's password to a caller-supplied
// value so a runtime smoke can log in.
//
// Safety rules (see reset-admin-password.lib.cjs, unit-tested):
//   - refuses to run when NODE_ENV=production
//   - the password is a REQUIRED argument — there is NO default password
//   - the password is NEVER printed to stdout / logs
//
// Usage: node scripts/runtime/reset-admin-password.cjs <email> <password>
const path = require('node:path');
const { resolveConfig, formatResult } = require(
  path.join(__dirname, 'reset-admin-password.lib.cjs'),
);

(async () => {
  // Guards first — resolve (and validate) config BEFORE loading argon2 /
  // Prisma, so an unsafe invocation aborts without touching the database.
  const { email, password } = resolveConfig(process.argv, process.env);

  const argon2 = require(
    path.join(
      __dirname,
      '..',
      '..',
      'node_modules',
      '.pnpm',
      'argon2@0.44.0',
      'node_modules',
      'argon2',
    ),
  );
  const { PrismaClient } = require(
    path.join(
      __dirname,
      '..',
      '..',
      'node_modules',
      '.pnpm',
      '@prisma+client@5.22.0_prisma@5.22.0',
      'node_modules',
      '@prisma',
      'client',
    ),
  );

  const prisma = new PrismaClient();
  try {
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await prisma.user.update({
      where: { email },
      data: { passwordHash: hash, status: 'ACTIVE', emailVerifiedAt: new Date() },
      select: { id: true, email: true, status: true },
    });
    // Never include the password in the output.
    console.log(JSON.stringify(formatResult(user), null, 2));
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error('reset failed:', e.message);
  process.exit(1);
});
