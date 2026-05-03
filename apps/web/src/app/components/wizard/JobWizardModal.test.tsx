import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { JobWizardModal } from './JobWizardModal';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 4 Slice 4.1 — Job Wizard Location + Date/Time runtime fix.
//
// Coverage:
//   • ASAP flow sends scheduleType=ASAP and scheduledAt=null
//   • LATER requires both date + time (inline error otherwise)
//   • LATER sends a real ISO scheduledAt computed from the user's pick
//   • Past date/time blocked client-side with a friendly inline error
//   • Saved default address is forwarded by id (not duplicated as
//     manualAddress)
//   • Edited address is forwarded as manualAddress with line1/city/country
//   • navigator.geolocation success attaches lat/lng to manualAddress
//   • navigator.geolocation denied surfaces a safe inline error and the
//     post still succeeds (without lat/lng)
//   • Step-3 success appears only after the backend returns 200
//   • Backend 400 surfaces friendly copy; raw payload never reaches DOM
//   • Legacy hardcoded "Mar 15, 2026" / "10:00 AM" strings never appear
// ─────────────────────────────────────────────────────────────────────────────

function renderWizard(opts?: { categoryId?: string | null; isOffline?: boolean }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <JobWizardModal
          service="Plumbing"
          categoryId={opts?.categoryId ?? null}
          isOpen
          onClose={() => {}}
          isOffline={opts?.isOffline ?? false}
        />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

const DEFAULT_ADDRESS = {
  id: 'addr-default-1',
  label: 'Home',
  line1: '123 King Fahd Rd',
  line2: null,
  city: 'Riyadh',
  region: null,
  postalCode: null,
  country: 'Saudi Arabia',
  isDefault: true,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
};

const COMPOSED_DEFAULT = '123 King Fahd Rd, Riyadh, Saudi Arabia';

let mock: MockAdapter;
let originalGeolocation: Geolocation | undefined;

beforeEach(() => {
  mock = new MockAdapter(api);
  // Capture the env's pre-test geolocation so each test can install its
  // own mock and we restore cleanly afterwards. jsdom ships with no
  // geolocation by default, hence the optional type.
  originalGeolocation = (navigator as Navigator & { geolocation?: Geolocation }).geolocation;
});

afterEach(() => {
  mock.restore();
  if (originalGeolocation === undefined) {
    Object.defineProperty(navigator, 'geolocation', {
      value: undefined,
      configurable: true,
    });
  } else {
    Object.defineProperty(navigator, 'geolocation', {
      value: originalGeolocation,
      configurable: true,
    });
  }
});

// Click "Next Step" on step 1 to land on step 2 (where location/time
// inputs live).
async function advanceToStep2() {
  fireEvent.click(await screen.findByRole('button', { name: /next step/i }));
  await screen.findByRole('button', { name: /confirm job/i });
}

// Wait for the saved default address to populate the address field.
// Must be called AFTER advancing to step 2 because the field only
// renders there.
async function awaitDefaultAddressFilled() {
  await waitFor(() => expect(screen.getByDisplayValue(COMPOSED_DEFAULT)).toBeInTheDocument());
}

// ── ASAP path ────────────────────────────────────────────────────────────────

describe('JobWizardModal — ASAP', () => {
  it('sends scheduleType=ASAP and scheduledAt=null with the saved address id', async () => {
    mock.onGet('/v1/me/addresses').reply(200, { items: [DEFAULT_ADDRESS] });
    let postedBody: Record<string, unknown> = {};
    mock.onPost('/v1/me/requests').reply((config) => {
      postedBody = JSON.parse(config.data as string) as Record<string, unknown>;
      return [200, { id: 'req-new-1', status: 'PENDING' }];
    });

    renderWizard();
    await advanceToStep2();
    await awaitDefaultAddressFilled();

    fireEvent.click(screen.getByRole('button', { name: /confirm job/i }));

    await waitFor(() => expect(postedBody.scheduleType).toBe('ASAP'));
    expect(postedBody.scheduledAt).toBeNull();
    expect(postedBody.addressId).toBe('addr-default-1');
    expect(postedBody.manualAddress).toBeNull();
  });
});

// ── LATER path ───────────────────────────────────────────────────────────────

describe('JobWizardModal — LATER', () => {
  it('refuses to post when LATER is selected without date+time', async () => {
    mock.onGet('/v1/me/addresses').reply(200, { items: [DEFAULT_ADDRESS] });
    let postCount = 0;
    mock.onPost('/v1/me/requests').reply(() => {
      postCount += 1;
      return [200, { id: 'req-new-2', status: 'PENDING' }];
    });

    renderWizard();
    await advanceToStep2();
    await awaitDefaultAddressFilled();

    fireEvent.click(screen.getByRole('button', { name: /schedule later/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm job/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/pick a date and time for your scheduled service/i),
      ).toBeInTheDocument(),
    );
    expect(postCount).toBe(0);
  });

  it('sends a valid ISO scheduledAt when the user picks a future date+time', async () => {
    mock.onGet('/v1/me/addresses').reply(200, { items: [DEFAULT_ADDRESS] });
    let postedBody: Record<string, unknown> = {};
    mock.onPost('/v1/me/requests').reply((config) => {
      postedBody = JSON.parse(config.data as string) as Record<string, unknown>;
      return [200, { id: 'req-new-3', status: 'PENDING' }];
    });

    renderWizard();
    await advanceToStep2();
    await awaitDefaultAddressFilled();

    fireEvent.click(screen.getByRole('button', { name: /schedule later/i }));

    // Pick a date one year from today + a fixed time.
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const yyyy = future.getFullYear();
    const mm = String(future.getMonth() + 1).padStart(2, '0');
    const dd = String(future.getDate()).padStart(2, '0');
    const futureDate = `${yyyy}-${mm}-${dd}`;

    const dateInput = screen.getByLabelText(/^date$/i) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: futureDate } });
    // Phase 4 — segmented time picker. Pick "Afternoon" segment, then
    // tap the 14:30 pill. The picker emits the same HH:MM string the
    // legacy <input type="time"> did.
    fireEvent.click(screen.getByTestId('time-segment-afternoon'));
    fireEvent.click(screen.getByTestId('time-slot-14:30'));

    fireEvent.click(screen.getByRole('button', { name: /confirm job/i }));

    await waitFor(() => expect(postedBody.scheduleType).toBe('LATER'));
    expect(typeof postedBody.scheduledAt).toBe('string');
    const parsed = new Date(postedBody.scheduledAt as string);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.getFullYear()).toBe(future.getFullYear());
    expect(parsed.getMonth()).toBe(future.getMonth());
    expect(parsed.getDate()).toBe(future.getDate());
  });

  it('blocks past date/time client-side without round-tripping to the backend', async () => {
    mock.onGet('/v1/me/addresses').reply(200, { items: [DEFAULT_ADDRESS] });
    let postCount = 0;
    mock.onPost('/v1/me/requests').reply(() => {
      postCount += 1;
      return [200, { id: 'req-new-4', status: 'PENDING' }];
    });

    renderWizard();
    await advanceToStep2();
    await awaitDefaultAddressFilled();

    fireEvent.click(screen.getByRole('button', { name: /schedule later/i }));

    // jsdom doesn't enforce HTML5 `min` on programmatic .change(), so
    // we drive the past-date branch and assert the JS-level guard in
    // handlePost.
    const dateInput = screen.getByLabelText(/^date$/i) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2020-01-01' } });
    fireEvent.click(screen.getByTestId('time-segment-morning'));
    fireEvent.click(screen.getByTestId('time-slot-09:00'));

    fireEvent.click(screen.getByRole('button', { name: /confirm job/i }));

    await waitFor(() =>
      expect(screen.getByText(/pick a date and time in the future/i)).toBeInTheDocument(),
    );
    expect(postCount).toBe(0);
  });
});

