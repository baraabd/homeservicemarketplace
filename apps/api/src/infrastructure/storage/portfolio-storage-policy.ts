/** Portfolio staging is separate from identity evidence and public request media. */
export const PORTFOLIO_STAGING_PREFIX = 'portfolio-staging/';

export function isPortfolioStorageKey(key: string): boolean {
  return (
    (key.startsWith(PORTFOLIO_STAGING_PREFIX) || key.startsWith('portfolio/')) &&
    !key.includes('..') &&
    !key.includes('\0') &&
    !key.includes('//')
  );
}

export function isStagedPortfolioKey(key: string): boolean {
  return key.startsWith(PORTFOLIO_STAGING_PREFIX);
}
