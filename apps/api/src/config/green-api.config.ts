/** Only provider-owned HTTPS origins may receive an instance token in the URL. */
export function isGreenApiOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      /^(?:[0-9]+\.)?api\.green-?api\.com$/.test(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
