import 'reflect-metadata';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  VERSION_METADATA,
} from '@nestjs/common/constants';
import { MONEY_CONTRACT_VERSION } from '@homeservicemarketplace/contracts';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { PERMISSIONS_KEY } from '../../iam/authorization/decorators/permissions.decorator';
import { ROLES_KEY } from '../../iam/authorization/decorators/roles.decorator';
import { PermissionsGuard } from '../../iam/authorization/guards/permissions.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import type { RefundRecoveryService } from '../recovery/refund-recovery.service';
import { RefundController, RefundRecoveryDto, RefundRecoveryScopeDto } from './refund.controller';

const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const body = {
  contractVersion: MONEY_CONTRACT_VERSION,
  paymentConfirmationId: 'confirmation-r32',
  expectedStateRevision: 'a'.repeat(64),
  operation: 'QUERY',
};

describe('R32 private recovery HTTP boundary', () => {
  it('requires existing JWT, admin and fresh permission guards for both routes', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RefundController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, RefundController)).toEqual(['admin']);
    expect(Reflect.getMetadata(VERSION_METADATA, RefundController)).toBe('1');
    expect(Reflect.getMetadata(PATH_METADATA, RefundController)).toBe('money/review/refunds');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, RefundController.prototype.inspect)).toEqual([
      'money:review:read',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, RefundController.prototype.replay)).toEqual([
      'money:refund:review',
    ]);
    expect(Reflect.getMetadata(METHOD_METADATA, RefundController.prototype.replay)).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, RefundController.prototype.replay)).toContain(
      CsrfGuard,
    );
  });

  it('exposes only inspection and scoped recovery, never raw confirmation or reservation release', () => {
    expect(Object.getOwnPropertyNames(RefundController.prototype).sort()).toEqual([
      'constructor',
      'inspect',
      'replay',
    ]);
  });

  it.each([
    'actorUserId',
    'externalRefundId',
    'accountReference',
    'providerIdempotencyKey',
    'status',
    'amount',
    'releaseReservation',
  ])('rejects caller-supplied authority %s', async (field) => {
    await expect(
      pipe.transform({ ...body, [field]: 'forged' }, { type: 'body', metatype: RefundRecoveryDto }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    { contractVersion: 'hsm.money.v0' },
    { expectedStateRevision: '' },
    { expectedStateRevision: 'a'.repeat(63) },
    { operation: 'CANCEL' },
    { paymentConfirmationId: '../id' },
    { dryRun: 'false' },
    { approvalReference: 'unsafe\nheader' },
    { approvalReference: 'a'.repeat(129) },
  ])('refuses malformed recovery DTO %#', async (extra) => {
    await expect(
      pipe.transform({ ...body, ...extra }, { type: 'body', metatype: RefundRecoveryDto }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('requires a payment scope for inspection and refuses additional query authority', async () => {
    await expect(
      pipe.transform({}, { type: 'query', metatype: RefundRecoveryScopeDto }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform(
        { paymentConfirmationId: 'confirmation-r32', actorUserId: 'forged' },
        { type: 'query', metatype: RefundRecoveryScopeDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('does not coerce a missing dry-run flag into execution', async () => {
    const result = await pipe.transform(body, { type: 'body', metatype: RefundRecoveryDto });
    expect(result.dryRun).toBeUndefined();
  });

  it('always obtains actor identity from the authenticated session and preserves the command key', async () => {
    const recovery = { inspect: jest.fn(), replay: jest.fn() };
    const controller = new RefundController(recovery as unknown as RefundRecoveryService);
    const user = { id: 'session-admin', roles: ['admin'] } as AuthenticatedUser;
    controller.inspect(user, 'refund-r32', { paymentConfirmationId: 'confirmation-r32' });
    controller.replay(user, 'r32_recovery_command_0001', 'refund-r32', body as RefundRecoveryDto);
    expect(recovery.inspect).toHaveBeenCalledWith(
      'session-admin',
      'refund-r32',
      'confirmation-r32',
    );
    expect(recovery.replay).toHaveBeenCalledWith(
      'session-admin',
      'r32_recovery_command_0001',
      'refund-r32',
      body,
    );
  });
});
