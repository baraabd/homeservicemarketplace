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
  ])('rejects unsafe origin %# without disclosure', (raw) => {
    expect(() => configuredCorsOrigins(raw, [])).toThrow(
      'CORS configuration requires exact HTTP(S) origins',
    );
    expect(() => configuredCorsOrigins(undefined, [raw])).toThrow(
      'CORS configuration requires exact HTTP(S) origins',
    );
  });
});
