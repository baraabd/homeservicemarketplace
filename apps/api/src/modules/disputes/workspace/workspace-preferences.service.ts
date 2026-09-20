import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppError } from '../../../shared/errors/app-error';
const preference = z.object({ enabled: z.boolean(), language: z.enum(['en', 'ar']) }).strict();
@Injectable()
export class WorkspacePreferences {
  constructor(private readonly prisma: PrismaService) {}
  async read(userId: string) {
    const row = await this.prisma.client.disputeNotificationPreference.findUnique({
      where: { userId },
    });
    return { enabled: row?.enabled ?? true, language: row?.language === 'ar' ? 'ar' : 'en' };
  }
  async save(userId: string, raw: unknown) {
    const p = preference.safeParse(raw);
    if (!p.success) throw new AppError('VALIDATION_ERROR', 'Invalid notification preference.', 400);
    await this.prisma.client.disputeNotificationPreference.upsert({
      where: { userId },
      create: { userId, ...p.data },
      update: p.data,
    });
    return p.data;
  }
}
