import { afterEach, describe, expect, it, vi } from 'vitest';
import { readOtpFromMailbox } from '../../e2e/otp-mailbox';

const otpFor = (email: string) => readOtpFromMailbox('http://mailbox.example.test', email);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('real-API OTP mailbox selection (explicit HTTP fixture)', () => {
  it('finds an OTP behind a newer notification and consumes only its message', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          messages: [
            { ID: 'notice', To: [{ Address: 'owner@example.test' }] },
            { ID: 'otp', To: [{ Address: 'owner@example.test' }] },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ Text: 'Your verification needs correction.' }))
      .mockResolvedValueOnce(Response.json({ Text: 'Your code is 123456.' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', request);
    await expect(otpFor('OWNER@example.test')).resolves.toBe('123456');
    expect(request.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/api/v1/messages',
      '/api/v1/message/notice',
      '/api/v1/message/otp',
      '/api/v1/messages',
    ]);
    expect(JSON.parse(request.mock.calls[3][1].body)).toEqual({ IDs: ['otp'] });
  });

  it('never reads or deletes another recipient message or treats metadata as a code', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          messages: [
            { ID: 'foreign', To: [{ Address: 'other@example.test' }] },
            { ID: 'mine', To: [{ Address: 'owner@example.test' }] },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ ID: '999999', Text: 'Your code is 654321.' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', request);
    await expect(otpFor('owner@example.test')).resolves.toBe('654321');
    expect(request.mock.calls.some(([url]) => String(url).includes('foreign'))).toBe(false);
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ IDs: ['mine'] });
  });

  it('retains notifications and fails within the existing bounded polling window', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (url: string) =>
      Response.json(
        url.includes('/message/')
          ? { Text: 'A notification without an OTP.' }
          : { messages: [{ ID: 'notice', To: [{ Address: 'owner@example.test' }] }] },
      ),
    );
    vi.stubGlobal('fetch', request);
    const result = expect(otpFor('owner@example.test')).rejects.toThrow('no OTP mail arrived');
    await vi.runAllTimersAsync();
    await result;
    expect(request).toHaveBeenCalledTimes(150);
    expect(request.mock.calls.every((args) => args.length === 1)).toBe(true);
  });

  it('fails closed when the mailbox rejects a request', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', request);
    await expect(otpFor('owner@example.test')).rejects.toThrow('OTP mailbox listing failed (503)');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
