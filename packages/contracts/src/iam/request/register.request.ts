import type { LegalAcceptanceInput } from '../legal/legal-documents';

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /**
   * K02 — the exact Terms and Privacy versions the user ticked the consent
   * box for. Required; the server records them with its own timestamp.
   */
  legalAcceptance: LegalAcceptanceInput;
}
