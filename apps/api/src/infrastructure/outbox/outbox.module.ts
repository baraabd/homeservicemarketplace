import { Global, Module, type Provider, type Type } from '@nestjs/common';

import { OutboxCleanupJob } from './outbox-cleanup.job';
import { OutboxRepository } from './outbox.repository';
import { OUTBOX_HANDLERS } from './outbox.tokens';
import { OutboxWorker } from './outbox.worker';
import type { OutboxHandler } from './outbox.handler';

/** Handler classes contributed by domain modules.
 *
 *  Registered here rather than discovered, because the alternative — the
 *  worker importing every module that produces events — inverts the
 *  dependency: infrastructure would depend on the domain modules that depend
 *  on it. This list is the one place that knows the full set, and a handler
 *  missing from it dead-letters its events loudly rather than failing
 *  silently (see OutboxWorker.processEvent).
 *
 *  Populated by `OutboxModule.forRoot()` from the app module, which is the
 *  only place allowed to import across domains. */
export interface OutboxModuleOptions {
  handlers: Array<Type<OutboxHandler>>;
  /** Modules that provide those handlers, so Nest can resolve them. */
  imports?: Array<Type<unknown>>;
}

// Sprint 6 — transactional outbox. docs/adr/0004-transactional-outbox.md
//
// @Global so OutboxRepository is injectable from any domain service that needs
// to enqueue inside its own transaction — matching how PersistenceModule
// exposes repositories. Producing an event must be as easy as writing a row,
// or people will go back to firing side effects inline.
@Global()
@Module({
  providers: [OutboxRepository],
  exports: [OutboxRepository],
})
export class OutboxModule {
  static forRoot(options: OutboxModuleOptions) {
    const handlerProviders: Provider[] = [...options.handlers];

    return {
      module: OutboxModule,
      imports: options.imports ?? [],
      providers: [
        OutboxRepository,
        ...handlerProviders,
        {
          provide: OUTBOX_HANDLERS,
          inject: options.handlers,
          useFactory: (...handlers: OutboxHandler[]) => handlers,
        },
        OutboxWorker,
        OutboxCleanupJob,
      ],
      exports: [OutboxRepository, OutboxWorker, OutboxCleanupJob],
    };
  }
}
