import type { S3Client } from '@aws-sdk/client-s3';
import type { TelemetryService } from '../telemetry/telemetry.service';

const OPERATIONS: Readonly<Record<string, string>> = {
  PutObjectCommand: 'put_object',
  GetObjectCommand: 'get_object',
  HeadObjectCommand: 'head_object',
  HeadBucketCommand: 'head_bucket',
  DeleteObjectCommand: 'delete_object',
  ListObjectVersionsCommand: 'list_versions',
  GetPublicAccessBlockCommand: 'bucket_privacy',
  GetBucketPolicyStatusCommand: 'bucket_privacy',
};

/** SDK middleware observes the existing request, including its retries. No keys or URLs. */
export function instrumentStorage(client: S3Client, telemetry?: TelemetryService): void {
  if (!telemetry) return;
  client.middlewareStack.add(
    (next, context) => async (args) =>
      telemetry.callDependency('storage', OPERATIONS[context.commandName ?? ''] ?? 'other', () =>
        next(args),
      ),
    { step: 'initialize', name: 'hsmStorageTelemetry' },
  );
}
