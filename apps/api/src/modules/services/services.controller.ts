import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import type { ServiceCategoryListResponse } from '@homeservicemarketplace/contracts';

import { Public } from '../iam/authentication/decorators/public.decorator';
import { ServicesService } from './services.service';

// GET /v1/services
//
// Public, read-only catalog. No authentication is required because the
// list of available services is part of the marketplace's public face;
// we'd want it to render before login on the seeker landing. The catalog
// is curated through migrations + seeds, so there is no mutating
// endpoint paired with this one.
@Controller({ path: 'services', version: '1' })
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  async list(): Promise<ServiceCategoryListResponse> {
    const items = await this.services.listCategories();
    return { items };
  }
}
