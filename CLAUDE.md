CLAUDE.md — Project Identity, Delivery Modes, and Quality Rules

Project Identity

HomeServiceMarketplace is a production-grade service marketplace comparable to
TaskRabbit, Thumbtack, and regional on-demand service platforms.

Primary goals:

security and privacy;

scalability;

maintainability;

testability;

clean architecture;

excellent user experience;

production readiness;

safe deployments;

minimal technical debt.

Core stack:

Node.js;

TypeScript;

React and Vite;

PostgreSQL and Prisma;

MongoDB;

Redis;

Docker;

pnpm workspace / monorepo;

Vercel-compatible frontend deployment.

Instruction Precedence and Scope

Follow instructions in this order:

platform, security, privacy, legal, and data-integrity requirements;

the user's explicit task prompt and acceptance criteria;

task-specific ADRs, contracts, designs, screenshots, and approved references;

this file's default delivery-mode rules;

existing implementation conventions.

An explicit, scoped request to redesign UX/UI activates UX/UI Redesign Mode
for the named surfaces. In that scope, the redesign instructions in the task
prompt override this file's default UI-preservation rules.

This authority never overrides:

authorization or ownership boundaries;

backend contracts and server-owned policy;

privacy and restricted-media boundaries;

validation and data integrity;

auditability;

migration safety;

required tests and deployment gates.

Do not use a generic "preserve the existing frontend" rule to refuse, dilute,
or silently reinterpret an explicit redesign request.

Do not broaden a redesign beyond the routes, journeys, components, or product
area named by the task.

Delivery Modes

Every non-trivial task must identify its active mode before implementation.

Mode A — Integration and Bug-Fix Mode (default)

Use this mode when the task concerns backend integration, correctness,
security, validation, reliability, or a narrow defect and does not explicitly
request a redesign.

In this mode:

treat the existing frontend as the visual baseline;

avoid unrelated spacing, color, typography, navigation, and layout changes;

make the smallest coherent UI change required by the real behavior;

preserve existing design-system usage;

fix backend, schema, auth, and policy defects at their owning layer;

do not hide server defects with frontend-only patches.

Mode B — UX/UI Redesign Mode

Activate this mode when the task explicitly requests any of the following:

UX/UI redesign;

a new user journey or information architecture;

visual modernization;

a new responsive application shell;

matching an approved screenshot, Figma design, prototype, or reference;

replacing a wizard, navigation model, dashboard, form system, or workflow;

improving usability, accessibility, conversion, clarity, or visual hierarchy
as a primary objective.

In this mode, Claude is explicitly authorized and expected to change, when the
approved scope requires it:

information architecture;

navigation;

route composition;

page and shell layout;

responsive behavior;

spacing and density;

typography hierarchy;

color application;

cards, forms, status surfaces, and empty states;

component boundaries;

frontend folder structure;

visual tokens and reusable primitives;

user-facing copy and interaction patterns;

motion and progressive disclosure.

The current UI is evidence of the starting point, not an immutable reference.
Reuse existing components only when they serve the target experience. Extend,
replace, or retire them when reuse would preserve a known UX defect or create
an incoherent design.

Mode C — Product Feature Mode

Use this mode for new product capability that is neither a narrow bug fix nor a
dedicated redesign.

In this mode:

preserve established product behavior outside the feature;

reuse the design system;

add new reusable UI primitives only when existing ones cannot express the
required semantics;

use the task prompt to decide whether a local redesign is part of scope.

If a task mixes modes, state the boundary explicitly. Example: backend policy
work remains in Integration Mode while the named onboarding routes use UX/UI
Redesign Mode.

Current Delivery Phase

The project is in a combined backend–frontend integration and controlled UX
modernization phase.

The frontend is substantially built, but it is not automatically the final
design. Existing screens are authoritative only in Integration and Bug-Fix
Mode. When an explicit redesign brief exists, the approved brief and its
acceptance criteria become the visual and interaction target.

Priority order within a redesign task:

preserve security, privacy, authorization, and data integrity;

understand the real end-to-end user journey and server constraints;

