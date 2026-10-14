import { z } from 'zod';

import { appUrl, escapeHtml, singleLine } from './escape';
import type { MailCategory, MailTemplateId, MailTemplateVars } from './mail-template.types';

// R21 — bilingual transactional templates.
//
// Every message carries English first and Arabic second, in one part each for
// text and HTML: the platform does not yet store a per-user language, and a
// security code must be readable whichever language the recipient uses. The
// HTML marks each block with its own `lang` and `dir`.
//
// Compatibility contract (relied on by the auth acceptance suites): the
// English text block comes first; the OTP text contains "code is NNNNNN" and
// the code is the first standalone 6-digit number; verification and reset
// links contain "token=<value>". Codes and minutes use ASCII digits in both
// languages, because the recipient types the code into a form.

export interface MailRenderContext {
  // Absolute web origin links are built on. null → link-free fallback.
  frontendUrl: string | null;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

interface Block {
  heading: string;
  lines: string[];
  action?: { label: string; url: string } | undefined;
  footer: string;
}

interface TemplateDef<T extends MailTemplateId> {
  category: MailCategory;
  schema: z.ZodType<MailTemplateVars[T]>;
  render(
    vars: MailTemplateVars[T],
    ctx: MailRenderContext,
  ): { subject: string; en: Block; ar: Block };
}

const code = z.string().regex(/^\d{4,8}$/);
const minutes = z.number().int().min(1).max(1440);
const token = z.string().regex(/^[A-Za-z0-9_-]{16,512}$/);

const FOOTER_EN = 'If you did not request this, you can ignore this email.';
const FOOTER_AR = 'إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة.';
const NOTICE_FOOTER_EN =
  'Sign in to see the details. We never include documents or review notes in email.';
const NOTICE_FOOTER_AR =
  'سجّل الدخول لعرض التفاصيل. لا نرسل المستندات أو ملاحظات المراجعة عبر البريد الإلكتروني.';

function tokenLink(
  ctx: MailRenderContext,
  path: string,
  raw: string,
): { url: string | null; text: string } {
  const url = appUrl(ctx.frontendUrl, path, { token: raw });
  return { url, text: url ?? `token=${raw}` };
}

const TEMPLATES: { [K in MailTemplateId]: TemplateDef<K> } = {
  'auth.registration_otp': {
    category: 'AUTH',
    schema: z.object({ code, minutes }).strict(),
    render: ({ code: c, minutes: m }) => ({
      subject: 'Confirm your email to finish signing up · أكّد بريدك لإكمال التسجيل',
      en: {
        heading: 'Confirm your email',
        lines: [`Your registration code is ${c}. It expires in ${m} minutes.`],
        footer: FOOTER_EN,
      },
      ar: {
        heading: 'تأكيد بريدك الإلكتروني',
        lines: [`رمز التسجيل الخاص بك هو ${c}، وتنتهي صلاحيته بعد ${m} دقيقة.`],
        footer: FOOTER_AR,
      },
    }),
  },
  'auth.login_otp': {
    category: 'AUTH',
    schema: z.object({ code, minutes }).strict(),
    render: ({ code: c, minutes: m }) => ({
      subject: 'Your sign-in code · رمز تسجيل الدخول',
      en: {
        heading: 'Your sign-in code',
        lines: [`Your sign-in code is ${c}. It expires in ${m} minutes.`],
        footer: FOOTER_EN,
      },
      ar: {
        heading: 'رمز تسجيل الدخول',
        lines: [`رمز تسجيل الدخول الخاص بك هو ${c}، وتنتهي صلاحيته بعد ${m} دقيقة.`],
        footer: FOOTER_AR,
      },
    }),
  },
  'auth.email_verification': {
    category: 'AUTH',
    schema: z.object({ token }).strict(),
    render: ({ token: t }, ctx) => {
      const link = tokenLink(ctx, '/verify-email', t);
      return {
        subject: 'Verify your email · تأكيد بريدك الإلكتروني',
        en: {
          heading: 'Verify your email',
          lines: [`Confirm your address: ${link.text}`],
          action: link.url ? { label: 'Verify email', url: link.url } : undefined,
          footer: FOOTER_EN,
        },
        ar: {
          heading: 'تأكيد بريدك الإلكتروني',
          lines: ['استخدم الرابط أعلاه لتأكيد عنوان بريدك الإلكتروني.'],
          action: link.url ? { label: 'تأكيد البريد الإلكتروني', url: link.url } : undefined,
          footer: FOOTER_AR,
        },
      };
    },
  },
  'auth.password_reset': {
    category: 'AUTH',
    schema: z.object({ token }).strict(),
    render: ({ token: t }, ctx) => {
      const link = tokenLink(ctx, '/reset-password', t);
      return {
        subject: 'Reset your password · إعادة تعيين كلمة المرور',
        en: {
          heading: 'Reset your password',
          lines: [`Reset link (valid briefly): ${link.text}`],
          action: link.url ? { label: 'Reset password', url: link.url } : undefined,
          footer: FOOTER_EN,
        },
        ar: {
          heading: 'إعادة تعيين كلمة المرور',
          lines: ['استخدم الرابط أعلاه لإعادة تعيين كلمة المرور. صلاحيته قصيرة.'],
          action: link.url ? { label: 'إعادة تعيين كلمة المرور', url: link.url } : undefined,
          footer: FOOTER_AR,
        },
      };
    },
  },
  'provider.verification_action_required': {
    category: 'NOTIFICATION',
    schema: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    render: (_vars, ctx) => {
      const url = appUrl(ctx.frontendUrl, '/provider/verification');
      return {
        subject: 'Your verification needs attention · التحقق من حسابك يحتاج إلى إجراء',
        en: {
          heading: 'Your verification needs attention',
          lines: ['A reviewer has asked for something before your application can continue.'],
          action: url ? { label: 'Open verification', url } : undefined,
          footer: NOTICE_FOOTER_EN,
        },
        ar: {
          heading: 'التحقق من حسابك يحتاج إلى إجراء',
          lines: ['طلب أحد المراجعين أمرًا قبل متابعة طلبك.'],
          action: url ? { label: 'فتح صفحة التحقق', url } : undefined,
          footer: NOTICE_FOOTER_AR,
        },
      };
    },
  },
  'provider.verification_outcome': {
    category: 'NOTIFICATION',
    schema: z.object({ outcome: z.enum(['approved', 'rejected', 'expired']) }).strict(),
    render: ({ outcome }, ctx) => {
      const url = appUrl(ctx.frontendUrl, '/provider/verification');
      const en = {
        approved: [
          'Your verification is complete',
          'Your documents have been checked. Open your provider workspace to see your current access.',
        ],
        rejected: [
          'Your verification could not be completed',
          'A reviewer has closed your verification. Open your verification page for details.',
        ],
        expired: [
          'Your verification needs renewing',
          'Your verification has reached the end of its validity. Submit fresh documents to keep taking work.',
        ],
      }[outcome];
      const ar = {
        approved: [
          'اكتمل التحقق من حسابك',
          'تم فحص مستنداتك. افتح مساحة عمل مزوّد الخدمة لمعرفة صلاحياتك الحالية.',
        ],
        rejected: [
          'تعذّر إكمال التحقق من حسابك',
          'أغلق أحد المراجعين طلب التحقق. افتح صفحة التحقق لمعرفة التفاصيل.',
        ],
        expired: [
          'التحقق من حسابك يحتاج إلى تجديد',
          'انتهت مدة صلاحية التحقق. أرسل مستندات جديدة لمواصلة استقبال الأعمال.',
        ],
      }[outcome];
      return {
        subject: `${en[0]} · ${ar[0]}`,
        en: {
          heading: en[0]!,
          lines: [en[1]!],
          action: url ? { label: 'Open verification', url } : undefined,
          footer: NOTICE_FOOTER_EN,
        },
        ar: {
          heading: ar[0]!,
          lines: [ar[1]!],
          action: url ? { label: 'فتح صفحة التحقق', url } : undefined,
          footer: NOTICE_FOOTER_AR,
        },
      };
    },
  },
  'account.payment_status': {
    category: 'NOTIFICATION',
    schema: z.object({ status: z.enum(['succeeded', 'failed', 'action_required']) }).strict(),
    render: ({ status }, ctx) => {
      const url = appUrl(ctx.frontendUrl, '/provider');
      const en = {
        succeeded: ['Your payment was received', 'Your payment has been confirmed.'],
        failed: [
          'Your payment did not go through',
          'Your payment could not be completed. No new charge was confirmed.',
        ],
        action_required: [
          'Your payment needs attention',
          'Your payment needs an action from you before it can complete.',
        ],
      }[status];
      const ar = {
        succeeded: ['تم استلام دفعتك', 'تم تأكيد دفعتك.'],
        failed: ['لم تكتمل عملية الدفع', 'تعذّر إكمال الدفع، ولم يتم تأكيد أي مبلغ جديد.'],
        action_required: ['دفعتك تحتاج إلى إجراء', 'تحتاج دفعتك إلى إجراء منك قبل أن تكتمل.'],
      }[status];
      return {
        subject: `${en[0]} · ${ar[0]}`,
        en: {
          heading: en[0]!,
          lines: [en[1]!],
          action: url ? { label: 'Open your account', url } : undefined,
          footer: NOTICE_FOOTER_EN,
        },
        ar: {
          heading: ar[0]!,
          lines: [ar[1]!],
          action: url ? { label: 'فتح حسابك', url } : undefined,
          footer: NOTICE_FOOTER_AR,
        },
      };
    },
  },
};

export function isMailTemplateId(value: string): value is MailTemplateId {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, value);
}

