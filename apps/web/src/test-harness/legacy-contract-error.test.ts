import { describe, expect, it } from 'vitest';
import { isLegacyContractModuleError } from '../../startup-tests/legacy-contract-error';

const error = (module: string, name: string) =>
  `The requested module '${module}' does not provide an export named '${name}'`;

describe('legacy contracts CommonJS negative control', () => {
  it.each(['LEGACY_PUBLICATION_ACK_TEXT', 'DISPUTE_WORKSPACE_STATES'])(
    'recognizes %s regardless of which Admin import links first',
    (name) => {
      expect(
        isLegacyContractModuleError(error('/@fs/D:/a/repo/packages/contracts/dist/index.js', name)),
      ).toBe(true);
      expect(
        isLegacyContractModuleError(
          error('/@fs/home/runner/repo/packages/contracts/dist/index.js', name),
        ),
      ).toBe(true);
    },
  );

  it('rejects an unrelated module even if it has the same missing export', () => {
    expect(isLegacyContractModuleError(error('/src/index.js', 'LEGACY_PUBLICATION_ACK_TEXT'))).toBe(
      false,
    );
    expect(
      isLegacyContractModuleError(
        error('/packages/contracts/src/index.ts', 'LEGACY_PUBLICATION_ACK_TEXT'),
      ),
    ).toBe(false);
  });

  it('rejects an unknown export and generic navigation or runtime errors', () => {
    expect(isLegacyContractModuleError(error('/packages/contracts/dist/index.js', 'UNKNOWN'))).toBe(
      false,
    );
    expect(isLegacyContractModuleError('Timeout 30000ms exceeded')).toBe(false);
    expect(
      isLegacyContractModuleError('ReferenceError: LEGACY_PUBLICATION_ACK_TEXT is not defined'),
    ).toBe(false);
  });
});