define the target information architecture and responsive behavior;

establish or extend design-system primitives;

implement the new UX/UI against real backend contracts;

verify functional, visual, responsive, accessibility, and runtime behavior;

document rollout, rollback, and remaining risks.

Integration is not complete until the real flow works. A redesign is not
complete until the intended surface is visible and visually verified in the
same runtime configuration the user will evaluate.

UX/UI Redesign Workflow

When UX/UI Redesign Mode is active, use the following workflow.

1. Establish the exact baseline

Before changing code:

verify branch, HEAD, worktree, and applicable feature flags;

identify the exact route and component currently rendered;

confirm whether the user is seeing a legacy fallback or the new surface;

trace the browser route through guards, flags, layout shells, hooks, API
clients, contracts, and server endpoints;

capture or inspect the current experience at representative viewports;

inventory existing design tokens, components, copy, state ownership, and
responsive constraints;

identify monoliths, duplicated UI, inline styling, and obsolete shells;

record backend contracts and server-owned state machines that must remain
authoritative.

Do not redesign the wrong route. Do not accept a mocked or feature-flagged test
surface as proof that the user's runtime displays it.

2. Produce a UX gap matrix

For each relevant screen or state, record:

current route and component;

user goal;

current friction or failure;

desired behavior;

server dependency;

responsive requirements;

Arabic/English requirements;

accessibility requirements;

target component or pattern;

acceptance evidence.

Distinguish among:

functional defects;

information-architecture defects;

visual-design defects;

content/copy defects;

responsive defects;

accessibility defects;

environment or feature-flag defects.

Do not call a feature absent when it is merely disabled, and do not call it
delivered when users cannot reach it.

3. Define the target before large implementation

Use the task's approved design, reference images, or written brief as the
target. If the task supplies reference screens, treat them as acceptance
evidence, not optional inspiration, unless the prompt says otherwise.

Before a large visual rewrite, define:

navigation and information architecture;

screen inventory;

user flows and recovery paths;

mobile, tablet, and desktop layouts;

component hierarchy;

design tokens;

typography scale;

spacing and density;

surface and elevation rules;

form, validation, and feedback patterns;

loading, empty, error, success, offline, locked, and submitted states;

dark-mode behavior if the product supports it;

rollout and rollback behavior.

If the prompt already contains a sufficiently detailed approved design and
acceptance criteria, proceed without asking for redundant confirmation.

4. Implement a system, not isolated screenshots

Prefer reusable, domain-appropriate primitives over screen-specific Tailwind
copies. Centralize stable decisions in tokens and variants.

Examples of reusable surface ownership include:

application shell;

page header;

task or step navigation;

section and card surfaces;

form fields and validation summary;

status banners and timelines;

empty/error/loading states;

sticky actions;

responsive navigation;

metrics and summary rows.

Avoid:

scattered inline fontSize, color, radius, and spacing values;

duplicating the same card or field chrome across feature files;

growing orchestration files into multi-thousand-line monoliths;

nested conditional rendering that acts as an undocumented route registry;

a second state store or API client for the same domain;

copying server transition tables into the frontend.

Reuse semantics, contracts, and proven behavior. Do not preserve poor visual
structure merely because it already exists.

5. Responsive requirements

Every redesigned customer or provider surface must be deliberately designed
for:

320px narrow mobile;

390px typical mobile;

768px tablet;

1024px small desktop;

1440px desktop;

200% zoom where applicable.

Do not force desktop and tablet into a fixed phone-width container unless the
approved product brief explicitly requires a phone-only PWA presentation.

Use adaptive navigation and layout:

mobile may use bottom navigation for primary operational destinations;

focused onboarding, checkout, verification, and submission flows should not
show irrelevant application navigation;

tablet and desktop should use the available space deliberately, such as a
side rail, two-column task layout, wider content, or contextual summary;

essential actions must remain reachable without covering content;

no fixed header, footer, bottom bar, or keyboard may obscure fields or
actions;

no horizontal overflow, clipped Arabic text, overlapping headings, or
unreachable content is permitted.

6. Bilingual and RTL/LTR requirements

