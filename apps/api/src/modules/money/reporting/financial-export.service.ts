import { Injectable } from '@nestjs/common';
import type { FinancialRecordsQueryV1 } from '@homeservicemarketplace/contracts';

import { AppError } from '../../../shared/errors/app-error';
import { FinancialReportService } from './financial-report.service';

/** Bounded, current-page export. A CSV export performs the same fresh admin
 * authorization as a page read. No evidence URLs, account details, email,
 * internal notes, external rail payloads or receipt identifiers are selected.
 */
@Injectable()
export class FinancialExportService {
  constructor(private readonly reports: FinancialReportService) {}

  async export(userId: string, input: FinancialRecordsQueryV1 = {}) {
    const page = await this.reports.records(userId, 'ADMIN', input);
    if (page.availability.state !== 'AVAILABLE') {
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'This financial export is unavailable.', 503, {
        reason: page.availability.reason,
      });
    }
    const lines = [
      [
        'record_id',
        'kind',
        'status',
        'confirmation_state',
        'amount_meaning',
        'amount_minor',
        'currency',
        'created_at',
        'public_reason_code',
      ],
      ...page.items.map((record) => [
        record.id,
        record.kind,
        record.status,
        record.confirmationState,
        record.amountMeaning,
        record.amount?.amountMinor ?? '',
        record.amount?.currency ?? '',
        record.createdAt,
        record.publicReasonCode ?? '',
      ]),
    ];
    return {
      bytes: Buffer.from(
        '\uFEFF' + lines.map((line) => line.map(csvCell).join(',')).join('\r\n') + '\r\n',
        'utf8',
      ),
      count: page.items.length,
      hasMore: page.nextCursor !== null,
    };
  }
}

/** Quote every cell, remove control characters and neutralize formula prefixes
 * after optional whitespace. Quotes alone do not prevent spreadsheet formulas.
 * A leading apostrophe also preserves long integer text in spreadsheet import.
 */
export function csvCell(value: string): string {
  const clean = value.replace(/[\p{Cc}\p{Cf}]/gu, ' ');
  const text = /^\s*[=+@-]/u.test(clean) || /^\d{16,}$/u.test(clean) ? `'${clean}` : clean;
  return `"${text.replaceAll('"', '""')}"`;
}
