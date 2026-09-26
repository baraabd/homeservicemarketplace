import { describe, expect, it } from 'vitest';
import { validateUploadReservations } from './upload-policy';

const now = Date.UTC(2026, 0, 1);
const item = (id = '1') => ({
  uploadUrl: `https://storage.example.test/uploads/${id}?signature=synthetic`,
  fileUrl: `https://cdn.example.test/requests/${id}.png`,
  expiresAt: new Date(now + 60000).toISOString(),
});
describe('S05 complete upload-reservation contract', () => {
  it('preserves order for a valid complete batch', () => {
    const items = [item('2'), item('1')];
    expect(validateUploadReservations({ items }, 2, now)).toEqual(items);
  });
  it.each([null, {}, { items: [] }, { items: [item()] }, { items: [item(), item(), item()] }])('refuses a missing or incomplete batch %p', (raw) => {
    expect(() => validateUploadReservations(raw, 2, now)).toThrow();
  });
  it.each([
    { uploadUrl: 'javascript:alert(1)' }, { fileUrl: '//other.example/image.png' },
    { uploadUrl: 'https://user:password@example.test/put' }, { fileUrl: 'https://example.test/file#fragment' },
    { expiresAt: 'not-a-date' }, { expiresAt: new Date(now).toISOString() }, { expiresAt: 12 },
  ])('refuses an invalid reservation without exposing its values %p', (override) => {
    expect(() => validateUploadReservations({ items: [{ ...item(), ...override }] }, 1, now)).toThrow('Media upload reservation is invalid');
  });
  it('refuses duplicate upload or destination URLs', () => {
    expect(() => validateUploadReservations({ items: [item(), item()] }, 2, now)).toThrow();
    expect(() => validateUploadReservations({ items: [item(), { ...item('2'), fileUrl: item().fileUrl }] }, 2, now)).toThrow();
  });
});