Arabic and English are equal product experiences.

Required:

one established i18n mechanism;

complete key parity;

semantic language and direction attributes;

logical CSS properties where direction matters;

correct icon and navigation direction;

copy that reads naturally rather than as literal translation;

layouts tested with long Arabic strings;

no hard-coded alignment that only works in LTR;

numerals, dates, times, currencies, and units formatted intentionally.

Changing language must not lose form data, navigation state, or autosave state.

7. Accessibility requirements

Target WCAG 2.2 AA for redesigned surfaces.

Required where applicable:

semantic landmarks and heading order;

programmatic labels and descriptions;

visible keyboard focus;

complete keyboard operation;

error summary plus field-level errors;

aria-live for meaningful asynchronous feedback;

status communicated by text/icon as well as color;

touch targets of approximately 44×44px;

editable text at a mobile-safe size;

contrast in every supported theme;

reduced-motion support;

focus management for dialogs, route transitions, and failed submission.

Accessibility checks supplement, but do not replace, real keyboard and
screen-level review.

8. Visual acceptance is mandatory

Passing unit, integration, and Playwright assertions is not proof of good UX or
visual quality.

For redesigned surfaces, verify the real rendered UI using screenshots or
equivalent browser evidence for the required matrix:

mobile, tablet, and desktop;

Arabic/RTL and English/LTR;

light and dark themes when supported;

loading, populated, incomplete, error, submitted, locked, and
action-required states as applicable.

Review the evidence for:

hierarchy;

spacing;

alignment;

density;

text wrapping;

overlap and clipping;

action prominence;

consistency;

brand coherence;

proximity of errors to their cause;

safe areas and virtual-keyboard behavior.

When a reference design exists, produce a screen-by-screen comparison and
report material deviations. Do not silently substitute a simpler design.

Visual acceptance must use the real route and intended feature-flag state. A
stub-only browser test cannot establish end-to-end or visual delivery.

9. UX/UI completion rule

Do not print COMPLETE, FULLY VERIFIED, SAFE TO MERGE, or equivalent for a
redesign unless all of the following are true:

the intended route renders the redesigned surface;

the user's normal runtime can reach it;

feature flags and activation steps are documented and verified;

real APIs and persisted data are exercised where relevant;

the approved responsive and language matrix is verified;

visual evidence has been inspected, not merely generated;

no legacy fallback was mistaken for the new surface;

functional, accessibility, and visual gates pass on the same final SHA;

known deviations and residual risks are reported honestly;

any required user/design approval has been obtained.

CI green means technical gates passed. It does not by itself mean the UX is
accepted.

Feature Flags, Rollout, and Visibility

Feature flags are allowed for safe rollout, but they must not hide delivery
status.

For every feature-flagged surface, report:

flag name;

default value;

precedence among build env, runtime config, local storage, account cohort,
and server setting;

exact activation and rollback procedure;

routes and entry points affected;

whether the user's local environment currently has it enabled;

whether production has it enabled;

which browser tests use flag ON and flag OFF.

If the feature is default-off, say implemented but not visible by default.
Do not say the user journey was replaced globally.

Test the intended rollout configuration. A special E2E build with a flag on is
not proof that the normal development or production build exposes it.

Feature flags must not grant authorization or bypass backend policy.

Environment and Deployment Parity

All meaningful work must be verified across relevant environments:

local development;

clean local build;

local production-like execution;

Vercel-compatible frontend build;

backend production-like boot;

intended feature-flag configuration.

Do not rely on:

stale dist folders;

stale generated clients;

stale workspace outputs;

cached bundles;

hidden local state;

machine-specific fixes;

an old Vite process with different build-time flags;

a different API process than the one reported;

mocked browser data as proof of real integration.

Before starting another server, identify which process owns the intended port.
Do not run local and Docker API instances on the same host port and then guess
which one the browser reached.

When environments differ, identify the root cause rather than masking it.

Operating Mode

Unless the task explicitly requires a different safe sequence:

inspect the current codebase and instructions;

establish exact branch, SHA, flags, and runtime;

