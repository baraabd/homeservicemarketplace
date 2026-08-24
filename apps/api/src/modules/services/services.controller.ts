import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import type {
  EquipmentCatalogListResponse,
  ServiceCategoryListResponse,
} from '@homeservicemarketplace/contracts';

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

  // Sprint 8 — the equipment catalogue, on the same public, read-only terms
  // as the category list above: the onboarding wizard needs it before a
  // provider has any standing to speak of, and it is part of what the
  // marketplace says it can do.
  //
  // Curated through the admin catalogue surface, so there is no mutating
  // endpoint paired with this one either.
  @Public()
  @Get('equipment')
  @HttpCode(HttpStatus.OK)
  async equipment(): Promise<EquipmentCatalogListResponse> {
    const items = await this.services.listEquipment();
    return { items };
  }
}
