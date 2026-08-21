import { IsOptional, IsString, Length } from 'class-validator';
import type { SubmitAdminAccessRequestRequest } from '@homeservicemarketplace/contracts';

// POST /v1/me/admin-access
//
// The ONLY accepted field is a free-text justification. With the global
// ValidationPipe's `forbidNonWhitelisted: true`, any attempt to smuggle
// `role`, `roles`, `status`, `userId`, `permissions`, or `approved` into the
// body is rejected with 400 before the handler runs — a request can never
// approve itself.
export class SubmitAdminAccessRequestDto implements SubmitAdminAccessRequestRequest {
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  justification?: string;
}