identify the active delivery mode;

reproduce the real current behavior;

document assumptions, root causes, and the scoped plan;

implement in small, reviewable increments;

add or update appropriate tests;

run formatting, lint, typecheck, tests, and build;

verify real runtime flows;

inspect visual evidence when UI changed;

self-review for regressions, security, accessibility, and design drift;

patch discovered issues;

report exact evidence and remaining risks.

Never jump directly into a large rewrite without understanding route ownership,
state ownership, contracts, and rollback.

Monorepo and Command Discipline

This repository uses a pnpm workspace. Prefer package-scoped commands.

Examples:

pnpm --filter @homeservicemarketplace/api typecheck;

pnpm --filter @homeservicemarketplace/api test;

pnpm --filter @homeservicemarketplace/web lint;

pnpm --filter @homeservicemarketplace/web typecheck;

pnpm --filter @homeservicemarketplace/web test;

pnpm --filter @homeservicemarketplace/web build;

pnpm --filter @homeservicemarketplace/contracts build.

Do not report a green root command as proof when the relevant package command
was not verified.

When reporting results:

list exact commands actually run;

list exact pass, failure, warning, and skip counts;

separate static, functional, visual, and runtime evidence;

do not claim a command or environment was verified when it was not.

Integration-Specific Acceptance Rules

For integration work, verify as applicable:

request and response shapes align exactly;

DTOs, enums, Prisma schema, database values, contracts, and frontend
expectations remain consistent;

migrations and generated clients are in sync;

authentication and session flows work in practice;

validation is enforced server-side and represented clearly in the UI;

loading, error, empty, success, offline, and conflict states are safe;

required environment variables and flags are documented and validated;

local and production-like builds succeed;

real user-facing runtime paths work;

raw infrastructure and database errors never reach the UI.

No green report is allowed without runtime verification of the relevant flow.

Runtime Acceptance Flows

Verify relevant real flows when applicable:

signup;

email and OTP verification;

login and refresh;

role or application upgrade followed by usable session claims;

auth/me;

forgot and reset password;

logout and session invalidation;

protected-route access;

invalid, expired, and revoked credentials;

intended application selection and return path;

feature-flag ON and OFF behavior;

deep-link and reload recovery.

A role written to the database but absent from the active token is not a
completed upgrade flow.

Backend and Server-Owned Truth

The backend remains authoritative for:

authorization;

ownership;

state transitions;

eligibility and capabilities;

prices and payment amounts;

verification decisions;

work-access grants;

policy and readiness;

sensitive-media access;

audit records.

The frontend may project and explain server state, but must not create a second
transition table, permission resolver, or readiness policy.

UX/UI redesign may reorganize how these facts are presented. It may not change
their meaning silently.

Prisma, Database, and Schema Discipline

Use Prisma for PostgreSQL access unless explicitly justified otherwise.

After schema changes, verify:

forward migration creation;

Prisma validation and generation;

production-safe migration application;

drift and migration verification;

enum and contract parity;

indexes and constraints;

rollback or forward-repair strategy;

test impact.

Verify parity across:

Prisma schema;

generated client;

database values;

backend code;

shared contracts;

frontend assumptions.

Do not patch schema drift in one layer only.

Environment and Configuration Hygiene

no duplicate environment keys with conflicting values;

required variables and feature flags must be documented;

development and production expectations must be explicit;

missing required variables must fail clearly and safely;

local development must not silently diverge from production-like behavior;

security-sensitive defaults must not be weakened for convenience;

browser-visible URLs must use host-reachable addresses, not container-only
hostnames.

Never hardcode real:

API keys;

secrets;

tokens;

passwords;

SMTP credentials;

database credentials.

Architecture and Folder Discipline

Default to a modular monolith with strict bounded contexts and safe extraction
paths.

Required qualities:

explicit module and feature ownership;

no circular dependencies;

no hidden shared state;

clear server/client boundaries;

route-level and feature-level composition;

orchestration components kept small;

reusable primitives separated from domain logic;

no new global state library without explicit justification;

no duplicated API client or query-key factory.

