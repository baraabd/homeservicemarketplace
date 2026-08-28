import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  PatchOnboardingStepRequest,
  ProviderTransportModeCode,
  ProviderTypeCode,
} from '@homeservicemarketplace/contracts';

import { MAX_INTERVALS_PER_PROVIDER, MINUTES_PER_DAY } from '../availability-intervals';

// Sprint 8 — PATCH /v1/me/provider/onboarding/steps/:step body.
//
// This DTO is the SHAPE gate: types, lengths, bounds, array sizes. It is not
// the policy gate — whether a value is allowed on THIS step, whether an
// interval overlaps another, whether a category is a selectable leaf, and
// whether a consent version is the live one are all decided in the service,
// because each needs state the DTO cannot see.
//
// The global ValidationPipe runs with `forbidNonWhitelisted: true`, so a
// payload carrying `status`, `verified`, `onboardingState`, `userId` or any
// other column a provider must not set is rejected with 400 before the service
// is reached. That is the first half of the defence; the per-step field guard
// in the service is the second, and it is the one that stops a legitimate
// field being written from the wrong screen.

const PROVIDER_TYPES: ProviderTypeCode[] = ['INDIVIDUAL', 'BUSINESS'];
const TRANSPORT_MODES: ProviderTransportModeCode[] = [
  'ON_FOOT',
  'MOTORCYCLE',
  'CAR',
  'VAN',
  'TRUCK',
  'PUBLIC_TRANSPORT',
];

function trimToNullable(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return value as string;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function emptyStringToNull(value: unknown): unknown {
  if (typeof value === 'string' && value.trim().length === 0) return null;
  return value;
}

/** One weekly window. Minutes from local midnight, end exclusive. */
export class AvailabilityIntervalDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MINUTES_PER_DAY)
  startMinute!: number;

  // Bounds only. That the end is AFTER the start, and that the window does not
  // collide with another, are properties of the set rather than the field, so
  // they belong to the service where the whole week is visible.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MINUTES_PER_DAY)
  endMinute!: number;
}

export class PatchOnboardingStepDto implements PatchOnboardingStepRequest {
  /** The version the client last read. Not optional: an unversioned write is
   *  a silent overwrite by another name. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;

  // ── PROVIDER_TYPE ───────────────────────────────────────────────────────

  @IsOptional()
  @IsIn([...PROVIDER_TYPES, null])
  providerType?: ProviderTypeCode | null;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(120)
  legalBusinessName?: string | null;

  // ── IDENTITY ────────────────────────────────────────────────────────────

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(80)
  displayName?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(500)
  profileImageUrl?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(40)
  phoneNumber?: string | null;

  // ── LOCATION ────────────────────────────────────────────────────────────

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(80)
  serviceAreaCity?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(80)
  serviceAreaCountry?: string | null;

  // Sprint 9B.19 — ISO 3166-1 alpha-2, beside the display name above.
  //
  // Upper-cased here so the stored value has one shape whatever a client
  // sends. That the code names a country the platform actually knows is the
  // service's question, not the DTO's: this is the shape gate.
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim().toUpperCase() : null,
  )
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'serviceAreaCountryCode must be a two-letter ISO country code',
  })
  serviceAreaCountryCode?: string | null;

  @IsOptional()
  @Transform(({ value }) => emptyStringToNull(value))
  @Type(() => Number)
  @IsLatitude()
  serviceAreaLat?: number | null;

  @IsOptional()
  @Transform(({ value }) => emptyStringToNull(value))
  @Type(() => Number)
  @IsLongitude()
  serviceAreaLng?: number | null;

  @IsOptional()
  @Transform(({ value }) => emptyStringToNull(value))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  serviceAreaRadiusKm?: number | null;

  // Bounded generously here and by an operator-controlled setting in the
  // service. The DTO cap stops an absurd payload being parsed at all; the
  // setting is the policy the operator can actually tune.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  serviceAreaIds?: string[];

  // Sprint 9B.18 — the one service the provider leads with. Shape only; that
  // it is one of THEIR specialties, and still selectable, needs the provider's
  // state and so belongs to the service.
  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(64)
  primarySpecialtyId?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(200)
  workshopAddressLine?: string | null;

  @IsOptional()
  @Transform(({ value }) => emptyStringToNull(value))
  @Type(() => Number)
  @IsLatitude()
  workshopLat?: number | null;

  @IsOptional()
  @Transform(({ value }) => emptyStringToNull(value))
  @Type(() => Number)
  @IsLongitude()
  workshopLng?: number | null;

  // ── SPECIALTIES ─────────────────────────────────────────────────────────

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  primaryGroupIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  specialtyLeafIds?: string[];

  // ── EXPERIENCE ──────────────────────────────────────────────────────────

  // Upper bound matches the database CHECK and the policy constant. A century
  // in the trade is a typo, not a career.
  @IsOptional()
  @Transform(({ value }) => emptyStringToNull(value))
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(80)
  yearsOfExperience?: number | null;

  @IsOptional()
  @Transform(({ value }) => emptyStringToNull(value))
  @IsDateString()
  professionSince?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  equipmentCodes?: string[];

  @IsOptional()
  @IsIn([...TRANSPORT_MODES, null])
  transportMode?: ProviderTransportModeCode | null;

  // Sprint 9B.18 — the full set. Bounded by the enum's own size: a request
  // carrying more entries than there are modes is malformed by definition,
  // and duplicates are collapsed server-side rather than rejected, because a
  // client sending the same mode twice is untidy, not hostile.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TRANSPORT_MODES.length)
  @IsIn(TRANSPORT_MODES, { each: true })
  transportModes?: ProviderTransportModeCode[];

  // ── AVAILABILITY ────────────────────────────────────────────────────────

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_INTERVALS_PER_PROVIDER)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityIntervalDto)
  availability?: AvailabilityIntervalDto[];

  // Validated as a STRING here and resolved against the runtime in the
  // service: `Asia/Damascus` and `Asia/Damascusx` are indistinguishable by
  // shape, so only Intl can tell them apart.
  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(64)
  timezone?: string | null;

  // ── PROFILE ─────────────────────────────────────────────────────────────

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(120)
  headline?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(2000)
  bio?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(2000)
  additionalInformation?: string | null;

  // ── CONSENT ─────────────────────────────────────────────────────────────

  // Checked against the LIVE published version in the service. Accepting a
  // stale document is not consent to the current one.
  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(40)
  acceptedConsentVersion?: string | null;
}
