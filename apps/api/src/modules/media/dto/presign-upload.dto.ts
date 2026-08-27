import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  ALLOWED_CONTENT_TYPES,
  MAX_BYTES_PER_FILE,
  MAX_FILES_PER_REQUEST,
} from '../../../infrastructure/storage/content-type';

// POST /v1/media/presigned-url body. The endpoint accepts a BATCH so
// the wizard's "up to 4 files" upload turns into a single round-trip.
// Each item is independently validated; one bad item rejects the
// whole batch (so the frontend gets a single 400 to retry, not
// per-item partial state).
//
// The wire never accepts a `key` from the caller — the controller
// synthesises the object key from `contentType` + a random UUID so
// users can't pick paths that already exist or escape the storage
// root. `filename` is accepted ONLY for telemetry / future audit;
// it's not used to compose the key.

export class PresignUploadItemDto {
  @IsString()
  @IsIn([...ALLOWED_CONTENT_TYPES])
  contentType!: (typeof ALLOWED_CONTENT_TYPES)[number];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_BYTES_PER_FILE)
  sizeBytes!: number;

  // Hint only — kept off the synthesised key. Length-bounded so a
  // hostile client can't ship a 1 MB filename.
  @IsOptional()
  @IsString()
  @Length(0, 200)
  filename?: string;
}

/** Sprint 9B.10 — which namespace the synthesised keys land in.
 *
 *  A whitelist, never a caller-supplied prefix: the whole reason keys are
 *  server-synthesised is that a caller-controlled path is a traversal vector,
 *  and accepting "give me a key under X" would hand that control straight
 *  back. Defaults to 'request', so every existing client is unaffected. */
export const PRESIGN_PURPOSES = ['request', 'portfolio'] as const;
export type PresignPurpose = (typeof PRESIGN_PURPOSES)[number];

export class PresignUploadRequestDto {
  @IsOptional()
  @IsString()
  @IsIn([...PRESIGN_PURPOSES])
  purpose?: PresignPurpose;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_FILES_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => PresignUploadItemDto)
  items!: PresignUploadItemDto[];
}
