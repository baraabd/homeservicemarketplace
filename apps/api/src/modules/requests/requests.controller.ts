import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  ServiceRequestDetail,
  ServiceRequestListResponse,
  ServiceRequestSummary,
  ServiceRequestTimelineResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { ListServiceRequestsQueryDto } from './dto/list-service-requests.query';
import { UpdateServiceRequestDto } from './dto/update-service-request.dto';
import { RequestsService } from './requests.service';

// /v1/me/requests — service-request lifecycle for the authenticated
// Seeker.
//
// Every endpoint requires a valid session (JwtAuthGuard); mutating
// endpoints additionally require a CSRF token (CsrfGuard) so a stolen
// access cookie alone cannot drive writes from a hostile origin.
//
// `seekerUserId` is sourced exclusively from the authenticated session
// via @CurrentUser — no endpoint accepts it from the wire. The request
// DTOs do not declare it either; the global ValidationPipe's
// forbidNonWhitelisted: true rejects payloads that try to smuggle one
// in.
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/requests', version: '1' })
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListServiceRequestsQueryDto,
  ): Promise<ServiceRequestListResponse> {
    return this.requests.list(user.id, query);
  }

  @UseGuards(CsrfGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateServiceRequestDto,
  ): Promise<ServiceRequestSummary> {
    return this.requests.create(user.id, body);
  }

  @Get(':requestId')
  @HttpCode(HttpStatus.OK)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
  ): Promise<ServiceRequestDetail> {
    return this.requests.detail(user.id, requestId);
  }

  @UseGuards(CsrfGuard)
  @Patch(':requestId')
  @HttpCode(HttpStatus.OK)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Body() body: UpdateServiceRequestDto,
  ): Promise<ServiceRequestDetail> {
    return this.requests.update(user.id, requestId, body);
  }

  @UseGuards(CsrfGuard)
  @Post(':requestId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
  ): Promise<ServiceRequestDetail> {
    return this.requests.cancel(user.id, requestId);
  }

  @UseGuards(CsrfGuard)
  @Post(':requestId/reopen')
  @HttpCode(HttpStatus.OK)
  reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
  ): Promise<ServiceRequestDetail> {
    return this.requests.reopen(user.id, requestId);
  }

  @Get(':requestId/timeline')
  @HttpCode(HttpStatus.OK)
  timeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
  ): Promise<ServiceRequestTimelineResponse> {
    return this.requests.timeline(user.id, requestId);
  }
}
