import { Schema, Types } from 'mongoose';

// Draft document for category-specific service metadata fields.
// Final published metadata will live alongside the (later) services bounded
// context. This baseline is intentionally permissive — drafts are work in
// progress and may contain partial or experimental shapes.
export interface ServiceMetadataDraftDoc {
  _id: Types.ObjectId;
  ownerUserId: string;
  categorySlug: string;
  fields: Record<string, unknown>;
  status: 'draft' | 'review';
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export const SERVICE_METADATA_DRAFT_COLLECTION = 'service_metadata_drafts';
export const SERVICE_METADATA_DRAFT_MODEL = 'ServiceMetadataDraft';

export const ServiceMetadataDraftSchema = new Schema<ServiceMetadataDraftDoc>(
  {
    ownerUserId: { type: String, required: true, index: true },
    categorySlug: { type: String, required: true, index: true },
    fields: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['draft', 'review'], default: 'draft' },
    schemaVersion: { type: Number, default: 1, min: 1 },
  },
  {
    collection: SERVICE_METADATA_DRAFT_COLLECTION,
    timestamps: true,
    minimize: false,
    strict: true,
    versionKey: false,
  },
);

ServiceMetadataDraftSchema.index({ ownerUserId: 1, categorySlug: 1 });
