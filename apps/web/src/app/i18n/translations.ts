export type Lang = 'en' | 'ar';

export const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  en: {
    // ── App ─────────────────────────────────────────────────────────────────
    appName: 'FixNow',
    appTagline: 'Home Services Marketplace',
    switchLang: 'ع',
    langCode: 'EN',

    // ── Auth – Login ────────────────────────────────────────────────────────
    welcomeBack: 'Welcome back 👋',
    signInContinue: 'Sign in to your account to continue',
    emailAddress: 'Email Address',
    password: 'Password',
    forgotPassword: 'Forgot Password?',
    login: 'Log In',
    demoLogin: 'Demo login',
    orContinueWith: 'or continue with',
    noAccount: "Don't have an account?",
    signUp: 'Sign Up',

    // ── Auth – Register ─────────────────────────────────────────────────────
    createAccount: 'Create Account',
    letsGetStarted: "Let's get started 🚀",
    fillDetails: 'Fill in your details to create an account',
    accountInfo: 'Account Info',
    verification: 'Verification',
    allSet: 'All Set!',
    fullName: 'Full Name',
    nameOnId: 'As it appears on your ID',
    phoneNumber: 'Phone Number',
    phoneHint: 'e.g. +966 5X XXX XXXX',
    minPassword: 'Min. 8 characters with a number',
    agreeTerms: 'I agree to the',
    termsConditions: 'Terms & Conditions',
    andWord: 'and',
    privacyPolicy: 'Privacy Policy',
    alreadyHaveAccount: 'Already have an account?',
    register: 'Create Account',

    // ── Auth – Forgot ────────────────────────────────────────────────────────
    resetPassword: 'Reset Password',
    forgotPasswordTitle: 'Forgot password?',
    forgotPasswordDesc:
      "No worries! Enter your registered email and we'll send you a secure reset link.",
    sendResetLink: 'Send Reset Link',
    checkInbox: 'Check your inbox!',
    sentResetTo: "We've sent a password reset link to",
    backToLogin: 'Back to Login',
    resendEmail: 'Resend email',
    resetExpiry:
      "The reset link expires in 15 minutes. Check your spam folder if you don't see it.",

    // ── Home – Header ────────────────────────────────────────────────────────
    greeting: 'Welcome back 👋',
    offline: 'Offline',

    // ── Home – Search ────────────────────────────────────────────────────────
    aiPowered: 'AI-Powered Search',
    whatDoYouNeed: 'What do you need?',
    searchDesc: "Describe your problem and we'll match you instantly",
    searchPlaceholder: 'e.g., My sink is leaking…',

    // ── Services ─────────────────────────────────────────────────────────────
    services: 'Services',
    viewAll: 'All',
    plumbing: 'Plumbing',
    acRepair: 'AC Repair',
    carpentry: 'Carpentry',
    cleaning: 'Cleaning',
    electrical: 'Electrical',
    painting: 'Painting',

    // ── Stats ─────────────────────────────────────────────────────────────────
    avgRating: 'Avg Rating',
    prosOnline: 'Pros Online',
    response: 'Response',

    // ── Leads ─────────────────────────────────────────────────────────────────
    activeLeads: 'Active Leads',
    pendingTip: 'Tap any Pending card to compare bids in real-time',
    postNewJob: 'Post\nNew Job',

    // ── How it works ─────────────────────────────────────────────────────────
    howItWorks: 'How FixNow Works',
    step1Title: 'Post a Job',
    step1Sub: 'Describe your problem',
    step2Title: 'Get Bids',
    step2Sub: 'Compare pro offers',
    step3Title: 'Book & Pay',
    step3Sub: 'Secure & easy checkout',

    // ── Nav ───────────────────────────────────────────────────────────────────
    home: 'Home',
    bookings: 'Bookings',
    chat: 'Chat',
    profile: 'Profile',

    // ── Bookings ─────────────────────────────────────────────────────────────
    myBookings: 'My Bookings',
    inProgress: 'In Progress',
    awaiting: 'Awaiting',
    done: 'Done',

    // ── Messages ──────────────────────────────────────────────────────────────
    messages: 'Messages',
    searchConversations: 'Search conversations…',

    // ── Profile ───────────────────────────────────────────────────────────────
    editProfile: 'Edit Profile',
    savedAddresses: 'Saved Addresses',
    notifications: 'Notifications',
    helpSupport: 'Help & Support',
    settings: 'Settings',
    totalJobs: 'Total Jobs',
    active: 'Active',
    spent: 'Spent',
    offlineMode: 'Offline Mode',
    online: 'Online',
    syncDesc: 'Changes sync when reconnected',
    connectedDesc: 'Connected & synced',

    // ── Wizard ────────────────────────────────────────────────────────────────
    postJob: 'Post Job',
    mediaAndBrief: 'Media & Brief',
    locationAndTime: 'Location & Time',
    confirm: 'Confirm',
    uploadPhotos: 'Upload Photos or Videos',
    tapToUpload: 'Tap to upload media',
    uploadTypes: 'JPG, PNG, MP4 · Max 50MB each',
    browseFiles: 'Browse Files',
    describeTheProblem: 'Describe the Problem',
    additionalNotes: 'Additional notes…',
    notesHint: "The more detail you provide, the better bids you'll get",
    next: 'Next',
    nextStep: 'Next Step · Location & Time',
    back: 'Back',
    serviceLocation: 'Service Location',
    address: 'Address',
    addressHint: 'Tap the map to adjust your location',
    whenDoYouNeed: 'When do you need it?',
    asap: 'ASAP',
    scheduleLater: 'Schedule Later',
    asapContext: 'Pros near you are available now. Average response time is under 1 hour.',
    confirmJob: 'Confirm Job · Post Now',
    jobPosted: 'Job Posted! 🎉',
    jobSummary: 'Job Summary',
    serviceLabel: 'Service',
    locationLabel: 'Location',
    scheduleLabel: 'Schedule',
    statusLabel: 'Status',
    asapFull: 'As Soon As Possible',
    postedAndLive: 'Posted & live',
    savedLocally: 'Saved locally (offline)',
    backToHome: 'Back to Home',
    viewMyJobs: 'View My Jobs',
    bidsEta: "You'll start receiving bids within 15–30 minutes",
    gpsDetected: 'GPS location detected',
    swipeUp: 'Swipe up to expand',
    swipeDown: 'Swipe down to collapse',

    // ── Bids ──────────────────────────────────────────────────────────────────
    bids: 'Bids',
    sortBy: 'Sort',
    bestMatch: 'Best Match',
    bestValue: 'Best Value',
    fastest: 'Fastest',
    acceptBid: 'Book',
    liveUpdates: 'Live Updates',
    newBidArrived: 'New bid just arrived!',
    priceComparison: 'Price Comparison',

    // ── Chat ──────────────────────────────────────────────────────────────────
    typeMessage: 'Type a message…',
    send: 'Send',
    today: 'Today',
    chatTitle: 'Chat',

    // ── Offline ───────────────────────────────────────────────────────────────
    offlineBanner: "You're offline. Changes will sync when reconnected.",
    retry: 'RETRY',

    // ── Misc ──────────────────────────────────────────────────────────────────
    postedAt: 'Posted',
    pro: 'Pro',
    cancel: 'Cancel',
    save: 'Save',
    date: 'Date',
    time: 'Time',
    pickDatePlaceholder: 'Select a date',
    pickTimePlaceholder: 'Select a time',
    useMyCurrentLocation: 'Use my current location',
    detectingLocation: 'Getting your location…',
    locationCaptured: 'Location captured',
    locationDenied: 'Permission denied. Use the address field instead.',
    locationUnsupported: "Your browser doesn't support location access.",
    locationFailed: "Couldn't get your location. Use the address field instead.",
    scheduleLaterRequiresDateTime: 'Please pick a date and time for your scheduled service.',
    scheduleInPast: 'Pick a date and time in the future.',
    requestPostFailedValidation: "We couldn't post that request. Check the form and try again.",
    requestPostFailedAuth: 'Your session has expired. Please log in again.',
    requestPostFailedGeneric: "We couldn't post this request. Please try again.",

    // ── Provider & Ecosystem ──────────────────────────────────────────────────
    liveJobs: 'Live Jobs',
    myBids: 'My Bids',
    wallet: 'Wallet',
    myProfile: 'My Profile',
    nearbyRequests: 'Nearby Requests',
    placeOffer: 'Place Offer',
    offerPrice: 'Your Price ($/hr)',
    execTime: 'Execution Time',
    noteToClient: 'Note to Client',
    submitOffer: 'Submit Offer',
    weeklyEarnings: 'Weekly Earnings',
    availableBalance: 'Available Balance',
    withdrawEarnings: 'Withdraw Earnings',
    transactionHistory: 'Transaction History',
  },

  ar: {
    // ── App ─────────────────────────────────────────────────────────────────
    appName: 'فيكس ناو',
    appTagline: 'سوق الخدمات المنزلية',
    switchLang: 'EN',
    langCode: 'AR',

    // ── Auth – Login ────────────────────────────────────────────────────────
    welcomeBack: 'مرحباً بعودتك 👋',
    signInContinue: 'سجّل دخولك للمتابعة',
    emailAddress: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    forgotPassword: 'نسيت كلمة المرور؟',
    login: 'دخول',
    demoLogin: 'بيانات تجريبية',
    orContinueWith: 'أو تابع بـ',
    noAccount: 'ليس لديك حساب؟',
    signUp: 'إنشاء حساب',

    // ── Auth – Register ─────────────────────────────────────────────────────
    createAccount: 'إنشاء حساب',
    letsGetStarted: 'لنبدأ معاً 🚀',
    fillDetails: 'أدخل بياناتك لإنشاء حساب جديد',
    accountInfo: 'معلومات الحساب',
    verification: 'التحقق',
    allSet: 'تم!',
    fullName: 'الاسم الكامل',
    nameOnId: 'كما هو في الهوية الوطنية',
    phoneNumber: 'رقم الجوال',
    phoneHint: 'مثال: +966 5X XXX XXXX',
    minPassword: '8 أحرف على الأقل مع رقم',
    agreeTerms: 'أوافق على',
    termsConditions: 'الشروط والأحكام',
    andWord: 'و',
    privacyPolicy: 'سياسة الخصوصية',
    alreadyHaveAccount: 'لديك حساب بالفعل؟',
    register: 'إنشاء الحساب',

    // ── Auth – Forgot ────────────────────────────────────────────────────────
    resetPassword: 'استعادة كلمة المرور',
    forgotPasswordTitle: 'نسيت كلمة المرور؟',
    forgotPasswordDesc: 'لا تقلق! أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين.',
    sendResetLink: 'إرسال رابط الاستعادة',
    checkInbox: 'تحقق من بريدك!',
    sentResetTo: 'أرسلنا رابط استعادة كلمة المرور إلى',
    backToLogin: 'العودة لتسجيل الدخول',
    resendEmail: 'إعادة الإرسال',
    resetExpiry: 'ينتهي الرابط خلال 15 دقيقة. تحقق من مجلد البريد غير المرغوب.',

    // ── Home – Header ────────────────────────────────────────────────────────
    greeting: 'مرحباً بك 👋',
    offline: 'غير متصل',

    // ── Home – Search ────────────────────────────────────────────────────────
    aiPowered: 'بحث بالذكاء الاصطناعي',
    whatDoYouNeed: 'ماذا تحتاج؟',
    searchDesc: 'صف مشكلتك وسنوصلك بالمحترف المناسب فوراً',
    searchPlaceholder: 'مثال: الحوض يسرب ماء…',

    // ── Services ─────────────────────────────────────────────────────────────
    services: 'الخدمات',
    viewAll: 'الكل',
    plumbing: 'سباكة',
    acRepair: 'تكييف',
    carpentry: 'نجارة',
    cleaning: 'تنظيف',
    electrical: 'كهرباء',
    painting: 'دهانات',

    // ── Stats ─────────────────────────────────────────────────────────────────
    avgRating: 'متوسط التقييم',
    prosOnline: 'محترف متاح',
    response: 'الاستجابة',

    // ── Leads ─────────────────────────────────────────────────────────────────
    activeLeads: 'الطلبات النشطة',
    pendingTip: 'اضغط على أي بطاقة «قيد الانتظار» لمقارنة العروض',
    postNewJob: 'نشر\nطلب جديد',

    // ── How it works ─────────────────────────────────────────────────────────
    howItWorks: 'كيف يعمل فيكس ناو',
    step1Title: 'انشر طلبك',
    step1Sub: 'صف المشكلة',
    step2Title: 'استلم العروض',
    step2Sub: 'قارن بين المحترفين',
    step3Title: 'احجز وادفع',
    step3Sub: 'دفع آمن وسهل',

    // ── Nav ───────────────────────────────────────────────────────────────────
    home: 'الرئيسية',
    bookings: 'حجوزاتي',
    chat: 'المحادثات',
    profile: 'ملفي',

    // ── Bookings ─────────────────────────────────────────────────────────────
    myBookings: 'حجوزاتي',
    inProgress: 'جارٍ التنفيذ',
    awaiting: 'قيد الانتظار',
    done: 'منتهي',

    // ─�� Messages ──────────────────────────────────────────────────────────────
    messages: 'الرسائل',
    searchConversations: 'ابحث في المحادثات…',

    // ── Profile ───────────────────────────────────────────────────────────────
    editProfile: 'تعديل الملف',
    savedAddresses: 'عناويني المحفوظة',
    notifications: 'الإشعارات',
    helpSupport: 'المساعدة والدعم',
    settings: 'الإعدادات',
    totalJobs: 'إجمالي الطلبات',
    active: 'نشط',
    spent: 'المدفوع',
    offlineMode: 'وضع عدم الاتصال',
    online: 'متصل',
    syncDesc: 'التغييرات تتزامن عند الاتصال',
    connectedDesc: 'متصل ومتزامن',

    // ── Wizard ────────────────────────────────────────────────────────────────
    postJob: 'نشر طلب',
    mediaAndBrief: 'الوسائط والوصف',
    locationAndTime: 'الموقع والوقت',
    confirm: 'تأكيد',
    uploadPhotos: 'رفع صور أو مقاطع فيديو',
    tapToUpload: 'اضغط لرفع الوسائط',
    uploadTypes: 'JPG, PNG, MP4 · الحد الأقصى 50 ميجابايت',
    browseFiles: 'استعراض الملفات',
    describeTheProblem: 'صف المشكلة',
    additionalNotes: 'ملاحظات إضافية…',
    notesHint: 'كلما زادت التفاصيل، حصلت على عروض أفضل',
    next: 'التالي',
    nextStep: 'الخطوة التالية · الموقع والوقت',
    back: 'رجوع',
    serviceLocation: 'موقع الخدمة',
    address: 'العنوان',
    addressHint: 'اضغط على الخريطة لتعديل موقعك',
    whenDoYouNeed: 'متى تحتاج إليه؟',
    asap: 'فوراً',
    scheduleLater: 'جدولة لاحقاً',
    asapContext: 'المحترفون القريبون منك متاحون الآن. متوسط وقت الاستجابة أقل من ساعة.',
    confirmJob: 'تأكيد الطلب · نشر الآن',
    jobPosted: 'تم نشر الطلب! 🎉',
    jobSummary: 'ملخص الطلب',
    serviceLabel: 'الخدمة',
    locationLabel: 'الموقع',
    scheduleLabel: 'الجدولة',
    statusLabel: 'الحالة',
    asapFull: 'في أقرب وقت ممكن',
    postedAndLive: 'منشور ومباشر',
    savedLocally: 'محفوظ محلياً (غير متصل)',
    backToHome: 'العودة للرئيسية',
    viewMyJobs: 'عرض طلباتي',
    bidsEta: 'ستبدأ في استلام العروض خلال 15–30 دقيقة',
    gpsDetected: 'تم تحديد موقعك',
    swipeUp: 'اسحب لأعلى للتوسيع',
    swipeDown: 'اسحب لأسفل للطي',

    // ── Bids ──────────────────────────────────────────────────────────────────
    bids: 'العروض',
    sortBy: 'ترتيب',
    bestMatch: 'الأنسب',
    bestValue: 'الأوفر',
    fastest: 'الأسرع',
    acceptBid: 'احجز',
    liveUpdates: 'تحديثات مباشرة',
    newBidArrived: 'وصل عرض جديد!',
    priceComparison: 'مقارنة الأسعار',

    // ── Chat ──────────────────────────────────────────────────────────────────
    typeMessage: 'اكتب رسالة…',
    send: 'إرسال',
    today: 'اليوم',
    chatTitle: 'المحادثة',

    // ── Offline ───────────────────────────────────────────────────────────────
    offlineBanner: 'أنت غير متصل. ستتزامن التغييرات عند الاتصال.',
    retry: 'إعادة المحاولة',

    // ── Misc ──────────────────────────────────────────────────────────────────
    postedAt: 'نُشر',
    pro: 'المحترف',
    cancel: 'إلغاء',
    save: 'حفظ',
    date: 'التاريخ',
    time: 'الوقت',
    pickDatePlaceholder: 'اختر التاريخ',
    pickTimePlaceholder: 'اختر الوقت',
    useMyCurrentLocation: 'استخدام موقعي الحالي',
    detectingLocation: 'جاري تحديد موقعك…',
    locationCaptured: 'تم تحديد الموقع',
    locationDenied: 'تم رفض الإذن. استخدم حقل العنوان بدلاً من ذلك.',
    locationUnsupported: 'متصفحك لا يدعم تحديد الموقع.',
    locationFailed: 'تعذر تحديد موقعك. استخدم حقل العنوان بدلاً من ذلك.',
    scheduleLaterRequiresDateTime: 'الرجاء اختيار تاريخ ووقت للخدمة المجدولة.',
    scheduleInPast: 'اختر تاريخاً ووقتاً في المستقبل.',
    requestPostFailedValidation: 'تعذر نشر هذا الطلب. تحقق من البيانات وحاول مرة أخرى.',
    requestPostFailedAuth: 'انتهت الجلسة. حاول تسجيل الدخول مرة أخرى.',
    requestPostFailedGeneric: 'تعذر نشر هذا الطلب. حاول مرة أخرى.',
  },
};
