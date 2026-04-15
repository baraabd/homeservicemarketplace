import { Schema, Types } from 'mongoose';

export interface PortfolioMediaItem {
  storageKey: string;
  caption?: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ProviderPortfolioDraftDoc {
  // Mongoose generates `_id` as an ObjectId unless the schema overrides it;
  // the schema here does not override it, so the runtime type is ObjectId.
  _id: Types.ObjectId;
  ownerUserId: string;
  bio?: string;
  highlights: string[];
  media: PortfolioMediaItem[];
  status: 'draft' | 'review';
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export const PROVIDER_PORTFOLIO_DRAFT_COLLECTION = 'provider_portfolio_drafts';
export const PROVIDER_PORTFOLIO_DRAFT_MODEL = 'ProviderPortfolioDraft';

const PortfolioMediaItemSchema = new Schema<PortfolioMediaItem>(
  {
    storageKey: { type: String, required: true },
    caption: { type: String },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

export const ProviderPortfolioDraftSchema = new Schema<ProviderPortfolioDraftDoc>(
  {
    ownerUserId: { type: String, required: true, index: true, unique: true },
    bio: { type: String, maxlength: 4_000 },
    highlights: { type: [String], default: [] },
    media: { type: [PortfolioMediaItemSchema], default: [] },
    status: { type: String, enum: ['draft', 'review'], default: 'draft' },
    schemaVersion: { type: Number, default: 1, min: 1 },
  },
  {
    collection: PROVIDER_PORTFOLIO_DRAFT_COLLECTION,
    timestamps: true,
    minimize: false,
    strict: true,
    versionKey: false,
  },
);
