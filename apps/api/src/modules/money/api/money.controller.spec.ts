import 'reflect-metadata';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { MONEY_CONTRACT_VERSION } from '@homeservicemarketplace/contracts';

import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../iam/authorization/guards/permissions.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { PERMISSIONS_KEY } from '../../iam/authorization/decorators/permissions.decorator';
import type { MoneyCommandService } from '../application/money-command.service';
import type { MoneyQueryService } from '../application/money-query.service';
import {
  MoneyController,
  MoneyPageDto,
  MoneyPurchaseDto,
  MoneyReceiptDto,
  MoneyRefundRequestDto,
  MoneyReviewController,
  MoneyVersionDto,
} from './money.controller';

const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const purchase = {
  contractVersion: MONEY_CONTRACT_VERSION,
  planVersionId: 'plan-version-r24',
  method: 'STRIPE',
};
const actor: AuthenticatedUser = {
  id: 'current-user-r24',
  sessionId: 'session',
  jti: 'jti',
  roles: ['provider'],
};

describe('R24 HTTP authority and DTO boundary', () => {
  it.each([MoneyController, MoneyReviewController])(
    'keeps %s behind the existing session, role and permission guards',
    (controller) => {
      expect(Reflect.getMetadata(VERSION_METADATA, controller)).toBe('1');
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
        JwtAuthGuard,
        RolesGuard,
        PermissionsGuard,
      ]);
      const methods = Object.getOwnPropertyNames(controller.prototype).filter(
        (name) => name !== 'constructor',
      );
      let commands = 0;
      for (const name of methods) {
        const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)!
          .value as object;
        expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toHaveLength(1);
        if (Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.POST) {
          commands += 1;
          expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(CsrfGuard);
        }
      }
      expect(commands).toBeGreaterThan(0);
    },
  );

  it.each([
    'actorId',
    'userId',
    'providerProfileId',
    'accountId',
    'debitAccountId',
    'mode',
    'currency',
    'amountMinor',
    'total',
    'quote',
  ])('rejects client-supplied purchase authority %s', async (field) => {
    await expect(
      pipe.transform(
        { ...purchase, [field]: 'injected' },
        { type: 'body', metatype: MoneyPurchaseDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    { ...purchase, contractVersion: 'hsm.money.v2' },
    { ...purchase, method: 'UNKNOWN' },
    { ...purchase, planVersionId: '' },
    { ...purchase, planVersionId: 'x'.repeat(65) },
    { ...purchase, couponCode: 'x'.repeat(65) },
  ])('rejects an invalid version or purchase selector %#', async (body) => {
    await expect(
      pipe.transform(body, { type: 'body', metatype: MoneyPurchaseDto }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    [MoneyPurchaseDto, 'planVersionId', purchase],
    [
      MoneyRefundRequestDto,
      'paymentConfirmationId',
      {
        contractVersion: MONEY_CONTRACT_VERSION,
        amount: { amountMinor: '1', currency: 'XTS' },
        reasonCode: 'AB',
      },
    ],
    [
      MoneyReceiptDto,
      'paymentIntentId',
      {
        contractVersion: MONEY_CONTRACT_VERSION,
        receiptMediaAssetId: 'receipt-r24',
      },
    ],
    [
      MoneyReceiptDto,
      'receiptMediaAssetId',
      {
        contractVersion: MONEY_CONTRACT_VERSION,
        paymentIntentId: 'intent-r24',
      },
    ],
  ] as const)(
    'keeps %s %s at the application identifier boundary',
    async (metatype, field, body) => {
      await expect(
        pipe.transform({ ...body, [field]: 'a'.repeat(64) }, { type: 'body', metatype }),
      ).resolves.toMatchObject({ [field]: 'a'.repeat(64) });
      await expect(
        pipe.transform({ ...body, [field]: 'a'.repeat(65) }, { type: 'body', metatype }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it.each([
    {},
    { contractVersion: 'hsm.money.v0' },
    { contractVersion: MONEY_CONTRACT_VERSION, actorId: 'forged' },
  ])('validates version-only commands %#', async (body) => {
    await expect(
      pipe.transform(body, { type: 'body', metatype: MoneyVersionDto }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([0, 51, 1.5, 'NaN', -1])('rejects unbounded pagination limit %s', async (limit) => {
    await expect(
      pipe.transform({ limit }, { type: 'query', metatype: MoneyPageDto }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a bounded numeric query without accepting arbitrary owner filters', async () => {
    await expect(
      pipe.transform({ limit: '5' }, { type: 'query', metatype: MoneyPageDto }),
    ).resolves.toMatchObject({ limit: 5 });
    await expect(
      pipe.transform(
        { providerProfileId: 'another-provider' },
        { type: 'query', metatype: MoneyPageDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([1, '01', '-1', '1.0', '1e3', ' 1'])(
    'rejects noncanonical refund amount %p before the application call',
    async (amountMinor) => {
      await expect(
        pipe.transform(
          {
            contractVersion: MONEY_CONTRACT_VERSION,
            paymentConfirmationId: 'confirmation-r24',
            reasonCode: 'REQUESTED',
            amount: { amountMinor, currency: 'XTS' },
          },
          { type: 'body', metatype: MoneyRefundRequestDto },
        ),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it('takes actor identity only from the authenticated session and preserves large exact amounts', async () => {
    const commands = {
      quote: jest.fn().mockResolvedValue({}),
      requestRefund: jest.fn().mockResolvedValue({}),
    };
    const controller = new MoneyController(
      commands as unknown as MoneyCommandService,
      {} as MoneyQueryService,
    );
    await controller.quote(actor, 'r24_quote_key_00001', purchase as MoneyPurchaseDto);
    expect(commands.quote).toHaveBeenCalledWith(actor.id, 'r24_quote_key_00001', purchase);
    const body = (await pipe.transform(
      {
        contractVersion: MONEY_CONTRACT_VERSION,
        paymentConfirmationId: 'confirmation-r24',
        reasonCode: 'REQUESTED',
        amount: { amountMinor: '9007199254740993', currency: 'XTS' },
      },
      { type: 'body', metatype: MoneyRefundRequestDto },
    )) as MoneyRefundRequestDto;
    await controller.requestRefund(actor, 'r24_refund_key_0001', body);
    expect(commands.requestRefund.mock.calls[0]![2].amount).toEqual({
      amountMinor: '9007199254740993',
      currency: 'XTS',
    });
  });

  it('refuses a canonical-looking value beyond PostgreSQL BIGINT without rounding it', () => {
    const commands = { requestRefund: jest.fn() };
    const controller = new MoneyController(
      commands as unknown as MoneyCommandService,
      {} as MoneyQueryService,
    );
    expect(() =>
      controller.requestRefund(actor, 'r24_refund_key_0001', {
        contractVersion: MONEY_CONTRACT_VERSION,
        paymentConfirmationId: 'confirmation-r24',
        reasonCode: 'REQUESTED',
        amount: { amountMinor: '9223372036854775808', currency: 'XTS' },
      }),
    ).toThrow(expect.objectContaining({ status: 400, code: 'VALIDATION_ERROR' }));
    expect(commands.requestRefund).not.toHaveBeenCalled();
  });
});
