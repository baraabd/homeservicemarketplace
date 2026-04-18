// Outbound-mail boundary. IAM services depend on this port, not on a concrete
// adapter. The default adapter (in-memory) is safe for dev/test; a real SMTP
// or transactional-email provider adapter ships in a later phase.

export interface MailMessage {
  to: string;
  subject: string;
  // Plain-text body only for now; templated HTML is deferred to the real
  // adapter. Anything templated goes through a designated template engine;
  // raw string interpolation with user input is never acceptable here.
  text: string;
}

export abstract class MailPort {
  abstract send(message: MailMessage): Promise<void>;
}

export const MAIL_PORT = Symbol.for('IAM_MAIL_PORT');
