/** Match the deliberately broken CommonJS browser boundary, not any page error. */
export function isLegacyContractModuleError(message: string): boolean {
  const match =
    /^The requested module '([^']+)' does not provide an export named '(LEGACY_PUBLICATION_ACK_TEXT|DISPUTE_WORKSPACE_STATES)'$/.exec(
      message,
    );
  return Boolean(match && /\/packages\/contracts\/dist\/index\.js$/.test(match[1]));
}
