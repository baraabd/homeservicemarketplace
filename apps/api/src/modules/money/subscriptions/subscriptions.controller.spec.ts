import 'reflect-metadata';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { PermissionsGuard } from '../../iam/authorization/guards/permissions.guard';
import {
  MyPlanQueryDto,
  PlanCatalogQueryDto,
  SubscriptionsController,
} from './subscriptions.controller';

describe('R31 read endpoint boundary', () => {
  it('exposes only authenticated guarded read operations', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SubscriptionsController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PATH_METADATA, SubscriptionsController)).toBe('money');
    for (const name of ['listPlans', 'myPlan'] as const) {
      expect(Reflect.getMetadata(METHOD_METADATA, SubscriptionsController.prototype[name])).toBe(
        RequestMethod.GET,
      );
    }
    expect(Object.getOwnPropertyNames(SubscriptionsController.prototype).sort()).toEqual([
      'constructor',
      'listPlans',
      'myPlan',
    ]);
  });

  it('rejects forged ownership, unbounded pages and malformed selected subscription', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform({ limit: '51' }, { type: 'query', metatype: PlanCatalogQueryDto }),
    ).rejects.toThrow();
    await expect(
      pipe.transform({ providerProfileId: 'other' }, { type: 'query', metatype: MyPlanQueryDto }),
    ).rejects.toThrow();
    await expect(
      pipe.transform({ subscriptionId: 'bad/id' }, { type: 'query', metatype: MyPlanQueryDto }),
    ).rejects.toThrow();
    await expect(
      pipe.transform(
        { subscriptionId: 'owned_subscription' },
        { type: 'query', metatype: MyPlanQueryDto },
      ),
    ).resolves.toMatchObject({ subscriptionId: 'owned_subscription' });
  });
});
