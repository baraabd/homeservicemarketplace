// K02 — signup consent: copy, the non-secret draft, and the server's legal
// refusal reasons.

export const SIGNUP_CONSENT_COPY = {
  en: {
    statement: 'I have read and agree to the Terms of Service and the Privacy Notice.',
    readTerms: 'Read the Terms of Service',
    readPrivacy: 'Read the Privacy Notice',
    loading: 'Loading the current terms…',
    loadFailed: 'The current terms could not be loaded, so sign-up cannot continue.',
    retry: 'Try again',
    closed: 'Sign-up opens once the terms and privacy notice are approved.',
    stale:
      'The terms or privacy notice changed while you were signing up. Please read the current version and tick the box again.',
    showPassword: 'Show password',
  },
  ar: {
    statement: 'قرأت شروط الخدمة وإشعار الخصوصية وأوافق عليهما.',
    readTerms: 'قراءة شروط الخدمة',
    readPrivacy: 'قراءة إشعار الخصوصية',
    loading: 'جارٍ تحميل الشروط الحالية…',
    loadFailed: 'تعذّر تحميل الشروط الحالية، لذا لا يمكن متابعة التسجيل.',
    retry: 'إعادة المحاولة',
    closed: 'يُفتح التسجيل بعد اعتماد الشروط وإشعار الخصوصية.',
    stale:
      'تغيّرت الشروط أو إشعار الخصوصية أثناء تسجيلك. اقرأ الإصدار الحالي ثم حدّد المربع مجدداً.',
    showPassword: 'إظهار كلمة المرور',
  },
} as const;

// ─── Non-secret draft ────────────────────────────────────────────────────
//
// Name and email only, in sessionStorage (this tab, cleared when it closes).
// The password is NEVER persisted: it stays in component memory, which the
// in-place policy dialog preserves. Consent is never restored either — the
// person ticks it for the version they see now.

const DRAFT_KEY = 'hsm.signup.draft.v1';

export interface SignupDraft {
  step: 1 | 2;
  name: string;
  email: string;
}

export function readSignupDraft(): SignupDraft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SignupDraft>;
    if (typeof value.name !== 'string' || typeof value.email !== 'string') return null;
    return {
      step: value.step === 2 ? 2 : 1,
      name: value.name.slice(0, 160),
      email: value.email.slice(0, 254),
    };
  } catch {
    return null;
  }
}

export function writeSignupDraft(draft: { step: number; name: string; email: string }): void {
  try {
    if (!draft.name && !draft.email) {
      window.sessionStorage.removeItem(DRAFT_KEY);
      return;
    }
    const value: SignupDraft = {
      step: draft.step === 2 ? 2 : 1,
      name: draft.name,
      email: draft.email,
    };
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota): the draft is a convenience.
  }
}

export function clearSignupDraft(): void {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

/** The server's 409 legal refusal reason, if this error is one. */
export function legalRefusalReason(
  err: unknown,
): 'LEGAL_VERSION_STALE' | 'LEGAL_ACCEPTANCE_CLOSED' | null {
  const response = (err as { response?: { status?: number; data?: unknown } } | null)?.response;
  if (response?.status !== 409) return null;
  const data = response.data as
    | { error?: { details?: { reason?: unknown } }; details?: { reason?: unknown } }
    | undefined;
  const reason = data?.error?.details?.reason ?? data?.details?.reason;
  return reason === 'LEGAL_VERSION_STALE' || reason === 'LEGAL_ACCEPTANCE_CLOSED' ? reason : null;
}
