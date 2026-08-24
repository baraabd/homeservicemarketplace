import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type {
  CreateAdminCategoryRequest,
  CreateAdminEquipmentRequest,
  UpdateAdminCategoryRequest,
  UpdateAdminEquipmentRequest,
} from '@homeservicemarketplace/contracts';

// Sprint 8 — admin catalogue DTOs.
//
// Shape only. Whether a re-parent creates a cycle, whether a category is held
// by providers, and whether a slug is taken all need state the DTO cannot see,
// so they are decided in the service.

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateAdminCategoryDto implements CreateAdminCategoryRequest {
  // Lowercase kebab. A slug appears in URLs and in client-side lookups, so
  // "Deep Cleaning" and "deep-cleaning" arriving as two rows would be two
  // categories for one thing.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase words separated by single hyphens',
  })
  slug!: string;

  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  labelEn!: string;

  // Required, not optional. A category with no Arabic label renders as a blank
  // chip for half the users of this marketplace.
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  labelAr!: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(40)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentId?: string | null;

  @IsOptional()
  @IsBoolean()
  isLeaf?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateAdminCategoryDto implements UpdateAdminCategoryRequest {
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  labelEn?: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  labelAr?: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(40)
  icon?: string;

  // `null` promotes the category to a root. Distinguished from `undefined`,
  // which leaves the parent alone — the difference between "make this a
  // top-level group" and "I am not editing the parent".
  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentId?: string | null;

  @IsOptional()
  @IsBoolean()
  isLeaf?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class CreateAdminEquipmentDto implements CreateAdminEquipmentRequest {
  // Normalised to UPPER_SNAKE in the service. Validated loosely here so a
  // human typing "power drill" gets a usable code rather than a 400.
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code!: string;

  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  labelEn!: string;

  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  labelAr!: string;

  // Null means it applies to every category — a ladder is a ladder.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateAdminEquipmentDto implements UpdateAdminEquipmentRequest {
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  labelEn?: string;

  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  labelAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}
