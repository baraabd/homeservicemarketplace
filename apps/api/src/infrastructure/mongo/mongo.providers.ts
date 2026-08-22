import type { FactoryProvider } from '@nestjs/common';
import type { Model } from 'mongoose';

import { MongoService } from './mongo.service';
import {
  PROVIDER_PORTFOLIO_DRAFT_MODEL,
  ProviderPortfolioDraftSchema,
  type ProviderPortfolioDraftDoc,
} from './schemas/provider-portfolio-draft.schema';
import {
  SERVICE_METADATA_DRAFT_MODEL,
  ServiceMetadataDraftSchema,
  type ServiceMetadataDraftDoc,
} from './schemas/service-metadata-draft.schema';

export const SERVICE_METADATA_DRAFT_TOKEN = 'MONGO_MODEL_SERVICE_METADATA_DRAFT';
export const PROVIDER_PORTFOLIO_DRAFT_TOKEN = 'MONGO_MODEL_PROVIDER_PORTFOLIO_DRAFT';

// Sprint 4 — the models are NULL when MONGODB_ENABLED=false.
//
// The token stays registered either way so the DI graph does not change shape
// with configuration. A future consumer must therefore handle null, which is
// the honest contract: this store is optional (docs/adr/0002-mongodb.md), and
// a consumer that cannot tolerate its absence should depend on Postgres.
export type ServiceMetadataDraftModel = Model<ServiceMetadataDraftDoc> | null;
export type ProviderPortfolioDraftModel = Model<ProviderPortfolioDraftDoc> | null;

// Factories are async so Nest awaits MongoService.connect() during module
// resolution — BEFORE any consumer can be constructed. This closes the race
// where model factories ran ahead of MongoService.onModuleInit() and hit
// "Mongo connection not initialized".
export const serviceMetadataDraftProvider: FactoryProvider<Promise<ServiceMetadataDraftModel>> = {
  provide: SERVICE_METADATA_DRAFT_TOKEN,
  inject: [MongoService],
  useFactory: async (mongo: MongoService) => {
    // Checked BEFORE connect(): with Mongo off, module resolution must not
    // dial anything, and must not fail. Boot proceeds with a null model.
    if (!mongo.isEnabled()) return null;
    const conn = await mongo.connect();
    return conn.model<ServiceMetadataDraftDoc>(
      SERVICE_METADATA_DRAFT_MODEL,
      ServiceMetadataDraftSchema,
    );
  },
};

export const providerPortfolioDraftProvider: FactoryProvider<Promise<ProviderPortfolioDraftModel>> =
  {
    provide: PROVIDER_PORTFOLIO_DRAFT_TOKEN,
    inject: [MongoService],
    useFactory: async (mongo: MongoService) => {
      if (!mongo.isEnabled()) return null;
      const conn = await mongo.connect();
      return conn.model<ProviderPortfolioDraftDoc>(
        PROVIDER_PORTFOLIO_DRAFT_MODEL,
        ProviderPortfolioDraftSchema,
      );
    },
  };

export const mongoModelProviders = [serviceMetadataDraftProvider, providerPortfolioDraftProvider];
