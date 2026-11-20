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
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  isVerifying?: boolean;
  isResending?: boolean;
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
