import { configuredCorsOrigins } from './cors-policy';
describe('R26 configured CORS origins', () => {
  it('canonicalizes exact origins and deduplicates frontend/extra entries', () => {
    expect(
      configuredCorsOrigins('https://APP.example:443/', [
        'https://app.example',
        'http://127.0.0.1:5326',
      ]),
    ).toEqual(['https://app.example', 'http://127.0.0.1:5326']);
  });
  it('preserves the empty production deny-list', () =>
    expect(configuredCorsOrigins(undefined, [])).toEqual([]));
  it('preserves canonical IDN, IPv6 and loopback origins', () => {
    expect(
      configuredCorsOrigins('https://BÜCHER.example:443/', [
        'https://xn--bcher-kva.example',
        'https://[2001:db8::1]:8443/',
        'http://[::1]:5326/',
      ]),
    ).toEqual(['https://xn--bcher-kva.example', 'https://[2001:db8::1]:8443', 'http://[::1]:5326']);
  });
  it.each([
    '*',
    'null',
    'https://*.example',
    'https://app.example/path',
    'https://app.example/?token=private',
    'https://app.example/#fragment',
    'https://name:private@app.example',
    '//app.example',
    'data:text/html,x',
    'https://app.example\\@other.example',
    'https://app.example\n',
    'https://api;private.example.test',
    "https://api'private.example.test",
    'https://api"private.example.test',
    'https://api,private.example.test',
    'https://%2A',
    'https://%2a.example.test',
    'https://api%3bprivate.example.test',
    'https://api%27private.example.test',
    'https://api%22private.example.test',
    'https://api%2cprivate.example.test',
    'https://＊.example.test',
    'https://api；private.example.test',
    'https://api＇private.example.test',
    'https://api＂private.example.test',
    'https://api，private.example.test',
  ])('rejects unsafe origin %# without disclosure', (raw) => {
    expect(() => configuredCorsOrigins(raw, [])).toThrow(
      'CORS configuration requires exact HTTP(S) origins',
    );
    expect(() => configuredCorsOrigins(undefined, [raw])).toThrow(
      'CORS configuration requires exact HTTP(S) origins',
    );
  });
});