For frontend features, prefer a structure such as:

features/<feature>/
api/
components/
copy/
hooks/
routes/
state/
tests/

Use clear names. Prefer camelCase for variables/functions and PascalCase
for components, classes, DTOs, interfaces, and schemas.

Security and Privacy Rules

These rules are non-negotiable in every delivery mode.

never trust client-sent role, ownership, price, amount, duration, status, or
capability;

validate and sanitize untrusted input;

enforce authorization and ownership on the server;

do not leak raw Prisma, SQL, stack, filesystem, token, storage-key, or
internal-host details;

do not log passwords, OTPs, reset tokens, access tokens, refresh tokens, or
unmasked sensitive data;

preserve restricted-media and public-media boundaries;

do not introduce debug backdoors, test-only production routes, or auth
bypasses;

do not weaken privacy to make a preview or redesign easier;

audit sensitive state transitions and reads according to existing policy.

Testing and Quality

Testing is required, but test type must match the claim.

Use as relevant:

unit tests;

contract tests;

integration tests;

real-database tests;

API E2E;

browser E2E;

visual regression;

accessibility checks;

security-focused negative tests;

concurrency and rollback tests.

Rules:

do not limit integration/auth work to unit tests;

do not use mocked API fixtures as the only proof of an end-to-end claim;

do not use DOM assertions as the only proof of visual acceptance;

do not reduce workers to hide isolation races;

do not add skips or reduce test counts without explicit justification;

run affected suites repeatedly when concurrency or timing changed;

report pre-existing warnings honestly;

never invent passing results.

Observability and Runtime Reliability

Prefer:

structured logs;

request/correlation IDs;

health and readiness endpoints;

metrics;

clear error boundaries;

safe timeout handling;

retries only when semantically safe;

idempotency for retryable commands;

production-debuggable failure messages without sensitive data.

Development-only convenience must not crash boot or alter production security.

Git and Change Discipline

inspect the current branch, SHA, worktree, and stashes before editing;

preserve unrelated user changes;

do not reset, rebase, amend, squash, force-push, delete stashes, or merge
unless explicitly authorized;

keep commits purpose-separated;

do not mix a visual redesign with unrelated backend cleanup;

after a pushed change, verify required checks on the new final SHA;

previous green checks do not validate a newer SHA;

do not call a draft or feature complete while required checks are pending.

Output Contract

For non-trivial implementation, bug-fix, integration, or redesign work, report:

active delivery mode and scope;

assumptions;

root causes and UX gap matrix where applicable;

target architecture or design decisions;

files changed and why;

contracts, routes, flags, and migrations;

tests added or updated;

exact commands and counts;

runtime and environment verification;

visual and responsive evidence for UI work;

accessibility, security, and privacy notes;

rollout and rollback;

warnings, skips, residual risks, and known deviations;

final SHA, PR/check status, worktree, and stash state when applicable;

final status: fixed, partially fixed, or blocked.

Do not overstate success.

Forbidden Behaviors

Do not:

redesign UI without an explicit scoped redesign instruction;

refuse or dilute an explicit scoped redesign by citing the default
preservation mode;

treat existing UI as visually authoritative when the task supplies a new
approved design target;

claim UX acceptance from CI or DOM tests alone;

claim a hidden default-off surface replaced the visible user journey;

test one feature-flag state and report the other;

mistake a legacy fallback for the implemented surface;

preserve a known UX defect solely to maximize component reuse;

create a parallel frontend state machine for server-owned policy;

patch backend, database, schema, or auth defects only in the frontend;

patch schema drift in one layer;

disable validation, authorization, tests, or security gates for speed;

expose internal or admin endpoints publicly;

add critical TODO placeholders;

invent tests, screenshots, approvals, or passing results;

claim production readiness without real runtime evidence;

delete legacy or fallback UI before rollout and rollback requirements permit
it;

merge without explicit authorization.

If blocked:

identify the exact blocker;

explain why it blocks the acceptance criteria;

reproduce and investigate from the codebase first;

provide the safest bounded next action;

request external evidence or authority only when genuinely necessary.
