# OTP feature bundle boundaries

The production Vite build previously loaded signup, password recovery and administrator contact enrollment along with the initial login or admin route. These forms now load when their corresponding route is opened. The policy request still completes before an authentication form renders, and the phone input, country selector and WhatsApp login remain in the initial authentication dependency graph.

`SignUpScreen.tsx` and `ForgotPasswordScreen.tsx` were extracted without changing their state transitions. `AuthLayout.tsx` shares the existing top bar and swipe wrapper. `AuthPages.tsx` uses the existing localized `AsyncBoundary` for signup and recovery. `AdminRouteContent.tsx` uses the same boundary for `/admin/settings`; it keeps the admin shell mounted while settings load or recover from a chunk error.

## Production byte measurements

Both measurements used the unchanged `scripts/perf/post-r18/bundle-report.mjs` production build and the existing `scripts/perf/post-r18/budgets.proposed.json`. No threshold, workflow, measurement classification or forbidden-library rule changed. Values below are JavaScript KiB compressed with Brotli quality 11, the harness's lower-bound static compression measurement.

| Initial dependency graph      | Before | After | Existing ceiling |
| ----------------------------- | -----: | ----: | ---------------: |
| Shared shell                  |  184.8 | 184.9 |              185 |
| Auth / login increment        |   25.4 |  18.5 |               20 |
| Seeker home increment         |   56.5 |  56.9 |               60 |
| Provider workspace increment  |   35.0 |  35.2 |               40 |
| Provider onboarding increment |   74.5 |  74.8 |               75 |
| Admin increment               |  114.2 | 105.8 |              110 |
| Disputes increment            |   42.3 |  42.3 |               45 |
| Job wizard increment          |   63.5 |  63.5 |               65 |

All eight byte ceilings and both library-placement checks passed locally: **10 passed, 0 failed**. Recharts remains confined to the dashboard charts boundary; Leaflet remains confined to job wizard and address map boundaries. The shell and provider onboarding have little remaining headroom.

## Deferred route costs

Deferred files still load and execute. The following measurements traverse their real emitted imports, excluding already-loaded shell and parent-journey chunks. They are not included in the initial login or default admin increment above.

| Opened route               | Additional JS after parent journey | Cold route increment above the shell |
| -------------------------- | ---------------------------------: | -----------------------------------: |
| Signup                     |                            7.9 KiB |                             26.4 KiB |
| Email password recovery    |                            3.7 KiB |                             22.1 KiB |
| WhatsApp password recovery |                            1.7 KiB |                             20.2 KiB |
| Admin settings             |                           10.8 KiB |                            116.5 KiB |

The cold signup and admin settings totals are not claimed to shrink. Separate chunks add request and compression overhead. This change avoids fetching forms for people who do not open those routes. Browser loading times and hosted acceptance were not measured by this byte check.

The compact [measurement evidence](./BUNDLE_ROUTE_SUMMARY.json) retains exact byte counts, source hashes, the unchanged lockfile hash, build flags and source provenance. The measurements used the modified worktree based on commit `41105986089bc13adb23bcd15d8211442d47793f`; they are not final-commit CI evidence. Vite build time was 7,881 ms before and 7,556 ms after; these are build durations, not page-load timings.

## Reproduction and verification

Use the repository's pinned Node and pnpm versions:

```sh
node scripts/perf/post-r18/bundle-report.mjs --label otp-route-split --out-json bundle-report.json
node scripts/perf/post-r18/check-budgets.mjs --bundle bundle-report.json
pnpm --filter @homeservicemarketplace/web exec tsc -b --pretty false
pnpm --filter @homeservicemarketplace/web exec vitest run
```

Scoped regression verification passed: 103 auth, lifecycle and channel tests plus 21 admin routing and settings tests. The full web suite then passed **249 test files / 3,191 tests** in 45.27 seconds, with no failures. It emitted existing duplicate-key warnings for `availability` and `timezone` in `provider-onboarding-v2/autosave/onboarding-exit.test.tsx`. Web TypeScript compilation passed. Scoped ESLint reported no errors and one pre-existing `react-hooks/set-state-in-effect` warning in the email verification page.

The final committed source still requires its own remote CI result. These local results do not establish WhatsApp provider delivery, database acceptance, browser latency or production rollout readiness.
