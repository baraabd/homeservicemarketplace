import type { OtpChannel } from '../../../lib/auth-channel';
import type { OtpRecoveryAction } from '../../../lib/auth-errors';
import type { AuthExperience } from '../../../lib/auth-experience';

export interface LoginOtpChallenge {
  channel?: OtpChannel;
  maskedDestination?: string;
  challengeId: string;
  codeLength: number;
  expiresInSeconds: number;
}

export interface EmailOtpPanelProps {
  email: string;
  channel?: OtpChannel;
  codeLength: number;
  /** Absolute deadline computed when the server response arrives, before lazy loading. */
  expiresAt?: number;
  /** Changes only when a fresh code was accepted, to clear a previously entered code. */
  codeRevision?: number;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  /** Start a fresh request or return to signup credentials; never resend an expired challenge. */
  onRequestNewCode?: () => void | Promise<void>;
  isVerifying?: boolean;
  isResending?: boolean;
  /** Local request budget for passwordless login; the server also enforces its limits. */
  resendLimitReached?: boolean;
  verifyError?: string;
  resendNotice?: string;
  recovery?: OtpRecoveryAction;
  onRestart?: () => void;
  restartLabel?: string;
  // Experience-aware theming (Sprint 5.1.1). Defaults to seeker so any
  // call site that hasn't been threaded yet keeps the historical orange
  // identity exactly. Layout / spacing / typography are unchanged.
  experience?: AuthExperience;
}
