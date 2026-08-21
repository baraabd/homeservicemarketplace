// Pure, DB-free core of the admin password-reset helper so the safety
// rules (no production, no default password, never print the secret) can
// be unit-tested without argon2 / Prisma / a database. The executable
// wrapper (reset-admin-password.cjs) requires this and supplies the I/O.

// Refuse to run against a production environment. This is a one-off DEV
// helper; running it in production would silently overwrite an operator
// account's password (and, before this change, print it). NODE_ENV is
// the guard.
function assertNotProduction(env) {
  const nodeEnv = String((env && env.NODE_ENV) || '').toLowerCase();
  if (nodeEnv === 'production') {
    throw new Error('reset-admin-password: refusing to run with NODE_ENV=production.');
  }
}

// Resolve the target email + password from argv. The email may default
// (it is not a secret); the password is REQUIRED and has no default — a
// baked-in default password is a credential in the repo and a footgun.
// argv is the full process.argv (node, script, ...args).
function resolveConfig(argv, env) {
  assertNotProduction(env);
  const email = (argv[2] && String(argv[2]).trim()) || 'admin@admin.com';
  const password = argv[3];
  if (!password || String(password).length === 0) {
    throw new Error(
      'reset-admin-password: a password argument is required. ' +
        'Usage: node scripts/runtime/reset-admin-password.cjs <email> <password>',
    );
  }
  return { email, password: String(password) };
}

// Shape the success output. Deliberately omits the password so the secret
// is never written to stdout, logs, or CI output.
function formatResult(user) {
  return { ok: true, user };
}

module.exports = { assertNotProduction, resolveConfig, formatResult };
