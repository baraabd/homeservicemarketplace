import { appUrl, escapeHtml, singleLine } from './escape';
import {
  isMailTemplateId,
  renderMail,
  templateCategory,
  validateTemplateVars,
} from './mail-templates';
import type { MailTemplateId } from './mail-template.types';

// R21 — bilingual, escaped templates.

const ctx = { frontendUrl: 'https://app.example.test' };
const TOKEN = 'AbC_-123'.padEnd(43, 'z');

describe('mail templates', () => {
  it('OTP mail keeps the acceptance-suite contract: English first, "code is NNNNNN", first 6-digit number is the code', () => {
    for (const id of ['auth.registration_otp', 'auth.login_otp'] as const) {
      const m = renderMail(id, { code: '482913', minutes: 5 }, ctx);
      expect(m.text).toMatch(/code is 482913/);
      expect(/\b(\d{6})\b/.exec(m.text)?.[1]).toBe('482913');
      expect(/\b(\d{6})\b/.exec(`${m.text} ${m.html}`)?.[1]).toBe('482913');
      expect(m.text.indexOf('code is')).toBeLessThan(m.text.indexOf('رمز'));
    }
  });

  it('verification and reset links point at the fixed app route and carry token=<value>', () => {
    const v = renderMail('auth.email_verification', { token: TOKEN }, ctx);
    const r = renderMail('auth.password_reset', { token: TOKEN }, ctx);
    expect(v.text).toContain(`https://app.example.test/verify-email?token=${TOKEN}`);
    expect(r.text).toContain(`https://app.example.test/reset-password?token=${TOKEN}`);
    expect(/token=([A-Za-z0-9_-]+)/.exec(r.text)?.[1]).toBe(TOKEN);
    expect(r.html).toContain(`href="https://app.example.test/reset-password?token=${TOKEN}"`);
  });

  it('falls back to a bare token=… line when no web origin is configured', () => {
    const r = renderMail('auth.password_reset', { token: TOKEN }, { frontendUrl: null });
    expect(r.text).toContain(`token=${TOKEN}`);
    expect(r.html).not.toContain('href=');
  });

  it('never puts a secret in the subject (subjects are logged and indexed)', () => {
    expect(renderMail('auth.login_otp', { code: '482913', minutes: 5 }, ctx).subject).not.toContain(
      '482913',
    );
    expect(renderMail('auth.password_reset', { token: TOKEN }, ctx).subject).not.toContain(TOKEN);
  });

  it('every template renders both languages with lang/dir marked in HTML', () => {
    const samples: { [K in MailTemplateId]: unknown } = {
      'auth.registration_otp': { code: '123456', minutes: 5 },
      'auth.login_otp': { code: '123456', minutes: 5 },
      'auth.email_verification': { token: TOKEN },
      'auth.password_reset': { token: TOKEN },
      'provider.verification_action_required': {},
      'provider.verification_outcome': { outcome: 'rejected' },
      'account.payment_status': { status: 'failed' },
    };
    for (const [id, vars] of Object.entries(samples)) {
      const m = renderMail(id as MailTemplateId, vars as never, ctx);
      expect(m.html).toContain('<div lang="en" dir="ltr"');
      expect(m.html).toContain('<div lang="ar" dir="rtl"');
      expect(m.text).toMatch(/[؀-ۿ]/);
      expect(m.subject).toMatch(/[؀-ۿ]/);
    }
  });

  it('notification templates link only to the authenticated view and carry no case detail', () => {
    const m = renderMail('provider.verification_action_required', {} as never, ctx);
    expect(m.text).toContain('https://app.example.test/provider/verification');
    expect(m.text).not.toMatch(/caseId|resourceId|\?/);
    expect(templateCategory('provider.verification_action_required')).toBe('NOTIFICATION');
    expect(templateCategory('auth.password_reset')).toBe('AUTH');
  });

  it('rejects variables outside the strict schema instead of escaping hostile input into storage', () => {
    expect(() =>
      validateTemplateVars('auth.login_otp', { code: '<b>1</b>', minutes: 5 }),
    ).toThrow();
    expect(() =>
      validateTemplateVars('auth.password_reset', { token: '"><script>alert(1)</script>' }),
    ).toThrow();
    expect(() =>
      validateTemplateVars('auth.password_reset', { token: TOKEN, extra: 'x' }),
    ).toThrow();
    expect(() =>
      validateTemplateVars('provider.verification_outcome', { outcome: 'banned' }),
    ).toThrow();
    expect(() => renderMail('auth.login_otp', { code: 'x', minutes: 5 } as never, ctx)).toThrow();
  });

  it('isMailTemplateId refuses unknown and prototype keys', () => {
    expect(isMailTemplateId('auth.login_otp')).toBe(true);
    expect(isMailTemplateId('toString')).toBe(false);
    expect(isMailTemplateId('auth.unknown')).toBe(false);
  });
});

describe('escaping helpers', () => {
  it('escapeHtml neutralises markup and attribute breakouts', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&\``)).toBe(
      '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;&#96;',
    );
  });

  it('singleLine strips CR/LF, other controls and Unicode separators but keeps ordinary text', () => {
    expect(singleLine('a\r\nFrom: evil\u2028b\u0000c-d')).toBe('a  From: evil b c-d');
  });

  it('appUrl only builds http(s) URLs on the configured origin for absolute app paths', () => {
    expect(appUrl('https://app.example.test', '/x', { token: 'a b&c' })).toBe(
      'https://app.example.test/x?token=a+b%26c',
    );
    expect(appUrl('https://host.test/base/', '/x')).toBe('https://host.test/base/x');
    expect(appUrl('javascript:alert(1)', '/x')).toBeNull();
    expect(appUrl('not a url', '/x')).toBeNull();
    expect(appUrl('https://app.example.test', '//evil.test/x')).toBeNull();
    expect(appUrl('https://app.example.test', 'relative')).toBeNull();
    expect(appUrl(null, '/x')).toBeNull();
  });
});
