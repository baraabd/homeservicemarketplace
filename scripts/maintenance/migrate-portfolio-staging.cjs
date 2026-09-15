#!/usr/bin/env node
'use strict';

// Dry-run by default. The durable journal supports restart after a copy, DB
// commit, or source deletion. It contains storage keys: protect it as operator data.
const { createRequire } = require('node:module');
const { resolve, dirname } = require('node:path');
const { mkdir, readFile, writeFile, rename } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const apiRequire = createRequire(resolve(__dirname, '../../apps/api/package.json'));
const { prisma } = apiRequire('@homeservicemarketplace/database');
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  GetPublicAccessBlockCommand,
  GetBucketPolicyStatusCommand,
} = apiRequire('@aws-sdk/client-s3');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const includeApproved = args.includes('--include-approved');
function option(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const journalPath = option('--journal');
const limit = Number(option('--limit') || 100);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const maxBytes = 10 * 1024 * 1024;
async function save(journal) {
  const path = resolve(journalPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(journal, null, 2), { mode: 0o600, flush: true });
  await rename(`${path}.tmp`, path);
}
async function bytes(client, bucket, key) {
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!object.Body || !object.ContentLength || object.ContentLength > maxBytes)
    throw new Error('Invalid object size');
  const buffer = await object.Body.transformToByteArray();
  if (buffer.byteLength !== object.ContentLength || buffer.byteLength > maxBytes)
    throw new Error('Incomplete object');
  return buffer;
}
async function main() {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Limit must be 1–1000');
  const candidates = await prisma.providerPortfolioItem.findMany({
    where: {
      deletedAt: null,
      ...(includeApproved ? {} : { moderationState: { not: 'APPROVED' } }),
      mediaAsset: {
        visibility: 'PUBLIC',
        deletedAt: null,
        storageKey: { startsWith: 'portfolio/' },
      },
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: {
      id: true,
      providerProfileId: true,
      revision: true,
      mediaAsset: { select: { id: true, storageKey: true, declaredMimeType: true } },
    },
  });
  if (!apply) {
    process.stdout.write(
      `${JSON.stringify({ mode: 'dry-run', candidates: candidates.length, includeApproved, limit, message: 'No objects or rows changed. Apply requires --apply --journal <durable-private-path> and private S3 configuration.' })}\n`,
    );
    return;
  }
  if (!journalPath) throw new Error('--journal is required for a resumable apply');
  const source = process.env.S3_BUCKET;
  const target = process.env.S3_PORTFOLIO_BUCKET;
  if (!source || !target || source === target || target === process.env.S3_RESTRICTED_BUCKET)
    throw new Error('Configure a distinct private S3_PORTFOLIO_BUCKET');
  if (process.env.STORAGE_DRIVER !== 's3')
    throw new Error('This migration only applies to STORAGE_DRIVER=s3');
  const client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    ...(process.env.S3_ENDPOINT
      ? {
          endpoint: process.env.S3_ENDPOINT,
          forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
        }
      : {}),
    ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
  try {
    const block = (await client.send(new GetPublicAccessBlockCommand({ Bucket: target })))
      .PublicAccessBlockConfiguration;
    if (
      !block ||
      !block.BlockPublicAcls ||
      !block.IgnorePublicAcls ||
      !block.BlockPublicPolicy ||
      !block.RestrictPublicBuckets
    )
      throw new Error('Target must block all public access');
    try {
      const policy = await client.send(new GetBucketPolicyStatusCommand({ Bucket: target }));
      if (policy.PolicyStatus?.IsPublic !== false) throw new Error('Target policy must be private');
    } catch (error) {
      if (error.name !== 'NoSuchBucketPolicy') throw error;
    }
    let journal;
    try {
      journal = JSON.parse(await readFile(resolve(journalPath), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      journal = { version: 1, source, target, entries: [] };
    }
    if (
      journal.version !== 1 ||
      journal.source !== source ||
      journal.target !== target ||
      !Array.isArray(journal.entries)
    )
      throw new Error('Journal does not match this migration');
    for (const item of candidates) {
      if (journal.entries.some((entry) => entry.itemId === item.id)) continue;
      journal.entries.push({
        itemId: item.id,
        profileId: item.providerProfileId,
        assetId: item.mediaAsset.id,
        revision: item.revision,
        contentType: item.mediaAsset.declaredMimeType,
        sourceKey: item.mediaAsset.storageKey,
        targetKey: item.mediaAsset.storageKey.replace(/^portfolio\//, 'portfolio-staging/'),
        complete: false,
      });
    }
    await save(journal);
    let migrated = 0;
    for (const entry of journal.entries.filter((entry) => !entry.complete)) {
      if (
        !entry.sourceKey.startsWith('portfolio/') ||
        entry.targetKey !== entry.sourceKey.replace(/^portfolio\//, 'portfolio-staging/')
      )
        throw new Error('Invalid journal namespace');
      const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: entry.assetId } });
      if (asset.storageKey === entry.sourceKey) {
        const original = await bytes(client, source, entry.sourceKey);
        try {
          await client.send(
            new PutObjectCommand({
              Bucket: target,
              Key: entry.targetKey,
              Body: original,
              ContentType: entry.contentType,
              ContentLength: original.byteLength,
              IfNoneMatch: '*',
            }),
          );
        } catch (error) {
          if (error.$metadata?.httpStatusCode !== 412) throw error;
        }
        const copied = await bytes(client, target, entry.targetKey);
        if (digest(copied) !== digest(original)) throw new Error('Copied bytes do not match');
        await prisma.$transaction(
          async (tx) => {
            const changed = await tx.providerPortfolioItem.updateMany({
              where: { id: entry.itemId, revision: entry.revision, deletedAt: null },
              data: { revision: { increment: 1 } },
            });
            if (changed.count !== 1)
              throw new Error('Item changed; review this journal entry before retrying');
            const moved = await tx.mediaAsset.updateMany({
              where: {
                id: entry.assetId,
                storageKey: entry.sourceKey,
                visibility: 'PUBLIC',
                deletedAt: null,
              },
              data: { storageKey: entry.targetKey },
            });
            if (moved.count !== 1)
              throw new Error('Media changed; review this journal entry before retrying');
            await tx.auditEvent.create({
              data: {
                type: 'PORTFOLIO_CONTENT_UPDATED',
                metadata: {
                  providerProfileId: entry.profileId,
                  itemId: entry.itemId,
                  revision: entry.revision + 1,
                  previousRevision: entry.revision,
                  changedFields: [],
                  reason: 'PRIVATE_STORAGE_MIGRATION',
                },
              },
            });
          },
          { isolationLevel: 'Serializable' },
        );
      } else if (asset.storageKey !== entry.targetKey)
        throw new Error('Media no longer matches this journal');
      // The journal survives a crash after the DB commit but before deletion.
      await client.send(new DeleteObjectCommand({ Bucket: source, Key: entry.sourceKey }));
      entry.complete = true;
      await save(journal);
      migrated += 1;
    }
    process.stdout.write(
      `${JSON.stringify({ mode: 'apply', migrated, remaining: journal.entries.filter((entry) => !entry.complete).length, cdnPurgeRequired: true })}\n`,
    );
  } finally {
    client.destroy();
  }
}
main()
  .catch(() => {
    // Never expose storage keys, credentials, SQL details, or signed URLs.
    process.stderr.write(
      'Portfolio migration failed. No success is claimed. Keep the private journal and resolve configuration or changed records before retrying.\n',
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
