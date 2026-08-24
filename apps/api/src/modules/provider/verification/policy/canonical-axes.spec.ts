import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  ADMIN_PROVIDER_TRANSITIONS,
  availableAdminProviderActions,
  type AdminProviderAction,
} from '@homeservicemarketplace/contracts';
import {
  ProviderProfileStatus,
  ProviderSubscriptionTier,
  ProviderVerificationState,
  ProviderWorkAccessSource,
  VerificationCaseState,
} from '@homeservicemarketplace/database';

import {
  VERIFICATION_CASE_TRANSITIONS,
  availableCaseActions,
  type VerificationCaseAction,
} from './case-transitions';

// Sprint 9B.1 — the architecture decision, as executable assertions.
//
// This repository has TWO canonical lifecycle tables, on two different axes:
//
//   VERIFICATION_CASE_TRANSITIONS   evidence review    VerificationCaseState
//   ADMIN_PROVIDER_TRANSITIONS      account standing   ProviderProfileStatus
//
// The brief that opened 9B asked for a single "seven reviewer actions" table.
// There is no such table and one must not be invented: the seven span both
// axes, and merging them would put "suspend this account" and "reject this
// evidence" behind one enum whose source states come from two different
// vocabularies. That is the D-3 defect (docs/sprint-09/INSPECTION.md) in a new
// costume — one authority covering two rules, drifting against both.
//
// Each table already has a spec covering its own immutability and its own
// legal transitions. What nothing covered until now is the relationship
// BETWEEN them, which is what an implementer is most likely to get wrong.
// These are those tests.

const CASE_STATES = Object.values(VerificationCaseState);
const ACCOUNT_STATES = Object.values(ProviderProfileStatus);

const CASE_ACTIONS = Object.keys(VERIFICATION_CASE_TRANSITIONS) as VerificationCaseAction[];
const ACCOUNT_ACTIONS = Object.keys(ADMIN_PROVIDER_TRANSITIONS) as AdminProviderAction[];

const ACTORS = ['provider', 'reviewer', 'system'] as const;

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..', '..');

/** Every .ts/.tsx file under a directory, for the source-level guardrails. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** Source with comment lines removed, so a guardrail cannot be tripped by
 *  prose that merely NAMES the thing it forbids. */
