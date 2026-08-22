import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { ApplyForCategoryRequest } from '@homeservicemarketplace/contracts';

// POST /v1/me/provider/categories/applications body.
//
// Two fields, both optional individually, at least one required together. The
// global ValidationPipe runs with `forbidNonWhitelisted: true`, so a payload
// carrying `status`, `providerProfileId`, or `approved` is rejected with a 400
// before the service is reached — which matters more here than on most DTOs,
// because those are precisely the fields a client would want to forge to skip
// the review it is being asked to wait for.
//
// The service does the catalog lookup; this class only proves the shape.
function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class ApplyForCategoryDto implements ApplyForCategoryRequest {
  // `ValidateIf` gives the "one of the two" rule a real error message on the
  // field the client is most likely to have meant, instead of a bare
  // whitelist rejection that says nothing about what was missing.
  @ValidateIf((o: ApplyForCategoryDto) => !o.categorySlug)
  @IsString({ message: 'Provide either categoryId or categorySlug.' })
  @MaxLength(64)
  @Transform(({ value }) => trim(value))
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(({ value }) => trim(value))
  categorySlug?: string;
}
