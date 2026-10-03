import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import type { SendMessageRequest } from '@homeservicemarketplace/contracts';

// Body DTO for POST /v1/me/conversations/:id/messages.
//
// `body` is trimmed before validation so a whitespace-only payload is
// rejected by the MinLength(1) rule. The 4000-char ceiling is generous
// enough for normal chat without inviting abuse; future slices can
// raise it for support / multi-paragraph use cases.
export class SendMessageDto implements SendMessageRequest {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  // R12 — one logical send. Same bounds as the R07 request key; restricted to
  // URL-safe characters so it can never smuggle anything into logs.
  @IsOptional()
  @IsString()
  @Length(16, 128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  idempotencyKey?: string;
}
