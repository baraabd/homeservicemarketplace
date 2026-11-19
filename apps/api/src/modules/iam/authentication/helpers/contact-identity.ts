import { BadRequestException } from '@nestjs/common';
import type { User } from '@homeservicemarketplace/database';
import type { OtpDeliveryBinding } from '../services/otp.service';

export interface ContactIdentityInput {
  email?: string;
  phoneNumber?: string;
}

/** Exactly one canonical contact owns a credential attempt and its abuse budget. */
export function contactIdentity(input: ContactIdentityInput): OtpDeliveryBinding {
  const hasEmail = typeof input.email === 'string';
  const hasPhone = typeof input.phoneNumber === 'string';
  if (hasEmail === hasPhone) throw new BadRequestException({ code: 'VALIDATION_ERROR' });
  if (hasPhone) {
    const destination = input.phoneNumber!;
    if (!/^\+[1-9][0-9]{6,14}$/.test(destination)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    }
    return { channel: 'whatsapp', destination };
  }
  const destination = input.email!.trim().toLowerCase();
  if (!destination || destination.length > 254)
    throw new BadRequestException({ code: 'VALIDATION_ERROR' });
  return { channel: 'email', destination };
}

export function ownsContact(user: User, contact: OtpDeliveryBinding): boolean {
  return contact.channel === 'whatsapp'
    ? user.phoneNumber === contact.destination
    : user.email === contact.destination;
}

export function hasVerifiedContact(user: User, contact: OtpDeliveryBinding): boolean {
  return (
    ownsContact(user, contact) &&
    Boolean(contact.channel === 'whatsapp' ? user.phoneVerifiedAt : user.emailVerifiedAt)
  );
}

export function maskContact(contact: OtpDeliveryBinding): string {
  if (contact.channel === 'whatsapp')
    return `${contact.destination.slice(0, 3)}••••${contact.destination.slice(-3)}`;
  const [name, domain] = contact.destination.split('@');
  return `${name?.slice(0, 1)}•••@${domain ?? ''}`;
}