// ── Address routing ──────────────────────────────────────────────────────────

describe('JobWizardModal — address routing', () => {
  it('routes the saved default through addressId (no manualAddress duplicated)', async () => {
    mock.onGet('/v1/me/addresses').reply(200, { items: [DEFAULT_ADDRESS] });
    let postedBody: Record<string, unknown> = {};
    mock.onPost('/v1/me/requests').reply((config) => {
      postedBody = JSON.parse(config.data as string) as Record<string, unknown>;
      return [200, { id: 'req-new-5', status: 'PENDING' }];
    });

    renderWizard();
    await advanceToStep2();
    await awaitDefaultAddressFilled();

    fireEvent.click(screen.getByRole('button', { name: /confirm job/i }));

    await waitFor(() => expect(postedBody.addressId).toBe('addr-default-1'));
    expect(postedBody.manualAddress).toBeNull();
  });

  it('routes an edited address through manualAddress with line1/city/country', async () => {
    mock.onGet('/v1/me/addresses').reply(200, { items: [DEFAULT_ADDRESS] });
    let postedBody: Record<string, unknown> = {};
    mock.onPost('/v1/me/requests').reply((config) => {
      postedBody = JSON.parse(config.data as string) as Record<string, unknown>;
      return [200, { id: 'req-new-6', status: 'PENDING' }];
    });

    renderWizard();
    await advanceToStep2();
    await awaitDefaultAddressFilled();

    // User edits the address — it no longer matches the saved default
    // and must travel as manualAddress.
    const addressInput = screen.getByDisplayValue(COMPOSED_DEFAULT) as HTMLInputElement;
    fireEvent.change(addressInput, {
      target: { value: '99 New Avenue, Jeddah, Saudi Arabia' },
    });

    fireEvent.click(screen.getByRole('button', { name: /confirm job/i }));

    await waitFor(() => expect(postedBody.addressId).toBeNull());
    const manual = postedBody.manualAddress as Record<string, unknown> | null;
    expect(manual).not.toBeNull();
    expect(manual?.line1).toBe('99 New Avenue');
    expect(manual?.city).toBe('Jeddah');
    expect(manual?.country).toBe('Saudi Arabia');
  });
});

