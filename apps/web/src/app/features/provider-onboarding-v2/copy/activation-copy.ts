// Sprint 09B.29 — prototype screens 0 (activation) and 1 (role synchronization).
//
// Reference: docs/provider-experience-v2/reference/provider-onboarding-prototype.html,
// `hsmRenderScreen('activate')` and `hsmRenderScreen('sync')`.
//
// The strings marked "prototype" below are TRANSCRIBED, not written. Where a
// state exists in the implementation but not in the reference — a failed
// rotation, a rotation that produced no role, a failed upgrade — the copy is
// new, and each one is written to the same rule the prototype's own sync copy
// establishes: say what happened, say whose move it is, and never suggest
// signing in for a problem signing in cannot fix.
//
// Key parity across `en` and `ar` is asserted by copy-parity.test.ts.

export type Lang = 'en' | 'ar';

export interface ActivationCopy {
  // ── Screen 0: activation ────────────────────────────────────────────────
  /** Topbar title. */
  activateTitle: string;
  /** Hero heading. */
  activateHeading: string;
  /** Hero lead. */
  activateLead: string;
  /** "What you need" panel. */
  needTitle: string;
  needBody: string;
  /** The single primary action. */
  activateCta: string;
  /** Shown on the button while the upgrade request is open. */
  activatePending: string;

  // ── Screen 1: role/session synchronization ──────────────────────────────
  syncTitle: string;
  syncSubtitle: string;
  syncHeading: string;
  syncLead: string;
  /** The reassurance alert. This is the sentence that stops a provider
   *  reaching for the sign-in button. */
  syncNoticeTitle: string;
  syncNoticeBody: string;
  /** Announced to assistive technology while the rotation is open. */
  syncLiveStatus: string;
  /** Offered once the session is usable. */
  syncContinueCta: string;

  // ── Recovery states (not drawn by the prototype) ────────────────────────
  /** The rotation call itself failed. Retrying is reasonable. */
  syncFailedTitle: string;
  syncFailedBody: string;
  syncRetryCta: string;
  /** The rotation succeeded and the session still has no provider role. This
   *  is a considered answer from the server, so no retry is offered. */
  syncRefusedTitle: string;
  syncRefusedBody: string;
  /** The upgrade request itself failed. */
  upgradeFailedTitle: string;
  upgradeFailedBody: string;
  upgradeRetryCta: string;
  /** Support route for the states a retry cannot clear. */
  contactSupportCta: string;
}

const EN: ActivationCopy = {
  // prototype
  activateTitle: 'Start as a provider',
  activateHeading: 'Turn your skills into work',
  activateLead:
    'Complete six short tasks, then submit your application. Workspace navigation stays hidden until activation.',
  needTitle: 'What you need',
  needBody:
    'Phone number, profile photo, services, work area, availability and a short introduction.',
  activateCta: 'Activate provider account',
  activatePending: 'Activating…',

  // prototype
  syncTitle: 'Account activation',
  syncSubtitle: 'Syncing your permissions',
  syncHeading: 'Preparing your provider account',
  syncLead:
    'Your profile was created. We are refreshing the session before opening the application to prevent a permission error.',
  syncNoticeTitle: 'No sign-in needed',
  syncNoticeBody:
    'This is role synchronization, not an expired session. We will retry once automatically.',
  syncLiveStatus: 'Syncing your permissions. This usually takes a moment.',
  syncContinueCta: 'Continue after sync',

  // new
  syncFailedTitle: 'We could not finish syncing your permissions',
  // Deliberately states that the account IS upgraded. The provider's worry at
  // this point is whether they have to start again; they do not.
  syncFailedBody:
    'Your provider account was created successfully — only the session refresh failed, so the application cannot open yet. Try again; nothing you have done is lost.',
  syncRetryCta: 'Try again',
  syncRefusedTitle: 'This account does not have provider access yet',
  // No retry: the server answered, and asking again returns the same answer.
  syncRefusedBody:
    'We refreshed your session and it still does not include provider access. This is not a sign-in problem, and trying again will not change it. Contact support and mention provider activation.',
  upgradeFailedTitle: 'We could not activate your provider account',
  upgradeFailedBody:
    'Something went wrong on our side and nothing was changed on your account. You can try again.',
  upgradeRetryCta: 'Try again',
  contactSupportCta: 'Contact support',
};

const AR: ActivationCopy = {
  activateTitle: 'ابدأ كمهني',
  activateHeading: 'حوّل خبرتك إلى فرص عمل',
  activateLead: 'أكمل ست مهام قصيرة، ثم أرسل طلبك للمراجعة. لن يظهر تنقل مساحة العمل قبل التفعيل.',
  needTitle: 'ما الذي تحتاجه؟',
  needBody: 'رقم هاتف، صورة شخصية، خدماتك، منطقة العمل، أوقاتك ونبذة عنك.',
  activateCta: 'تفعيل حساب المهني',
  activatePending: 'جارٍ التفعيل…',

  syncTitle: 'تفعيل الحساب',
  syncSubtitle: 'تتم مزامنة صلاحياتك',
  syncHeading: 'نجهّز حسابك المهني',
  syncLead: 'تم إنشاء الملف. نحدّث الجلسة الآن قبل فتح طلبك حتى لا تواجه خطأ صلاحيات.',
  syncNoticeTitle: 'لا تسجّل الدخول من جديد',
  syncNoticeBody: 'هذه مزامنة دور وليست جلسة منتهية. سنعيد المحاولة مرة واحدة تلقائياً.',
  syncLiveStatus: 'تتم مزامنة صلاحياتك. عادةً ما يستغرق ذلك لحظات.',
  syncContinueCta: 'متابعة بعد المزامنة',

  syncFailedTitle: 'تعذّر إكمال مزامنة صلاحياتك',
  syncFailedBody:
    'تم إنشاء حسابك المهني بنجاح — لكن تحديث الجلسة فشل، لذلك لا يمكن فتح الطلب بعد. حاول مرة أخرى؛ لم تفقد أي شيء.',
  syncRetryCta: 'حاول مرة أخرى',
  syncRefusedTitle: 'هذا الحساب لا يملك صلاحية المهني بعد',
  syncRefusedBody:
    'حدّثنا جلستك ولا تزال لا تتضمن صلاحية المهني. هذه ليست مشكلة تسجيل دخول، وإعادة المحاولة لن تغيّرها. تواصل مع الدعم واذكر تفعيل حساب المهني.',
  upgradeFailedTitle: 'تعذّر تفعيل حسابك المهني',
  upgradeFailedBody: 'حدث خطأ لدينا ولم يتغيّر أي شيء في حسابك. يمكنك المحاولة مرة أخرى.',
  upgradeRetryCta: 'حاول مرة أخرى',
  contactSupportCta: 'تواصل مع الدعم',
};

export const ACTIVATION_COPY: Record<Lang, ActivationCopy> = { en: EN, ar: AR };
