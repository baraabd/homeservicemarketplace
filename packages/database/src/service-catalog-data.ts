// The development seed and launch command share the six stable specialty
// slugs. Only the launch command installs their proposed groups.
export const SERVICE_GROUPS = [
  {
    slug: 'home-maintenance',
    labelEn: 'Home maintenance',
    labelAr: 'الصيانة المنزلية',
    icon: '🛠️',
    sortOrder: 0,
  },
  { slug: 'home-care', labelEn: 'Home care', labelAr: 'العناية بالمنزل', icon: '🏠', sortOrder: 1 },
  {
    slug: 'interior-finishes',
    labelEn: 'Interior finishes',
    labelAr: 'التشطيبات الداخلية',
    icon: '🖌️',
    sortOrder: 2,
  },
] as const;

export const SERVICE_SPECIALTIES = [
  {
    slug: 'plumbing',
    labelEn: 'Plumbing',
    labelAr: 'سباكة',
    icon: '🔧',
    sortOrder: 0,
    parentSlug: 'home-maintenance',
  },
  {
    slug: 'electrical',
    labelEn: 'Electrical',
    labelAr: 'كهرباء',
    icon: '⚡',
    sortOrder: 1,
    parentSlug: 'home-maintenance',
  },
  {
    slug: 'ac-repair',
    labelEn: 'AC Repair',
    labelAr: 'صيانة تكييف',
    icon: '❄️',
    sortOrder: 2,
    parentSlug: 'home-maintenance',
  },
  {
    slug: 'cleaning',
    labelEn: 'Cleaning',
    labelAr: 'تنظيف',
    icon: '✨',
    sortOrder: 3,
    parentSlug: 'home-care',
  },
  {
    slug: 'carpentry',
    labelEn: 'Carpentry',
    labelAr: 'نجارة',
    icon: '🔨',
    sortOrder: 4,
    parentSlug: 'interior-finishes',
  },
  {
    slug: 'painting',
    labelEn: 'Painting',
    labelAr: 'دهانات',
    icon: '🎨',
    sortOrder: 5,
    parentSlug: 'interior-finishes',
  },
] as const satisfies ReadonlyArray<{
  slug: string;
  labelAr: string;
  labelEn: string;
  icon: string;
  sortOrder: number;
  parentSlug: (typeof SERVICE_GROUPS)[number]['slug'];
}>;
