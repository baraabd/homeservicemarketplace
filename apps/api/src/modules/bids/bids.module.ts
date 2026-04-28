import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { BidsController } from './bids.controller';
import { BidsService } from './bids.service';

// Bids module (Sprint 2, slice 2.1). Read-only Seeker-facing feed.
// Repositories are provided globally by PersistenceModule; this
// module needs AuthenticationModule for the JwtAuthGuard it applies
// on every endpoint.
@Module({
  imports: [AuthenticationModule],
  controllers: [BidsController],
  providers: [BidsService],
  exports: [BidsService],
})
export class BidsModule {}
