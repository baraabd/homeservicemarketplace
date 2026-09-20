import { WorkspacePreferences } from './workspace-preferences.service';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { DisputePrivacyInterceptor } from '../dispute-privacy.interceptor';
import { DisputeWorkspaceService } from './workspace.service';
import { WorkspaceCommands } from './workspace-commands.service';
import { WorkspaceDrafts } from './workspace-drafts.service';
import {
  WorkspaceEvidence,
  DISPUTE_FILE_MAX_BYTES,
  type CaseUpload,
} from './workspace-evidence.service';

@Controller({ path: 'me/disputes', version: '1' })
@UseGuards(JwtAuthGuard)
@UseInterceptors(DisputePrivacyInterceptor)
export class DisputeWorkspaceController {
  constructor(
    private readonly cases: DisputeWorkspaceService,
    private readonly commands: WorkspaceCommands,
    private readonly drafts: WorkspaceDrafts,
    private readonly evidence: WorkspaceEvidence,
    private readonly preferences: WorkspacePreferences,
  ) {}
  @Get('preferences/notifications')
  @Header('Cache-Control', 'private, no-store')
  preferencesRead(@CurrentUser() user: AuthenticatedUser) {
    return this.preferences.read(user.id);
  }
  @Post('preferences/notifications')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Header('Cache-Control', 'private, no-store')
  preferencesSave(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.preferences.save(user.id, body);
  }
  @Get('drafts/:bookingId')
  @Header('Cache-Control', 'private, no-store')
  draft(@CurrentUser() user: AuthenticatedUser, @Param('bookingId') id: string) {
    return this.drafts.read(user.id, id);
  }
  @Post('drafts/:bookingId')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId') id: string,
    @Body() body: unknown,
  ) {
    return this.drafts.save(user.id, id, body);
  }
  @Post(':id/workspace/open')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Header('Cache-Control', 'private, no-store')
  open(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.cases.open(user.id, id);
  }
  @Get(':id/workspace')
  @Header('Cache-Control', 'private, no-store')
  view(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.cases.view(user.id, id);
  }
  @Get(':id/workspace/history')
  @Header('Cache-Control', 'private, no-store')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('before') before?: string,
  ) {
    return this.cases.history(user.id, id, before);
  }
  @Post(':id/workspace/commands')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  command(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    return this.commands.execute(user.id, id, body);
  }
  @Post(':id/workspace/evidence')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: DISPUTE_FILE_MAX_BYTES, files: 1, fields: 2, parts: 3 },
    }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @UploadedFile() file: CaseUpload | undefined,
  ) {
    return this.evidence.upload(user.id, id, body, file);
  }
  @Get(':id/workspace/evidence/:evidenceId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.evidence.read(user.id, id, evidenceId);
    res.setHeader('Content-Disposition', 'attachment; filename="case-evidence"');
    return new StreamableFile(result.bytes, { type: result.mimeType, length: result.bytes.length });
  }
}

/** No role-only shortcut: every action resolves its individual permission afresh. */
@Controller({ path: 'admin/dispute-workspaces', version: '1' })
@UseGuards(JwtAuthGuard)
@UseInterceptors(DisputePrivacyInterceptor)
export class AdminDisputeWorkspaceController {
  constructor(
    private readonly cases: DisputeWorkspaceService,
    private readonly commands: WorkspaceCommands,
    private readonly evidence: WorkspaceEvidence,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  queue(
    @CurrentUser() user: AuthenticatedUser,
    @Query('state') state?: string,
    @Query('cursor') cursor?: string,
    @Query('mine') mine?: string,
  ) {
    return this.cases.queue(user.id, { state, cursor, mine: mine === 'true' });
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  view(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.cases.view(user.id, id, true);
  }
  @Get(':id/history')
  @Header('Cache-Control', 'private, no-store')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('before') before?: string,
  ) {
    return this.cases.history(user.id, id, before, true);
  }
  @Post(':id/commands')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  command(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    return this.commands.execute(user.id, id, body, true);
  }
  @Post(':id/evidence')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: DISPUTE_FILE_MAX_BYTES, files: 1, fields: 2, parts: 3 },
    }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @UploadedFile() file: CaseUpload | undefined,
  ) {
    return this.evidence.upload(user.id, id, body, file, true);
  }
  @Get(':id/evidence/:evidenceId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.evidence.read(user.id, id, evidenceId, true);
    res.setHeader('Content-Disposition', 'attachment; filename="case-evidence"');
    return new StreamableFile(result.bytes, { type: result.mimeType, length: result.bytes.length });
  }
}
