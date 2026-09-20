import { WorkspacePreferences } from './workspace/workspace-preferences.service';
import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { DisputeIntakeController } from './dispute-intake.controller';
import { DisputeIntakeRepository } from './dispute-intake.repository';
import { DisputeIntakeService } from './dispute-intake.service';
import { DisputeIntakeEventsHandler } from './dispute-intake.events-handler';

import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { ProviderVerificationModule } from '../provider/verification/provider-verification.module';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import {
  DisputeWorkspaceController,
  AdminDisputeWorkspaceController,
} from './workspace/workspace.controller';
import { WorkspaceRepository } from './workspace/workspace.repository';
import { WorkspaceCipher } from './workspace/workspace-cipher.service';
import { WorkspaceEvents } from './workspace/workspace-events.service';
import { WorkspaceEventsHandler } from './workspace/workspace-events.handler';
import { WorkspaceRequests } from './workspace/workspace-requests.service';
import { WorkspaceResolution } from './workspace/workspace-resolution.service';
import { WorkspaceAppeals } from './workspace/workspace-appeals.service';
import { WorkspaceCommands } from './workspace/workspace-commands.service';
import { WorkspaceDrafts } from './workspace/workspace-drafts.service';
import { WorkspaceEvidence } from './workspace/workspace-evidence.service';
import { DisputeWorkspaceService } from './workspace/workspace.service';
@Module({
  imports: [AuthenticationModule, AuthorizationModule, StorageModule, ProviderVerificationModule],
  controllers: [
    DisputeWorkspaceController,
    AdminDisputeWorkspaceController,
    DisputeIntakeController,
  ],
  providers: [
    WorkspacePreferences,
    WorkspaceRepository,
    WorkspaceCipher,
    WorkspaceEvents,
    WorkspaceEventsHandler,
    WorkspaceRequests,
    WorkspaceResolution,
    WorkspaceAppeals,
    WorkspaceCommands,
    WorkspaceDrafts,
    WorkspaceEvidence,
    DisputeWorkspaceService,
    DisputeIntakeRepository,
    DisputeIntakeService,
    DisputeIntakeEventsHandler,
  ],
  exports: [DisputeIntakeEventsHandler, WorkspaceEventsHandler],
})
export class DisputesModule {}