function codeOnly(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('the two canonical axes are separate', () => {
  it('keeps each axis-specific action on its own table', () => {
    for (const action of ['submit', 'assign', 'requestAction', 'reverify', 'expire', 'revoke']) {
      expect(CASE_ACTIONS).toContain(action);
      expect(ACCOUNT_ACTIONS).not.toContain(action);
    }
    for (const action of ['suspend', 'reactivate']) {
      expect(ACCOUNT_ACTIONS).toContain(action);
      expect(CASE_ACTIONS).not.toContain(action);
    }
  });

  it('does not merge the two into one synthetic table', () => {
    // A merged table would have to hold every action from both. If anyone
    // ever adds the account actions to the case table (or the reverse) to
    // manufacture "the seven", this fails.
    const merged = [...new Set([...CASE_ACTIONS, ...ACCOUNT_ACTIONS])];
    expect(merged.length).toBeGreaterThan(CASE_ACTIONS.length);
    expect(merged.length).toBeGreaterThan(ACCOUNT_ACTIONS.length);
  });

  it('lets approve and reject exist on both axes without sharing a vocabulary', () => {
    // Both tables define approve and reject, and they mean different things.
    // What keeps that safe is that neither one's source states are legal
    // inputs to the other — pinned by the fail-closed tests below.
    for (const shared of ['approve', 'reject']) {
      expect(CASE_ACTIONS).toContain(shared);
      expect(ACCOUNT_ACTIONS).toContain(shared);
    }
  });

  it('neither policy module imports the other', () => {
    // A cross-import is how two tables quietly become one authority.
    const caseTable = codeOnly(readFileSync(join(__dirname, 'case-transitions.ts'), 'utf8'));
    expect(caseTable).not.toContain('admin-provider-transitions');
    expect(caseTable).not.toContain('ADMIN_PROVIDER_TRANSITIONS');

    const accountTable = codeOnly(
      readFileSync(
        join(
          REPO_ROOT,
          'packages',
          'contracts',
          'src',
          'admin',
          'verification',
          'admin-provider-transitions.ts',
        ),
        'utf8',
      ),
    );
    expect(accountTable).not.toContain('case-transitions');
    expect(accountTable).not.toContain('VERIFICATION_CASE_TRANSITIONS');
  });
});

describe('the two state vocabularies overlap only where recorded', () => {
  it('shares exactly DRAFT and REJECTED as names, and nothing else', () => {
    // A tripwire, not an endorsement. These two strings exist in both enums
    // and mean different things: a DRAFT case is unsubmitted evidence, a DRAFT
    // account has never finished onboarding. Code that compares a state
    // without knowing which axis produced it is wrong for exactly these two
    // values, and a third shared name should force that conversation.
    const shared = CASE_STATES.filter((s) => (ACCOUNT_STATES as string[]).includes(s)).sort();
    expect(shared).toEqual(['DRAFT', 'REJECTED']);
  });

  it('fails closed when an account state is handed to the case table', () => {
    const foreign = ACCOUNT_STATES.filter((s) => !(CASE_STATES as string[]).includes(s));
    expect(foreign.length).toBeGreaterThan(0);

    // Collected rather than asserted one at a time so a failure names every
    // offending pair at once instead of stopping at the first.
    const offered = foreign.flatMap((state) =>
      ACTORS.flatMap((actor) => {
        const actions = availableCaseActions(state as unknown as VerificationCaseState, actor);
        return actions.length > 0 ? [`${state}/${actor} -> ${actions.join(',')}`] : [];
      }),
    );
    expect(offered).toEqual([]);
  });

  it('fails closed when a case state is handed to the account table', () => {
    const foreign = CASE_STATES.filter((s) => !(ACCOUNT_STATES as string[]).includes(s));
    expect(foreign.length).toBeGreaterThan(0);

    const offered = foreign.flatMap((state) => {
      const actions = availableAdminProviderActions(state as unknown as ProviderProfileStatus);
      return actions.length > 0 ? [`${state} -> ${actions.join(',')}`] : [];
    });
    expect(offered).toEqual([]);
  });
});

describe('availableActions is derived on the server', () => {
  it('is a pure function of its inputs on both axes', () => {
    for (const state of CASE_STATES) {
      for (const actor of ACTORS) {
        expect(availableCaseActions(state, actor)).toEqual(availableCaseActions(state, actor));
      }
    }
    for (const status of ACCOUNT_STATES) {
      expect(availableAdminProviderActions(status)).toEqual(availableAdminProviderActions(status));
    }
  });

  it('never offers an action its table does not permit from that state', () => {
    for (const state of CASE_STATES) {
      for (const actor of ACTORS) {
        for (const action of availableCaseActions(state, actor)) {
          const rule = VERIFICATION_CASE_TRANSITIONS[action];
          expect(rule.from).toContain(state);
          expect(rule.actor).toBe(actor);
        }
      }
    }
    for (const status of ACCOUNT_STATES) {
      for (const action of availableAdminProviderActions(status)) {
        expect(ADMIN_PROVIDER_TRANSITIONS[action]).toContain(status);
      }
    }
  });

  it('leaves the web app owning no copy of either rule', () => {
    // The D-3 defect was a client re-deriving an authorization rule and
    // drifting: the admin UI offered Approve on DRAFT and the server answered
    // 409. The client is TOLD its actions. It must not import the tables or
    // the helpers that compute them, because either is enough to re-derive.
    const forbidden = [
      'ADMIN_PROVIDER_TRANSITIONS',
      'VERIFICATION_CASE_TRANSITIONS',
      'availableAdminProviderActions',
      'availableCaseActions',
    ];

    const files = sourceFiles(join(REPO_ROOT, 'apps', 'web', 'src'));
    // Non-vacuity. A wrong REPO_ROOT would make this guardrail pass by
    // scanning nothing, which is the failure mode of every source-scanning
    // test and the reason to assert it found a real tree.
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of files) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const trimmed = line.trim();
        // Only import machinery counts. A comment naming the table is
        // documentation, not a second copy of the rule.
        const isImport =
          trimmed.startsWith('import ') ||
          trimmed.startsWith('} from ') ||
          trimmed.includes('require(');
        if (!isImport) continue;
        for (const symbol of forbidden) {
          if (line.includes(symbol)) offenders.push([file, trimmed].join(': '));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('commercial standing cannot buy verification or work access', () => {
  it('keeps the subscription vocabulary disjoint from the verification one', () => {
    // VIP and Featured do not exist in this codebase; the commercial axis is
    // ProviderSubscriptionTier. It must never share a value with the axes that
    // decide whether someone may work — a shared token is how ELITE eventually
    // gets compared against a verification state.
    const tiers = Object.values(ProviderSubscriptionTier) as string[];
    const verificationStates = Object.values(ProviderVerificationState) as string[];
    const grantSources = Object.values(ProviderWorkAccessSource) as string[];

    for (const tier of tiers) {
      expect(verificationStates).not.toContain(tier);
      expect(grantSources).not.toContain(tier);
      expect(CASE_STATES as string[]).not.toContain(tier);
    }
  });

  it('offers no way to source a work-access grant from a commercial tier', () => {
    // Every justification a grant may carry, enumerated. A paid tier is not
    // among them, and adding one would have to happen here first.
    expect(Object.values(ProviderWorkAccessSource).sort()).toEqual([
      'LEGACY_BACKFILL',
      'MANUAL_OVERRIDE',
      'RENEWAL',
      'VERIFIED_DOCUMENTS',
    ]);
  });

  it('keeps commercial fields out of the capability decision inputs', () => {
    // The behavioural proof — flipping the fields changes nothing — already
    // lives in provider-capability.service.spec.ts. This is the structural
    // half: a service cannot be influenced by what it never reads, and the
    // cheapest way to keep that true is for the field never to be selected.
    const service = codeOnly(
      readFileSync(
        join(
          REPO_ROOT,
          'apps',
          'api',
          'src',
          'modules',
          'provider',
          'capability',
          'provider-capability.service.ts',
        ),
        'utf8',
      ),
    );

    const read = ['subscriptionTier', 'topPro', 'isVip', 'isFeatured'].filter((field) =>
      service.includes(field),
    );
    expect(read).toEqual([]);
  });
});
