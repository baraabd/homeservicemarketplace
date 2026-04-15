import { Global, Module } from '@nestjs/common';

import { MongoService } from './mongo.service';
import { mongoModelProviders } from './mongo.providers';

@Global()
@Module({
  providers: [MongoService, ...mongoModelProviders],
  exports: [MongoService, ...mongoModelProviders.map((p) => p.provide)],
})
export class MongoModule {}
