// One-off dev helper for Sprint 7.2 verification.
// Resets admin@admin.com's password to a known dev value so the
// runtime smoke can log in without prompting. NOT for production —
// the seed flow short-circuits in production via assertSeedProductionSafe.
const path = require('node:path');
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

(async () => {
  const prisma = new PrismaClient();
  const email = process.argv[2] || 'admin@admin.com';
  const password = process.argv[3] || 'DevAdmin123!';
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const u = await prisma.user.update({
    where: { email },
    data: { passwordHash: hash, status: 'ACTIVE', emailVerifiedAt: new Date() },
    select: { id: true, email: true, status: true },
  });
  console.log(JSON.stringify({ ok: true, user: u, password }, null, 2));
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('reset failed:', e.message);
  process.exit(1);
});