// ── Geolocation ──────────────────────────────────────────────────────────────

describe('JobWizardModal — geolocation', () => {
  it('attaches lat/lng to manualAddress when navigator.geolocation succeeds', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (
          success: (pos: { coords: { latitude: number; longitude: number } }) => void,
        ) => {
          success({ coords: { latitude: 24.7136, longitude: 46.6753 } });
        },
      },
      configurable: true,
    });

    mock.onGet('/v1/me/addresses').reply(200, { items: [] });
    let postedBody: Record<string, unknown> = {};
    mock.onPost('/v1/me/requests').reply((config) => {
      postedBody = JSON.parse(config.data as string) as Record<string, unknown>;
      return [200, { id: 'req-new-7', status: 'PENDING' }];
    });

    renderWizard();
    await advanceToStep2();

    // No saved default — type the address. The TextField uses a
    // floating-label pattern (no htmlFor association), so we target
    // the only `textbox` rendered on step 2.
    const addressInput = screen.getAllByRole('textbox')[0] as HTMLInputElement;
    fireEvent.change(addressInput, {
      target: { value: '500 Park Lane, Riyadh, Saudi Arabia' },
    });

    fireEvent.click(screen.getByRole('button', { name: /use my current location/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /location captured/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm job/i }));

    await waitFor(() => expect(postedBody.scheduleType).toBe('ASAP'));
    const manual = postedBody.manualAddress as Record<string, unknown> | null;
    expect(manual).not.toBeNull();
    expect(manual?.lat).toBeCloseTo(24.7136, 4);
    expect(manual?.lng).toBeCloseTo(46.6753, 4);
  });

  it('shows a safe denied-permission message and still posts without lat/lng', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (
          _success: unknown,
          error: (err: { code: number; message: string }) => void,
        ) => {
          // 1 = PERMISSION_DENIED (W3C constant).
          error({ code: 1, message: 'User denied geolocation' });
        },
      },
      configurable: true,
    });

    mock.onGet('/v1/me/addresses').reply(200, { items: [] });
    let postedBody: Record<string, unknown> = {};
    mock.onPost('/v1/me/requests').reply((config) => {
      postedBody = JSON.parse(config.data as string) as Record<string, unknown>;
      return [200, { id: 'req-new-8', status: 'PENDING' }];
    });

    renderWizard();
    await advanceToStep2();

    const addressInput = screen.getAllByRole('textbox')[0] as HTMLInputElement;
    fireEvent.change(addressInput, {
      target: { value: '500 Park Lane, Riyadh, Saudi Arabia' },
    });

    fireEvent.click(screen.getByRole('button', { name: /use my current location/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/permission denied\. use the address field instead/i),
      ).toBeInTheDocument(),
    );

    // Raw geolocation message must never reach the DOM.
    expect(screen.queryByText(/User denied geolocation/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /confirm job/i }));

    await waitFor(() => expect(postedBody.scheduleType).toBe('ASAP'));
    const manual = postedBody.manualAddress as Record<string, unknown> | null;
    expect(manual).not.toBeNull();
    expect(manual).not.toHaveProperty('lat');
    expect(manual).not.toHaveProperty('lng');
  });
});

// ── Backend response handling ────────────────────────────────────────────────

