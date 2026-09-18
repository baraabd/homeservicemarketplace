import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const integration = process.env.RUN_RETENTION_INTEGRATION === '1' ? describe : describe.skip;
integration('12B opt-in deployment configuration (parse only, never deploy)', () => {
  it('parses the actual Compose manifest and preserves its private worker boundaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hsm-retention-compose-'));
    try {
      const envFile = join(root, 'parse-only.env');
      await writeFile(envFile, '# Synthetic parse-only configuration; no production values.\n');
      const checked = spawnSync(
        'docker',
        [
          'compose',
          '-f',
          join(__dirname, '../../../../infra/docker/docker-compose.evidence-retention.yml'),
          '--profile',
          'evidence-retention',
          'config',
          '--format',
          'json',
        ],
        {
          env: {
            ...process.env,
            EVIDENCE_RETENTION_ENV_FILE: envFile,
            EVIDENCE_RETENTION_MODE: 'shadow',
            HSM_API_IMAGE: `example.invalid/hsm-api@sha256:${'0'.repeat(64)}`,
            HSM_PRIVATE_NETWORK: 'retention-test-private',
          },
          encoding: 'utf8',
          timeout: 15000,
        },
      );
      expect(checked.error).toBeUndefined();
      expect(checked.status).toBe(0);
      const worker = JSON.parse(checked.stdout).services['evidence-retention'];
      expect(worker.tmpfs).toEqual(['/tmp:rw,noexec,nosuid,size=16m']);
      expect(worker.read_only).toBe(true);
      expect(worker.cap_drop).toContain('ALL');
      expect(worker.ports).toBeUndefined();
      expect(worker.command).toEqual(['node', 'dist/evidence-retention.worker.js']);
      expect(worker.environment.EVIDENCE_RETENTION_MODE).toBe('shadow');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
