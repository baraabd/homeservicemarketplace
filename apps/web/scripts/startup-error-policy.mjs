/** Exact, bounded exceptions for expected anonymous-auth HTTP responses.
 * URLs and browser messages are inspected in memory and never returned.
 */
export function validateExpectedHttpErrors(value = []) {
  if (!Array.isArray(value)) throw new Error('expectedHttpErrors must be an array');
  const seen = new Set();
  return value.map((item) => {
    const url = new URL(item.url);
    const method = item.method ?? 'GET';
    const maxCount = item.maxCount ?? 1;
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.href !== item.url ||
      !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method) ||
      !Number.isInteger(item.status) ||
      item.status < 400 ||
      item.status >= 500 ||
      !Number.isInteger(maxCount) ||
      maxCount < 1 ||
      maxCount > 10
    )
      throw new Error('Expected HTTP errors require exact URLs, 4xx statuses and bounded counts');
    const key = `${method} ${url.href} ${item.status}`;
    if (seen.has(key)) throw new Error('Duplicate expected HTTP error');
    seen.add(key);
    return { url: url.href, method, status: item.status, maxCount };
  });
}

export function createStartupErrorPolicy(rules) {
  const expected = rules.map(() => ({ responses: 0, consoleCandidates: 0 }));
  const unexpectedHttpErrorsByStatus = {};
  let otherConsoleErrors = 0;
  return {
    response({ url, method, status }) {
      if (status < 400) return;
      const index = rules.findIndex(
        (rule) => rule.url === url && rule.method === method && rule.status === status,
      );
      if (index >= 0 && expected[index].responses < rules[index].maxCount) {
        expected[index].responses += 1;
      } else {
        unexpectedHttpErrorsByStatus[status] = (unexpectedHttpErrorsByStatus[status] ?? 0) + 1;
      }
    },
    consoleError({ url, text }) {
      // Only Chromium's native resource-error wording, at that exact resource
      // URL, can correspond to an allowed HTTP response. Application console
      // errors and other resources remain failures even when they mention 401.
      const index = rules.findIndex(
        (rule) =>
          rule.url === url &&
          new RegExp(
            `^Failed to load resource: the server responded with a status of ${rule.status}(?: \\([^\\r\\n]*\\))?$`,
            'u',
          ).test(text),
      );
      if (index >= 0 && expected[index].consoleCandidates < rules[index].maxCount) {
        expected[index].consoleCandidates += 1;
      } else {
        otherConsoleErrors += 1;
      }
    },
    read() {
      // CDP response and console events may arrive in either order. A matched
      // console message is excused only once its actual response was observed.
      return {
        expectedHttpErrors: rules.map((rule, index) => ({
          rule: index,
          status: rule.status,
          method: rule.method,
          maxCount: rule.maxCount,
          responses: expected[index].responses,
          consoleErrors: Math.min(expected[index].consoleCandidates, expected[index].responses),
        })),
        unexpectedHttpErrorsByStatus: { ...unexpectedHttpErrorsByStatus },
        unexpectedConsoleErrors:
          otherConsoleErrors +
          expected.reduce(
            (sum, entry) => sum + Math.max(0, entry.consoleCandidates - entry.responses),
            0,
          ),
      };
    },
  };
}