describe('JobWizardModal — backend response', () => {
  it('shows the success step ONLY after the backend returns 200', async () => {
    mock.onGet('/v1/me/addresses').reply(200, { items: [DEFAULT_ADDRESS] });
    let resolve: ((v: [number, unknown]) => void) | null = null;
    const pending = new Promise<[number, unknown]>((r) => {
      resolve = r;
    });
    mock.onPost('/v1/me/requests').reply(() => pending);

    renderWizard();
    await advanceToStep2();
    await awaitDefaultAddressFilled();

    fireEvent.click(screen.getByRole('button', { name: /confirm job/i }));

    // While the POST is in flight, the success step is NOT visible —
    // there is no h1 heading anywhere in steps 1/2.
    expect(screen.queryByRole('heading', { name: /job posted/i })).toBeNull();

    resolve?.([200, { id: 'req-pending-1', status: 'PENDING' }]);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /job posted/i })).toBeInTheDocument(),
    );
  });

  it('shows a safe error on 400 (no raw backend payload in DOM)', async () => {
    mock.onGet('/v1/me/addresses').reply(200, { items: [DEFAULT_ADDRESS] });
    mock.onPost('/v1/me/requests').reply(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'PrismaClientKnownRequestError: scheduledAt must match scheduleType',
      },
    });

    renderWizard();
    await advanceToStep2();
    await awaitDefaultAddressFilled();

    fireEvent.click(screen.getByRole('button', { name: /confirm job/i }));

    await waitFor(() =>
      expect(screen.getByText(/check the form and try again/i)).toBeInTheDocument(),
    );
    // Raw backend / Prisma error must NEVER reach the DOM.
    expect(screen.queryByText(/PrismaClient/i)).toBeNull();
    expect(screen.queryByText(/scheduledAt must match scheduleType/i)).toBeNull();
    // Still on step 2; success step's heading is not rendered.
    expect(screen.queryByRole('heading', { name: /job posted/i })).toBeNull();
  });
});

// ── Anti-regression: legacy hardcoded display strings ────────────────────────

describe('JobWizardModal — no legacy hardcoded display strings', () => {
  it('renders a real HTML5 date input + segmented time picker (no "Mar 15, 2026" / "10:00 AM")', async () => {
    mock.onGet('/v1/me/addresses').reply(200, { items: [DEFAULT_ADDRESS] });

    renderWizard();
    await advanceToStep2();
    await awaitDefaultAddressFilled();

    fireEvent.click(screen.getByRole('button', { name: /schedule later/i }));

    // Legacy hardcoded display strings are gone — they came from
    // translation keys `dateValue` / `timeValue` that no longer exist.
    expect(screen.queryByText(/Mar 15, 2026/i)).toBeNull();
    expect(screen.queryByText(/10:00 AM/i)).toBeNull();

    // Real HTML5 date input + segmented time picker (Phase 4 — the
    // native <input type="time"> was removed because the platform UI
    // was inconsistent and the tap targets were too small).
    const dateInput = screen.getByLabelText(/^date$/i) as HTMLInputElement;
    expect(dateInput.type).toBe('date');
    expect(dateInput.value).toBe('');
    expect(screen.queryByDisplayValue(/^\d{2}:\d{2}$/)).toBeNull();
    expect(document.querySelector('input[type="time"]')).toBeNull();
    expect(screen.getByTestId('time-segment-morning')).toBeInTheDocument();
    expect(screen.getByTestId('time-segment-afternoon')).toBeInTheDocument();
    expect(screen.getByTestId('time-segment-evening')).toBeInTheDocument();
  });
});

// Phase 4 Feature 3 — segmented time picker contract.
describe('JobWizardModal — segmented time picker', () => {
  it('shows 15-minute pills only after a segment is selected, and 14:30 lives in Afternoon', async () => {
    mock.onGet('/v1/me/addresses').reply(200, { items: [DEFAULT_ADDRESS] });

    renderWizard();
    await advanceToStep2();
    await awaitDefaultAddressFilled();
    fireEvent.click(screen.getByRole('button', { name: /schedule later/i }));

    // No segment picked yet → no pills rendered.
    expect(screen.queryByTestId('time-slot-09:00')).toBeNull();

    fireEvent.click(screen.getByTestId('time-segment-afternoon'));
    expect(screen.getByTestId('time-slot-12:00')).toBeInTheDocument();
    expect(screen.getByTestId('time-slot-14:30')).toBeInTheDocument();
    expect(screen.getByTestId('time-slot-17:45')).toBeInTheDocument();
    // 06:00 belongs to Morning, not Afternoon — must not appear.
    expect(screen.queryByTestId('time-slot-06:00')).toBeNull();

    // Switching to Morning resets to the morning slot range.
    fireEvent.click(screen.getByTestId('time-segment-morning'));
    expect(screen.getByTestId('time-slot-06:00')).toBeInTheDocument();
    expect(screen.queryByTestId('time-slot-14:30')).toBeNull();
  });
});

