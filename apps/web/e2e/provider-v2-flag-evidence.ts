/** A string supplied by a test is a claim, not an observation from its browser.
 * Preserve it for audit, but never promote it to proof of the shipped default.
 * Existing persistence tests set a browser override and cannot make that claim. */
export function unobservedRouteFlagEvidence(declaredFlagSource: string) {
  return {
    flagSource: 'unverified:effective-browser-source-not-captured',
    declaredFlagSource,
    flagSourceVerified: false,
    browserOverrideAbsent: null,
    deploymentDefaultProven: false,
  } as const;
}
