import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Permissions } from '../../iam/authorization/decorators/permissions.decorator';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { PermissionsGuard } from '../../iam/authorization/guards/permissions.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { StripeSessionService } from './stripe-session.service';
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('provider')
@Controller({ path: 'money/stripe', version: '1' })
export class StripeSessionController {
  constructor(private readonly sessions: StripeSessionService) {}
  @Get('attempts/:id/session')
  @Permissions('money:purchase:self')
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  @Header('Referrer-Policy', 'no-referrer')
  session(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sessions.session(user.id, id);
  }
}
