# deepmerge — repository-owned security fork

This directory replaces the registry package `deepmerge@4.3.1` across the
dependency graph through the root `pnpm.overrides` entry
`"deepmerge@>=4.2.0 <=4.3.1": "file:./vendor/deepmerge"`.

## Why it exists

- Advisory: [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
  (CVE-2026-93753, low). `mergeObject()` copies an own enumerable `__proto__`
  key into the result and replaces the result's prototype.
- Affected range: `>= 4.2.0, <= 4.3.1`. **No patched release exists.**
  4.3.1 (2023-03-16) is the latest release; the upstream fix is open as
  [TehShrike/deepmerge#286](https://github.com/TehShrike/deepmerge/pull/286).
- Owner in this graph: `jest-config@30.5.2` (the latest Jest) depends on
  `deepmerge@^4.3.1` and calls it on Jest configuration and preset globals.
  Jest has no change to drop the dependency. The other consumer,
  `fork-ts-checker-webpack-plugin` via `@nestjs/cli@11`, was removed by
  upgrading to `@nestjs/cli@12`.
- The audit policy (`scripts/security/dependency-audit.cjs`) forbids muting
  findings. `pnpm patch` would leave `deepmerge@4.3.1` in the lockfile and
  the finding open. Replacing Jest is outside the scope of the release baseline.

## What changed

`index.cjs` is the published 4.3.1 CommonJS build (`dist/cjs.js`) with the
upstream PR #286 fix as the only behavior change:

```diff
 function getKeys(target) {
-  return Object.keys(target).concat(getEnumerableOwnPropertySymbols(target));
+  return Object.keys(target)
+    .filter(function (key) {
+      return key !== '__proto__';
+    })
+    .concat(getEnumerableOwnPropertySymbols(target));
 }
```

The files are formatted with the repository Prettier config, and
`catch (_)` is written as `catch {}` (an unused binding the lint rules
reject). This keeps the commit hooks and the R27 dependency controls
byte-stable. Neither change alters behavior. `index.d.ts` is upstream
formatted the same way, and `license.txt` is byte-for-byte.

| Upstream 4.3.1 file | SHA-256 (as published)                                             |
| ------------------- | ------------------------------------------------------------------ |
| `dist/cjs.js`       | `2e5160f84a1141bd927264afe4d15766f1e6cf07daef182b37ff53fea121de7d` |
| `index.d.ts`        | `146ba4b99c5feb82663e17a671bf9f53bb39c704cd76345d6c5a801c26372f44` |
| `license.txt`       | `6cfc4687cb2f2d86f4a77e6b526290d3878e5e512f3fec2f4cb36a9cb36f798b` |

Reproduce the comparison. The only output should be the header comment and
the hunk above; the second `diff` prints nothing:

```sh
U=<path to the deepmerge-4.3.1 registry tarball contents>
npx prettier --stdin-filepath x.cjs < "$U/dist/cjs.js" \
  | sed 's/} catch (_) {/} catch {/' | diff - vendor/deepmerge/index.cjs
npx prettier --stdin-filepath x.d.ts < "$U/index.d.ts" | diff - vendor/deepmerge/index.d.ts
```

The entry point is `index.cjs`, not `dist/`, because `.dockerignore`
excludes `**/dist` from image build contexts.

## Tests

`test/prototype-poisoning.test.cjs` runs in `pnpm security:audit:test`.
Three of its six cases fail against upstream 4.3.1:

```sh
DEEPMERGE_UNDER_TEST=node_modules/.pnpm/deepmerge@4.3.1/node_modules/deepmerge \
  node --test vendor/deepmerge/test/prototype-poisoning.test.cjs
```

`scripts/security/vendored-forks.test.cjs` also checks that Jest resolves this
fork and that no registry `deepmerge` remains in `pnpm-lock.yaml`.

## Exit criterion

Delete this directory and the override when either change ships:

- upstream publishes a release outside the advisory range; or
- Jest stops depending on `deepmerge`.

Then reinstall with the lockfile and confirm `pnpm security:audit` reports zero findings.
