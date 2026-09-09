import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { PublicMediaLedgerService } from './public-media-ledger.service';

// Sprint 09B.29 Phase 4 — the reservation ledger, on its own.
//
// Three modules need it: `MediaModule` reserves at presign, the provider
// onboarding module claims at avatar finalize, and the portfolio module claims
// at attach. Putting it in `MediaModule` would have made both provider modules
// import a module that pulls in `AuthenticationModule` and the media
// controller, which is a cycle waiting to happen and a lot of surface for one
// service.
//
// It needs Prisma and nothing else, which is what makes it safe to import
// anywhere.
@Module({
  imports: [PrismaModule],
  providers: [PublicMediaLedgerService],
  exports: [PublicMediaLedgerService],
})
export class PublicMediaLedgerModule {}
