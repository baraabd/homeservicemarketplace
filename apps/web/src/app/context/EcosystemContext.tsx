import { createContext, useContext, useState, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface Bid {
  id: string;
  requestId: string;
  providerName: string;
  providerAr: string;
  providerRating: number;
  providerJobs: number;
  price: number;
  executionTime: string;
  note: string;
  status: 'pending' | 'accepted' | 'rejected';
  submittedAt: string;
}

export interface ServiceRequest {
  id: string;
  service: string;
  serviceAr: string;
  serviceIcon: string;
  description: string;
  descriptionAr: string;
  budget: string;
  location: string;
  locationAr: string;
  seekerName: string;
  seekerRating: number;
  distance: number;
  urgency: 'normal' | 'urgent';
  postedAt: string;
  status: 'pending' | 'bidding' | 'assigned' | 'active' | 'completed';
  bids: Bid[];
  // Real geographic coordinates threaded from the
  // ProviderAvailableRequestSummary.location wire shape. Either may be
  // null when the seeker's address has no captured lat/lng (legacy
  // rows or coarse-city-only addresses) — the map deliberately skips
  // those pins rather than synthesising fake locations.
  lat: number | null;
  lng: number | null;
}

export interface CrossAppNotif {
  id: string;
  app: 'seeker' | 'provider' | 'admin';
  type: 'new_request' | 'new_bid' | 'bid_accepted' | 'job_complete' | 'new_pro';
  msg: string;
  msgAr: string;
  time: string;
  read: boolean;
}

interface EcosystemCtx {
  requests: ServiceRequest[];
  adminNotifs: CrossAppNotif[];
  postRequest: (r: Omit<ServiceRequest, 'id' | 'bids' | 'status' | 'postedAt'>) => string;
  submitBid: (
    requestId: string,
    bid: Omit<Bid, 'id' | 'requestId' | 'status' | 'submittedAt'>,
  ) => void;
  acceptBid: (requestId: string, bidId: string) => void;
  completeJob: (requestId: string) => void;
  markAdminRead: (id: string) => void;
  totalRevenue: number;
  activeUsers: number;
  pendingVerifs: number;
  activeDisputes: number;
  // ── Pricing visibility setting (admin-controlled) ──
  showHourlyRate: boolean;
  setShowHourlyRate: (v: boolean) => void;
}

// ─── Seed data ─────────────────────────────────────────────────────────────────
const SEED_REQUESTS: ServiceRequest[] = [
  {
    id: 'r1',
    service: 'Plumbing',
    serviceAr: 'سباكة',
    serviceIcon: '🔧',
    description: 'Pipe leak under kitchen sink, needs urgent fix',
    descriptionAr: 'تسرب في أنبوب مجلى المطبخ، يحتاج إصلاحاً عاجلاً',
    budget: '$30–50/hr',
    location: 'Al Olaya District',
    locationAr: 'حي العليا',
    seekerName: 'Ahmed K.',
    seekerRating: 4.8,
    distance: 1.2,
    urgency: 'urgent',
    postedAt: '2m ago',
    status: 'bidding',
    bids: [
      {
        id: 'b1',
        requestId: 'r1',
        providerName: 'Khalid A.',
        providerAr: 'خالد أ.',
        providerRating: 4.9,
        providerJobs: 312,
        price: 35,
        executionTime: '1–2h',
        note: 'I can be there in 20 minutes',
        status: 'pending',
        submittedAt: '1m ago',
      },
      {
        id: 'b2',
        requestId: 'r1',
        providerName: 'Saad M.',
        providerAr: 'سعد م.',
        providerRating: 4.7,
        providerJobs: 187,
        price: 40,
        executionTime: '1h',
        note: 'Experienced plumber, free today',
        status: 'pending',
        submittedAt: '30s ago',
      },
    ],
    lat: 24.6904,
    lng: 46.6863,
  },
  {
    id: 'r2',
    service: 'Electrical',
    serviceAr: 'كهرباء',
    serviceIcon: '⚡',
    description: 'Faulty socket in living room, sparks when plugging in',
    descriptionAr: 'مقبس معطوب في غرفة الجلوس، شرارات عند التوصيل',
    budget: '$25–45/hr',
    location: 'Al Malqa',
    locationAr: 'الملقا',
    seekerName: 'Sara R.',
    seekerRating: 4.5,
    distance: 2.8,
    urgency: 'urgent',
    postedAt: '8m ago',
    status: 'pending',
    bids: [],
    lat: 24.8112,
    lng: 46.6298,
  },
  {
    id: 'r3',
    service: 'AC Repair',
    serviceAr: 'صيانة تكييف',
    serviceIcon: '❄️',
    description: 'AC unit not cooling, making loud noise',
    descriptionAr: 'وحدة التكييف لا تبرد وتصدر ضوضاء',
    budget: '$40–70/hr',
    location: 'King Fahd Road',
    locationAr: 'طريق الملك فهد',
    seekerName: 'Nora S.',
    seekerRating: 4.9,
    distance: 4.1,
    urgency: 'normal',
    postedAt: '15m ago',
    status: 'pending',
    bids: [],
    lat: 24.7268,
    lng: 46.6924,
  },
  {
    id: 'r4',
    service: 'Cleaning',
    serviceAr: 'تنظيف',
    serviceIcon: '✨',
    description: 'Deep cleaning for 3-bedroom apartment',
    descriptionAr: 'تنظيف عميق لشقة من 3 غرف نوم',
    budget: '$80 flat',
    location: 'Diplomatic Quarter',
    locationAr: 'الحي الدبلوماسي',
    seekerName: 'Omar H.',
    seekerRating: 4.7,
    distance: 3.5,
    urgency: 'normal',
    postedAt: '22m ago',
    status: 'assigned',
    bids: [
      {
        id: 'b3',
        requestId: 'r4',
        providerName: 'Fatima Z.',
        providerAr: 'فاطمة ز.',
        providerRating: 5.0,
        providerJobs: 520,
        price: 80,
        executionTime: '4–5h',
        note: 'Full team available today',
        status: 'accepted',
        submittedAt: '18m ago',
      },
    ],
    lat: 24.6553,
    lng: 46.6217,
  },
  {
    id: 'r5',
    service: 'Carpentry',
    serviceAr: 'نجارة',
    serviceIcon: '🔨',
    description: 'Install 2 wall shelves in bedroom',
    descriptionAr: 'تركيب رفين للجدار في غرفة النوم',
    budget: '$20–30/hr',
    location: 'Al Nakheel',
    locationAr: 'النخيل',
    seekerName: 'Laila F.',
    seekerRating: 4.6,
    distance: 5.7,
    urgency: 'normal',
    postedAt: '35m ago',
    status: 'pending',
    bids: [],
    lat: 24.7741,
    lng: 46.7382,
  },
];

const SEED_NOTIFS: CrossAppNotif[] = [
  {
    id: 'an1',
    app: 'admin',
    type: 'new_request',
    msg: 'New plumbing request in Al Olaya',
    msgAr: 'طلب سباكة جديد في حي العليا',
    time: '2m ago',
    read: false,
  },
  {
    id: 'an2',
    app: 'admin',
    type: 'new_bid',
    msg: 'Bid submitted on request #r1',
    msgAr: 'تم تقديم عرض على الطلب #r1',
    time: '1m ago',
    read: false,
  },
  {
    id: 'an3',
    app: 'admin',
    type: 'new_pro',
    msg: 'New professional applied: Yasser A.',
    msgAr: 'محترف جديد: ياسر أ.',
    time: '5m ago',
    read: false,
  },
  {
    id: 'an4',
    app: 'admin',
    type: 'new_request',
    msg: 'Urgent electrical request in Malqa',
    msgAr: 'طلب كهرباء عاجل في الملقا',
    time: '8m ago',
    read: true,
  },
  {
    id: 'an5',
    app: 'admin',
    type: 'bid_accepted',
    msg: 'Sara R. accepted bid from Fatima Z.',
    msgAr: 'قبلت سارة عرض فاطمة.',
    time: '18m ago',
    read: true,
  },
];

// ─── New Pro Verifications ─────────────────────────────────────────────────────
export const PRO_VERIFICATIONS = [
  {
    id: 'pv1',
    name: 'Yasser Al-Ahmad',
    nameAr: 'ياسر الأحمد',
    service: 'Plumbing',
    serviceAr: 'سباكة',
    rating: 0,
    jobs: 0,
    appliedAt: 'Today, 9:15 AM',
    status: 'pending',
    city: 'Riyadh',
    idVerified: false,
    bgCheck: false,
  },
  {
    id: 'pv2',
    name: 'Hamza Al-Rashidi',
    nameAr: 'حمزة الراشدي',
    service: 'Electrical',
    serviceAr: 'كهرباء',
    rating: 4.6,
    jobs: 89,
    appliedAt: 'Today, 8:02 AM',
    status: 'pending',
    city: 'Jeddah',
    idVerified: true,
    bgCheck: true,
  },
  {
    id: 'pv3',
    name: 'Noura Al-Ghamdi',
    nameAr: 'نورة الغامدي',
    service: 'Cleaning',
    serviceAr: 'تنظيف',
    rating: 4.9,
    jobs: 201,
    appliedAt: 'Yesterday',
    status: 'approved',
    city: 'Riyadh',
    idVerified: true,
    bgCheck: true,
  },
  {
    id: 'pv4',
    name: 'Tariq Al-Harbi',
    nameAr: 'طارق الحربي',
    service: 'AC Repair',
    serviceAr: 'تكييف',
    rating: 0,
    jobs: 0,
    appliedAt: 'Yesterday',
    status: 'rejected',
    city: 'Dammam',
    idVerified: true,
    bgCheck: false,
  },
  {
    id: 'pv5',
    name: 'Reem Al-Shammari',
    nameAr: 'ريم الشمري',
    service: 'Carpentry',
    serviceAr: 'نجارة',
    rating: 0,
    jobs: 0,
    appliedAt: '2 days ago',
    status: 'pending',
    city: 'Riyadh',
    idVerified: true,
    bgCheck: true,
  },
];

// ─── Transactions ──────────────────────────────────────────────────────────────
export const WALLET_TRANSACTIONS = [
  {
    id: 't1',
    type: 'earning',
    desc: 'AC Repair – Nora S.',
    descAr: 'صيانة تكييف – نورة',
    amount: +68,
    date: 'Today',
    status: 'done',
  },
  {
    id: 't2',
    type: 'earning',
    desc: 'Plumbing – Ahmed K.',
    descAr: 'سباكة – أحمد خ.',
    amount: +35,
    date: 'Yesterday',
    status: 'done',
  },
  {
    id: 't3',
    type: 'payout',
    desc: 'Bank Withdrawal',
    descAr: 'سحب للبنك',
    amount: -200,
    date: 'Dec 10',
    status: 'done',
  },
  {
    id: 't4',
    type: 'earning',
    desc: 'Cleaning – Omar H.',
    descAr: 'تنظيف – عمر ح.',
    amount: +80,
    date: 'Dec 9',
    status: 'done',
  },
  {
    id: 't5',
    type: 'pending',
    desc: 'Carpentry – Laila F.',
    descAr: 'نجارة – ليلى ف.',
    amount: +45,
    date: 'Dec 8',
    status: 'pending',
  },
  {
    id: 't6',
    type: 'earning',
    desc: 'Electrical – Sara R.',
    descAr: 'كهرباء – سارة ر.',
    amount: +55,
    date: 'Dec 8',
    status: 'done',
  },
];

export const EARNINGS_CHART_DATA = [
  { day: 'Mon', earn: 120 },
  { day: 'Tue', earn: 85 },
  { day: 'Wed', earn: 200 },
  { day: 'Thu', earn: 145 },
  { day: 'Fri', earn: 220 },
  { day: 'Sat', earn: 310 },
  { day: 'Sun', earn: 180 },
];

// ─── Context ───────────────────────────────────────────────────────────────────
const EcosystemContext = createContext<EcosystemCtx>({
  requests: [],
  adminNotifs: [],
  postRequest: () => '',
  submitBid: () => {},
  acceptBid: () => {},
  completeJob: () => {},
  markAdminRead: () => {},
  totalRevenue: 0,
  activeUsers: 0,
  pendingVerifs: 0,
  activeDisputes: 0,
  showHourlyRate: true,
  setShowHourlyRate: () => {},
});

export function EcosystemProvider({ children }: { children: React.ReactNode }) {
  const [requests, setRequests] = useState<ServiceRequest[]>(SEED_REQUESTS);
  const [adminNotifs, setAdminNotifs] = useState<CrossAppNotif[]>(SEED_NOTIFS);
  const [showHourlyRate, setShowHourlyRate] = useState(true);

  const postRequest = useCallback(
    (r: Omit<ServiceRequest, 'id' | 'bids' | 'status' | 'postedAt'>) => {
      const id = `r${Date.now()}`;
      const newReq: ServiceRequest = {
        ...r,
        id,
        bids: [],
        status: 'pending',
        postedAt: 'just now',
      };
      setRequests((prev) => [newReq, ...prev]);
      setAdminNotifs((prev) => [
        {
          id: `an${Date.now()}`,
          app: 'admin',
          type: 'new_request',
          msg: `New ${r.service} request in ${r.location}`,
          msgAr: `طلب ${r.serviceAr} جديد في ${r.locationAr}`,
          time: 'just now',
          read: false,
        },
        ...prev,
      ]);
      return id;
    },
    [],
  );

  const submitBid = useCallback(
    (requestId: string, bid: Omit<Bid, 'id' | 'requestId' | 'status' | 'submittedAt'>) => {
      const newBid: Bid = {
        ...bid,
        id: `b${Date.now()}`,
        requestId,
        status: 'pending',
        submittedAt: 'just now',
      };
      setRequests((prev) =>
        prev.map((r) =>
          r.id === requestId ? { ...r, status: 'bidding' as const, bids: [...r.bids, newBid] } : r,
        ),
      );
      setAdminNotifs((prev) => [
        {
          id: `an${Date.now()}`,
          app: 'admin',
          type: 'new_bid',
          msg: `New bid on request #${requestId} by ${bid.providerName}`,
          msgAr: `عرض جديد على الطلب من ${bid.providerAr}`,
          time: 'just now',
          read: false,
        },
        ...prev,
      ]);
    },
    [],
  );

  const acceptBid = useCallback((requestId: string, bidId: string) => {
    setRequests((prev) =>
      prev.map((r) =>
        r.id === requestId
          ? {
              ...r,
              status: 'assigned' as const,
              bids: r.bids.map((b) => ({
                ...b,
                status: b.id === bidId ? ('accepted' as const) : ('rejected' as const),
              })),
            }
          : r,
      ),
    );
  }, []);

  const completeJob = useCallback((requestId: string) => {
    setRequests((prev) =>
      prev.map((r) => (r.id === requestId ? { ...r, status: 'completed' as const } : r)),
    );
  }, []);

  const markAdminRead = useCallback((id: string) => {
    setAdminNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  return (
    <EcosystemContext.Provider
      value={{
        requests,
        adminNotifs,
        postRequest,
        submitBid,
        acceptBid,
        completeJob,
        markAdminRead,
        totalRevenue: 14820,
        activeUsers: 3241,
        pendingVerifs: 7,
        activeDisputes: 3,
        showHourlyRate,
        setShowHourlyRate,
      }}
    >
      {children}
    </EcosystemContext.Provider>
  );
}

export function useEcosystem() {
  return useContext(EcosystemContext);
}
