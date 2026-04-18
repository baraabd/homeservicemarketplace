import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'iam:permissions';
export const Permissions = (...keys: string[]) => SetMetadata(PERMISSIONS_KEY, keys);
