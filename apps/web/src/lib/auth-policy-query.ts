/** Public policy contains no identity or session data and survives account changes. */
export const AUTH_CONFIG_PATH = '/v1/auth/config';
export const AUTH_CONFIG_QUERY_KEY = ['auth', 'config'] as const;
export function isAuthConfigurationQuery(key: readonly unknown[]): boolean {
  return (
    key.length === 2 && key[0] === AUTH_CONFIG_QUERY_KEY[0] && key[1] === AUTH_CONFIG_QUERY_KEY[1]
  );
}
