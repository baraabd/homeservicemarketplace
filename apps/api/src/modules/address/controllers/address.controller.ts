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
import type { AddressDto, AddressListResponse } from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { CreateAddressDto } from '../dto/create-address.dto';
import { UpdateAddressDto } from '../dto/update-address.dto';
import { AddressService } from '../services/address.service';

@UseGuards(JwtAuthGuard)
@Controller({ path: 'addresses', version: '1' })
export class AddressController {
  constructor(private readonly addresses: AddressService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<AddressListResponse> {
    const items = await this.addresses.list(user.id);
    return { items };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateAddressDto,
  ): Promise<AddressDto> {
    return this.addresses.create(user.id, body);
  }

  @Patch(':addressId')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId') addressId: string,
    @Body() body: UpdateAddressDto,
  ): Promise<AddressDto> {
    return this.addresses.update(user.id, addressId, body);
  }

  @Delete(':addressId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId') addressId: string,
  ): Promise<void> {
    await this.addresses.remove(user.id, addressId);
  }

  @Post(':addressId/set-default')
  @HttpCode(HttpStatus.OK)
  async setDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId') addressId: string,
  ): Promise<AddressDto> {
    return this.addresses.setDefault(user.id, addressId);
  }
}
