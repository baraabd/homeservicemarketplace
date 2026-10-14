import { classifyMailFailure, smtpCodeFromResponse } from './mail-errors';

// R21 — temporary rejection retries; permanent rejection stops; credential
// rejection retries but is classed for alerting.

describe('classifyMailFailure', () => {
  it.each([
    [{ responseCode: 421 }, 'transient'],
    [{ responseCode: 451 }, 'transient'],
    [{ responseCode: 452 }, 'transient'],
    [{ responseCode: 550 }, 'permanent'],
    [{ responseCode: 553 }, 'permanent'],
    [{ responseCode: 535, code: 'EAUTH' }, 'config'],
    [{ responseCode: 530 }, 'config'],
    [{ code: 'EAUTH' }, 'config'],
    [{ code: 'ETIMEDOUT' }, 'transient'],
    [{ code: 'ECONNECTION' }, 'transient'],
    [{ code: 'ETLS' }, 'transient'],
    [{ code: 'EENVELOPE' }, 'permanent'],
    [new Error('something new'), 'transient'],
    [undefined, 'transient'],
  ])('%j is %s', (err, expected) => {
    expect(classifyMailFailure(err).failureClass).toBe(expected);
  });

  it('keeps only the numeric reply code, never the driver message', () => {
    const err = Object.assign(new Error('550 user secret@x.test unknown'), { responseCode: 550 });
    expect(classifyMailFailure(err)).toEqual({ failureClass: 'permanent', smtpCode: 550 });
  });
});

describe('smtpCodeFromResponse', () => {
  it('parses the leading reply code', () => {
    expect(smtpCodeFromResponse('250 2.0.0 Ok: queued as ABC')).toBe(250);
    expect(smtpCodeFromResponse('garbage')).toBeUndefined();
    expect(smtpCodeFromResponse(undefined)).toBeUndefined();
  });
});
