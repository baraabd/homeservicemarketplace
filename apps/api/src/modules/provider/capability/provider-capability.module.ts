import { Module } from '@nestjs/common';

import { ProviderCapabilityService } from './provider-capability.service';
import { ProviderActiveGuard } from '../guards/provider-active.guard';

// Sprint 7 — the one owner of the provider authorization gate.
//
// This module exists because of a boot crash. `ProviderActiveGuard` was
// declared TWICE — once in ProviderModule and once, locally, in
// ConversationsModule, whose comment recorded the reasoning at the time:
//
//     "The guard's only dependency (ProviderProfileRepository) is provided
//      globally by PersistenceModule, so we avoid importing ProviderModule
//      and the circular-dependency risk that would come with it."
//
// That was true, and Sprint 7 silently invalidated it. Giving the guard a
// dependency on ProviderCapabilityService — which is NOT global — left
// ConversationsModule holding a copy of a guard it could no longer construct,
// and Nest failed the whole application at boot:
//
//     Nest can't resolve dependencies of the ProviderActiveGuard (?).
//     ... ProviderCapabilityService ... available in the ConversationsModule
//
// A second local declaration of a provider is a promise that its dependency
// graph will never change. Nobody can keep that promise, so the fix is to
// remove the duplication rather than to chase imports: the guard and the
// service it needs live together, here, and every consumer imports THIS.
//
// Deliberately NOT @Global. Cross-cutting infrastructure (Prisma, persistence,
// outbox) is global in this codebase because everything needs it; an
// AUTHORIZATION gate is different. An explicit import is a readable statement
// that a module gates on provider capability, and `grep -l
// ProviderCapabilityModule` answers "what is behind this gate?" — which a
// global provider would silently erase.
//
// It depends only on globally-provided infrastructure — PrismaService
// (PrismaModule) and, since Sprint 9, AppConfigService (ConfigModule is
// @Global) for the WORK_ACCESS_ENFORCED / VERIFICATION_ENFORCED rollout flags.
// It has no domain-module dependency, so importing it cannot create a cycle.
// That is what makes it safe to import from ConversationsModule, which is
// exactly what the original comment was trying to avoid.
//
// Keep it that way. The moment this service needs something from a domain
// module, the boot crash described above comes back.
@Module({
  providers: [ProviderCapabilityService, ProviderActiveGuard],
  exports: [ProviderCapabilityService, ProviderActiveGuard],
})
export class ProviderCapabilityModule {}
