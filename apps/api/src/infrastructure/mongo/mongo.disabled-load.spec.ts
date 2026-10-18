import type { AppConfigService } from '../../config/app-config.service';

describe('optional Mongo driver loading', () => {
  afterEach(() => jest.dontMock('mongoose'));

  it('resolves both disabled model providers without importing mongoose or its schemas', async () => {
    await jest.isolateModulesAsync(async () => {
      const loaded = jest.fn(() => {
        throw new Error('disabled driver was imported');
      });
      jest.doMock('mongoose', loaded);
      const { MongoService } = await import('./mongo.service');
      const { mongoModelProviders } = await import('./mongo.providers');
      const config = { get: () => false } as unknown as AppConfigService;
      const service = new MongoService(config);
      await service.onModuleInit();
      expect(
        await Promise.all(mongoModelProviders.map((provider) => provider.useFactory(service))),
      ).toEqual([null, null]);
      await expect(service.connect()).rejects.toThrow('MongoDB is disabled');
      expect(loaded).not.toHaveBeenCalled();
    });
  });

  it('rejects enabled but unconfigured Mongo before loading the driver', async () => {
    await jest.isolateModulesAsync(async () => {
      const loaded = jest.fn(() => {
        throw new Error('unconfigured driver was imported');
      });
      jest.doMock('mongoose', loaded);
      const { MongoService } = await import('./mongo.service');
      const config = {
        get: (key: string) => (key === 'MONGODB_ENABLED' ? true : undefined),
      } as unknown as AppConfigService;
      await expect(new MongoService(config).connect()).rejects.toThrow(
        'MongoDB URI is not defined',
      );
      expect(loaded).not.toHaveBeenCalled();
    });
  });
});
