import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AddressListResponse, AddressSummary } from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

// /v1/me/addresses — saved-address CRUD for the authenticated user.
//
// Every endpoint requires a valid session (JwtAuthGuard); mutating
// endpoints additionally require a CSRF token (CsrfGuard) so a stolen
// access cookie alone cannot drive writes from a hostile origin.
//
// `userId` is taken exclusively from the authenticated session via
// @CurrentUser — no endpoint accepts a userId from the wire. This is
// deliberate: the alternative is an IDOR vector.
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/addresses', version: '1' })
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@CurrentUser() user: AuthenticatedUser): Promise<AddressListResponse> {
    const items = await this.addresses.list(user.id);
    return { items };
  }

  @UseGuards(CsrfGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateAddressDto,
  ): Promise<AddressSummary> {
    return this.addresses.create(user.id, body);
  }

  @UseGuards(CsrfGuard)
  @Patch(':addressId')
  @HttpCode(HttpStatus.OK)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId') addressId: string,
    @Body() body: UpdateAddressDto,
  ): Promise<AddressSummary> {
    return this.addresses.update(user.id, addressId, body);
  }

  @UseGuards(CsrfGuard)
  @Delete(':addressId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId') addressId: string,
  ): Promise<void> {
    await this.addresses.remove(user.id, addressId);
  }

  @UseGuards(CsrfGuard)
  @Post(':addressId/default')
  @HttpCode(HttpStatus.OK)
  setDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId') addressId: string,
  ): Promise<AddressSummary> {
    return this.addresses.setDefault(user.id, addressId);
  }
}
