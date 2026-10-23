import { Injectable } from '@nestjs/common';
import {
  unavailableMoneyPort,
  type MoneyCollectionAdapterPort,
  type MoneyCollectionCommand,
  type MoneyCollectionObservation,
  type MoneyTransportBinding,
} from '../../ports/collection.port';
import { isManualBinding } from './manual-rail.config';

/** Instructions/receipts initiate a workflow; they never observe a payment. */
@Injectable()
export class ManualCollectionAdapter implements MoneyCollectionAdapterPort {
  isConfigured(binding: MoneyTransportBinding): boolean {
    return isManualBinding(binding);
  }

  async createOrResume(command: MoneyCollectionCommand): Promise<MoneyCollectionObservation> {
    if (!this.isConfigured(command.binding)) throw unavailableMoneyPort('METHOD_DISABLED');
    return { status: 'PENDING', externalOperationId: command.externalOperationId };
  }

  async validateAndNormalizeExternalEvent(): Promise<never> {
    throw unavailableMoneyPort('MANUAL_RAIL_HAS_NO_WEBHOOK');
  }
}
