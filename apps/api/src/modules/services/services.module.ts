import { Module } from '@nestjs/common';

import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

// Read-only catalog module (Sprint 1, slice 1). The repository is
// provided globally by PersistenceModule, so this module only needs to
// register the service and controller.
@Module({
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