// Phase 3 — native HTML5 media upload (Sprint 7.x).
//
// Pins the regression contract that:
//   1. The hidden <input type="file"> is configured for both gallery
//      and camera (`accept="image/*,video/*"`, `capture="environment"`,
//      `multiple`).
//   2. Picking N files renders N thumbnails AND N <img> previews
//      backed by object URLs (URL.createObjectURL).
//   3. Clicking the per-thumbnail X button calls URL.revokeObjectURL
//      and removes the row.
//   4. The MAX_MEDIA_ITEMS=4 cap is enforced (excess files are dropped
//      and the toast surface is exercised).
describe('JobWizardModal — Phase 3 native media upload', () => {
  beforeEach(() => {
    mock.onGet('/v1/me/addresses').reply(200, { items: [] });
  });

  function getMediaInput(): HTMLInputElement {
    return screen.getByTestId('job-wizard-media-input') as HTMLInputElement;
  }

  function makeFile(name: string, type: string, size = 1024): File {
    const blob = new Blob(['x'.repeat(size)], { type });
    return new File([blob], name, { type });
  }

  it('renders a hidden multi-select file input wired for camera + gallery', async () => {
    renderWizard();
    const input = await waitFor(() => getMediaInput());
    expect(input.type).toBe('file');
    expect(input.accept).toBe('image/*,video/*');
    expect(input.multiple).toBe(true);
    // `capture` is the camera-source hint. jsdom returns it via the
    // attribute API rather than a typed property.
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.style.display).toBe('none');
  });

  it('previews picked images with real <img> object-URL thumbnails', async () => {
    // Stable createObjectURL stub so we can assert exact URLs.
    let counter = 0;
    const created: string[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (() => {
      counter += 1;
      const u = `blob:mock-${counter}`;
      created.push(u);
      return u;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;

    try {
      renderWizard();
      const input = await waitFor(() => getMediaInput());
      const files = [makeFile('a.jpg', 'image/jpeg'), makeFile('b.png', 'image/png')];
      fireEvent.change(input, { target: { files } });

      await waitFor(() => {
        const previews = document.querySelectorAll<HTMLImageElement>('img[src^="blob:mock-"]');
        expect(previews).toHaveLength(2);
      });
      const srcs = Array.from(
        document.querySelectorAll<HTMLImageElement>('img[src^="blob:mock-"]'),
      ).map((n) => n.src);
      expect(srcs).toEqual(expect.arrayContaining(['blob:mock-1', 'blob:mock-2']));
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });

  it('caps the total at 4 files (extras are dropped)', async () => {
    URL.createObjectURL = (() => 'blob:mock') as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;

    renderWizard();
    const input = await waitFor(() => getMediaInput());
    const files = [
      makeFile('1.jpg', 'image/jpeg'),
      makeFile('2.jpg', 'image/jpeg'),
      makeFile('3.jpg', 'image/jpeg'),
      makeFile('4.jpg', 'image/jpeg'),
      makeFile('5.jpg', 'image/jpeg'),
      makeFile('6.jpg', 'image/jpeg'),
    ];
    fireEvent.change(input, { target: { files } });

    await waitFor(() => {
      const previews = document.querySelectorAll('img[src^="blob:mock"]');
      expect(previews.length).toBe(4);
    });
  });

  it('removes a thumbnail and revokes its object URL when X is clicked', async () => {
    let counter = 0;
    const revoked: string[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (() => {
      counter += 1;
      return `blob:mock-${counter}`;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((u: string) => {
      revoked.push(u);
    }) as typeof URL.revokeObjectURL;

    try {
      renderWizard();
      const input = await waitFor(() => getMediaInput());
      fireEvent.change(input, {
        target: { files: [makeFile('a.jpg', 'image/jpeg')] },
      });
      await waitFor(() => expect(document.querySelector('img[src="blob:mock-1"]')).not.toBeNull());

      const remove = screen.getByRole('button', { name: /^remove$/i });
      fireEvent.click(remove);

      await waitFor(() => {
        expect(document.querySelector('img[src="blob:mock-1"]')).toBeNull();
      });
      expect(revoked).toContain('blob:mock-1');
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});
