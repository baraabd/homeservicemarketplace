import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';

import { MAX_FILES_PER_REQUEST } from '../../../infrastructure/storage/content-type';

/** Asset ids are server-minted cuids. Anything else is refused at the edge. */
export const MEDIA_ASSET_ID_PATTERN = /^[a-z0-9]{20,40}$/;

// POST /v1/media/request-attachments/finalize
//
// The body carries asset ids only. It never carries a key, a URL, a content
// type or a size: those were fixed at reservation and are read from the row.
export class FinalizeRequestAttachmentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_FILES_PER_REQUEST)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(MEDIA_ASSET_ID_PATTERN, { each: true })
  assetIds!: string[];
}
