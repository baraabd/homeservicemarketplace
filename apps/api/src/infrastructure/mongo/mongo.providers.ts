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

export type ServiceMetadataDraftModel = Model<ServiceMetadataDraftDoc>;
export type ProviderPortfolioDraftModel = Model<ProviderPortfolioDraftDoc>;

// Factories are async so Nest awaits MongoService.connect() during module
// resolution — BEFORE any consumer can be constructed. This closes the race
// where model factories ran ahead of MongoService.onModuleInit() and hit
// "Mongo connection not initialized".
export const serviceMetadataDraftProvider: FactoryProvider<Promise<ServiceMetadataDraftModel>> = {
  provide: SERVICE_METADATA_DRAFT_TOKEN,
  inject: [MongoService],
  useFactory: async (mongo: MongoService) => {
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
      const conn = await mongo.connect();
      return conn.model<ProviderPortfolioDraftDoc>(
        PROVIDER_PORTFOLIO_DRAFT_MODEL,
        ProviderPortfolioDraftSchema,
      );
    },
  };

export const mongoModelProviders = [serviceMetadataDraftProvider, providerPortfolioDraftProvider];
