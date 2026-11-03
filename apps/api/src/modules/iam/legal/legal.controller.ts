import { Controller, Get } from '@nestjs/common';
import type { LegalDocumentsResponse } from '@homeservicemarketplace/contracts';

import { Public } from '../authentication/decorators/public.decorator';
import { LegalAcceptanceService } from './legal-acceptance.service';

// K02 — public, unauthenticated: which policy versions are current and
// whether the server will record acceptance of them.
@Controller({ path: 'legal', version: '1' })
export class LegalController {
  constructor(private readonly legal: LegalAcceptanceService) {}

  @Public()
  @Get('documents')
  documents(): LegalDocumentsResponse {
    return this.legal.documents();
  }
}
