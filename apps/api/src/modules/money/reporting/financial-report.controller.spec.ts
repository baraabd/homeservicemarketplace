import 'reflect-metadata';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  METHOD_METADATA,
  VERSION_METADATA,
} from '@nestjs/common/constants';

import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { PERMISSIONS_KEY } from '../../iam/authorization/decorators/permissions.decorator';
import { PermissionsGuard } from '../../iam/authorization/guards/permissions.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import {
  FinancialPageDto,
  FinancialRecordsDto,
  FinancialReportController,
  FinancialSummaryDto,
  ProviderFinancialHistoryController,
} from './financial-report.controller';

const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });

describe('R33 HTTP authority and bounded query contracts', () => {
  it.each([FinancialReportController, ProviderFinancialHistoryController])(
    'keeps every %s route read-only, guarded and private',
    (controller) => {
      expect(Reflect.getMetadata(VERSION_METADATA, controller)).toBe('1');
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
        JwtAuthGuard,
        RolesGuard,
        PermissionsGuard,
      ]);
      for (const name of Object.getOwnPropertyNames(controller.prototype).filter(
        (name) => name !== 'constructor',
      )) {
        const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)!
          .value as object;
        expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
        expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
          controller === FinancialReportController ? 'money:review:read' : 'money:read:self',
        ]);
        expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toContainEqual({
          name: 'Cache-Control',
          value: 'private, no-store',
        });
      }
    },
  );
  it.each([0, 51, -1, 1.5, 'NaN', 'Infinity'])(
    'refuses invalid list/export limit %s',
    async (limit) => {
      await expect(
        pipe.transform({ limit }, { type: 'query', metatype: FinancialRecordsDto }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it.each([
    'providerProfileId',
    'userId',
    'amount',
    'status',
    'receiptMediaAssetId',
    'internalNote',
  ])('refuses client authority or undeclared filter %s', async (key) => {
    await expect(
      pipe.transform({ [key]: 'forged' }, { type: 'query', metatype: FinancialRecordsDto }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    { currency: 'usd' },
    { currency: ['USD', 'EUR'] },
    { kind: 'booking' },
    { kind: ['PAYMENT'] },
    { cursor: '++invalid==' },
  ])('rejects malformed selectors %#', async (input) => {
    await expect(
      pipe.transform(input, { type: 'query', metatype: FinancialRecordsDto }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('accepts exact bounded selectors without inventing a default currency', async () => {
    expect(
      await pipe.transform(
        { kind: 'REFUND', limit: '50', currency: 'XTS' },
        { type: 'query', metatype: FinancialRecordsDto },
      ),
    ).toMatchObject({ kind: 'REFUND', limit: 50, currency: 'XTS' });
    expect(await pipe.transform({}, { type: 'query', metatype: FinancialSummaryDto })).toEqual({});
  });
  it('refuses a misleading currency filter for heterogeneous reconciliation subjects', async () => {
    await expect(
      pipe.transform({ currency: 'XTS' }, { type: 'query', metatype: FinancialPageDto }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('takes actor and audience from server context only', async () => {
    const reports = {
      records: jest.fn(),
      detail: jest.fn(),
      summary: jest.fn(),
      reconciliation: jest.fn(),
      exception: jest.fn(),
    };
    const admin = new FinancialReportController(reports as never, {} as never);
    const provider = new ProviderFinancialHistoryController(reports as never);
    const user = { id: 'actor', roles: ['provider'], sessionId: 'session', jti: 'jti' };
    const query = new FinancialRecordsDto();
    admin.records(user, query);
    provider.records(user, query);
    provider.detail(user, 'PAYMENT', 'id');
    expect(reports.records.mock.calls).toEqual([
      ['actor', 'ADMIN', query],
      ['actor', 'PROVIDER', query],
    ]);
    expect(reports.detail).toHaveBeenCalledWith('actor', 'PROVIDER', 'PAYMENT', 'id');
  });
  it('returns CSV as a private download and explicitly identifies truncation', async () => {
    const exports = {
      export: jest.fn().mockResolvedValue({ bytes: Buffer.from('csv'), hasMore: true, count: 50 }),
    };
    const response = { setHeader: jest.fn() };
    const controller = new FinancialReportController({} as never, exports as never);
    const result = await controller.export(
      { id: 'actor' } as never,
      new FinancialRecordsDto(),
      response as never,
    );
    expect(response.setHeader).toHaveBeenCalledWith('X-Export-Has-More', 'true');
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="financial-operations.csv"',
    );
    expect(result.getHeaders().type).toBe('text/csv; charset=utf-8');
    expect(
      Reflect.getMetadata(HEADERS_METADATA, FinancialReportController.prototype.export),
    ).toContainEqual({
      name: 'Access-Control-Expose-Headers',
      value: 'Content-Disposition, X-Export-Has-More, X-Export-Row-Count',
    });
  });
});
