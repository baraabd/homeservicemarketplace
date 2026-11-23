# Historical dependency hold — superseded by the Zod security repair

The initial Zod upgrade in PR #188 changed the performance dependency graph.
R27 run `40016123413`, job `120628504400`, correctly rejected its repair
baseline because the candidate and baseline lockfiles differed. The unchanged
comparison and acceptance programs also require identical dependency digests.

An interim correction restored the develop manifests/lockfile and deferred
Zod 4. That state is preserved historically at
`4a471c20f3681e5fa7f37bc0701d01b56336e558`; it is **not the final solution**.
The fresh audit on that source reported `GHSA-mrhx-c7xc-m3w5` in the API's
Zod 3.25.76 and the lint plugin's Zod 4.3.6. Retaining the hold would leave a
known security failure.

The current repair pins direct and affected transitive Zod dependencies to
4.6.6 and supplies independently verifiable immutable controls with exactly
the same dependency files. See [ZOD_SECURITY_REPAIR.md](ZOD_SECURITY_REPAIR.md)
and [r27-dependency-controls.json](r27-dependency-controls.json).

The original measurement jobs, comparison semantics, complete browser matrix,
query/bundle budgets, CodeQL and zero-finding audit remain required. Historical
measurements are not relabelled as current evidence. Dependabot remains enabled.

Reverting the dependency security correction restores the known advisory;
reverting its control registration alone restores the incomparable-baseline
failure. G3/R34 still require their separate implementation and acceptance
evidence.