export function templateCategory(id: MailTemplateId): MailCategory {
  return TEMPLATES[id].category;
}

/** Validates producer variables. Throws on anything outside the template's
 *  strict schema, so a malformed or oversized value never reaches storage. */
export function validateTemplateVars<T extends MailTemplateId>(
  id: T,
  vars: unknown,
): MailTemplateVars[T] {
  const def = TEMPLATES[id] as TemplateDef<T>;
  const parsed = def.schema.safeParse(vars);
  if (!parsed.success) throw new Error(`Invalid variables for mail template "${id}"`);
  return parsed.data;
}

export function renderMail<T extends MailTemplateId>(
  id: T,
  vars: MailTemplateVars[T],
  ctx: MailRenderContext,
): RenderedMail {
  const def = TEMPLATES[id] as TemplateDef<T>;
  const { subject, en, ar } = def.render(validateTemplateVars(id, vars), ctx);
  return {
    subject: singleLine(subject),
    text: `${textBlock(en)}\n\n----\n\n${textBlock(ar)}\n`,
    html: htmlDocument(subject, [htmlBlock(en, 'en', 'ltr'), htmlBlock(ar, 'ar', 'rtl')]),
  };
}

function textBlock(block: Block): string {
  const parts = [block.heading, '', ...block.lines.map(singleLine)];
  // The English line already carries the link; repeat it for the Arabic block
  // only, which points "above" in its copy, so the text part stays usable.
  if (block.action && !block.lines.some((l) => l.includes(block.action!.url))) {
    parts.push('', `${block.action.label}: ${block.action.url}`);
  }
  parts.push('', block.footer);
  return parts.join('\n');
}

function htmlBlock(block: Block, lang: 'en' | 'ar', dir: 'ltr' | 'rtl'): string {
  const align = dir === 'rtl' ? 'right' : 'left';
  const lines = block.lines
    .map((l) => `<p style="margin:0 0 12px">${escapeHtml(singleLine(l))}</p>`)
    .join('');
  const action = block.action
    ? `<p style="margin:16px 0"><a href="${escapeHtml(block.action.url)}" style="display:inline-block;padding:12px 20px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(block.action.label)}</a></p>`
    : '';
  return (
    `<div lang="${lang}" dir="${dir}" style="text-align:${align};font-family:Arial,Tahoma,sans-serif;font-size:16px;line-height:1.5;color:#111827">` +
    `<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(block.heading)}</h1>` +
    lines +
    action +
    `<p style="margin:16px 0 0;font-size:14px;color:#4b5563">${escapeHtml(block.footer)}</p>` +
    `</div>`
  );
}

function htmlDocument(subject: string, blocks: string[]): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(singleLine(subject))}</title></head>` +
    '<body style="margin:0;padding:24px;background:#ffffff">' +
    blocks.join('<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">') +
    '</body></html>'
  );
}
