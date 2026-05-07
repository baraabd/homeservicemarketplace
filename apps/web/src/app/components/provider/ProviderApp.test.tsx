// ─────────────────────────────────────────────────────────────────────────────
// Phase 6 — Pending skills (admin approval queue surface).
// Providers can apply for new categories; until an admin approves,
// the row appears on /v1/me/provider/profile under
// `pendingCategories` and the Skills section renders it with a
// dashed-border, faded pill carrying a Clock icon and a
// "Pending Admin Approval" tooltip.
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_PENDING_CATEGORY = {
  id: 'c-pending-1',
  slug: 'painting',
  labelEn: 'Painting',
  labelAr: 'دهان',
  icon: 'brush',
};

describe('ProviderApp — pending skills (admin approval queue)', () => {
  it('renders a dashed-border pill with a Clock icon and "Pending Admin Approval" title', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, {
      profile: { ...MOCK_PROFILE, pendingCategories: [MOCK_PENDING_CATEGORY] },
    });

    renderProvider();
    openProfileTab();

    const pendingPill = await screen.findByLabelText(/^pending approval$/i);
    expect(pendingPill).toHaveTextContent('Painting');
    expect(pendingPill).toHaveAttribute('title', 'Pending Admin Approval');
    expect(pendingPill).toHaveClass('border-dashed');
    expect(pendingPill).toHaveClass('cursor-help');
    
    const clockIcon = pendingPill.querySelector('svg');
    expect(clockIcon).not.toBeNull();
  });

  it('renders approved categories alongside pending ones (single flex row, both visible)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, {
      profile: { ...MOCK_PROFILE, pendingCategories: [MOCK_PENDING_CATEGORY] },
    });

    renderProvider();
    openProfileTab();

    await waitFor(() => expect(screen.getByText('Plumbing')).toBeInTheDocument());
    expect(screen.getByText('Electrical')).toBeInTheDocument();
    
    expect(screen.getByText('Painting')).toBeInTheDocument();
    expect(screen.queryByText(/no skills added yet|لم تضف مهارات بعد/i)).toBeNull();
  });

  it('uses the Arabic copy for the pending tooltip when lang is ar', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, {
      profile: { ...MOCK_PROFILE, pendingCategories: [MOCK_PENDING_CATEGORY] },
    });

    renderProvider();
    openProfileTab();
    const langToggle = await screen.findByRole('button', { name: /switch language/i });
    fireEvent.click(langToggle);

    const pendingPill = await screen.findByLabelText(/في انتظار موافقة الإدارة/);
    expect(pendingPill).toHaveAttribute('title', 'في انتظار موافقة الإدارة');
  });

  it('treats pendingCategories as [] when the wire omits the field', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });

    renderProvider();
    openProfileTab();

    await waitFor(() => expect(screen.getByText('Plumbing')).toBeInTheDocument());
    expect(screen.queryByLabelText(/^pending approval$/i)).toBeNull();
  });
});

// Phase 6 — LiveJobsScreen interactive map.
// Replaces the static Unsplash photo with a Leaflet MapContainer that
// renders one Marker per available-request that carries real lat/lng.
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_AVAILABLE_REQUEST = {
  id: 'r1',
  category: { id: 'c1', slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة' },
  customServiceText: null,
  description: 'Pipe leak under kitchen sink',
  media: [],
  scheduleType: 'ASAP' as const,
  scheduledAt: null,
  location: {
    city: 'Riyadh',
    country: 'Saudi Arabia',
    lat: 24.6904,
    lng: 46.6863,
  },
  bidsCount: 0,
  createdAt: '2026-05-01T08:00:00.000Z',
};

describe('ProviderApp — Phase 6 Live Jobs map', () => {
  it('mounts a Leaflet MapContainer + TileLayer on the default Live Jobs tab', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onGet('/v1/provider/available-requests').reply(200, { items: [], nextCursor: null });

    renderProvider();

    await waitFor(() =>
      expect(screen.getByLabelText(/live jobs map|خريطة الوظائف الحية/i)).toBeInTheDocument(),
    );
    expect(screen.getByTestId('leaflet-tile')).toBeInTheDocument();
    expect(screen.queryByAltText(/city map/i)).toBeNull();
  });

  it('renders one Marker per request with real coords and skips null-coord rows', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onGet('/v1/provider/available-requests').reply(200, {
      items: [
        SAMPLE_AVAILABLE_REQUEST,
        {
          ...SAMPLE_AVAILABLE_REQUEST,
          id: 'r2',
          location: { ...SAMPLE_AVAILABLE_REQUEST.location, lat: 24.8112, lng: 46.6298 },
        },
        {
          ...SAMPLE_AVAILABLE_REQUEST,
          id: 'r3',
          location: { ...SAMPLE_AVAILABLE_REQUEST.location, lat: null, lng: null },
        },
      ],
      nextCursor: null,
    });

    renderProvider();

    await waitFor(() => expect(screen.getAllByTestId('leaflet-marker')).toHaveLength(2));
    const markers = screen.getAllByTestId('leaflet-marker');
    const positions = markers.map((m) => m.getAttribute('data-position'));
    expect(positions).toContain(JSON.stringify([24.6904, 46.6863]));
    expect(positions).toContain(JSON.stringify([24.8112, 46.6298]));
  });

  it('uses the provider serviceArea coords as the map center when present', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, {
      profile: { ...MOCK_PROFILE, serviceAreaLat: 21.5433, serviceAreaLng: 39.1728 },
    });
    mock.onGet('/v1/provider/available-requests').reply(200, { items: [], nextCursor: null });

    renderProvider();

    await waitFor(() => {
      const map = screen.getByTestId('leaflet-map');
      expect(map.getAttribute('data-center')).toBe(JSON.stringify([21.5433, 39.1728]));
    });
  });

  it('falls back to Riyadh when the provider profile has no serviceArea coords', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, {
      profile: { ...MOCK_PROFILE, serviceAreaLat: null, serviceAreaLng: null },
    });
    mock.onGet('/v1/provider/available-requests').reply(200, { items: [], nextCursor: null });

    renderProvider();

    await waitFor(() => {
      const map = screen.getByTestId('leaflet-map');
      expect(map.getAttribute('data-center')).toBe(JSON.stringify([24.7136, 46.6753]));
    });
  });
});
