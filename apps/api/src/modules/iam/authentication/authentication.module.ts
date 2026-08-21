import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AppConfigService } from '../../../config/app-config.service';
import { ConfigModule } from '../../../config/config.module';
import { AuditModule } from '../audit/audit.module';
import { AuthenticationController } from './controllers/authentication.controller';
import { AuthenticationService } from './services/authentication.service';
import { LoginAttemptService } from './services/login-attempt.service';
import { OtpService } from './services/otp.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';
import { SessionValidationService } from './services/session-validation.service';
import { TokenService } from './services/token.service';
import { VerificationService } from './services/verification.service';
import { CsrfGuard } from './guards/csrf.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.get('JWT_ACCESS_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          issuer: config.get('JWT_ISSUER'),
          audience: config.get('JWT_AUDIENCE'),
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: config.get('JWT_ISSUER'),
          audience: config.get('JWT_AUDIENCE'),
        },
      }),
    }),
    AuditModule,
  ],
  controllers: [AuthenticationController],
  providers: [
    AuthenticationService,
    PasswordService,
    TokenService,
    SessionService,
    VerificationService,
    OtpService,
    LoginAttemptService,
    SessionValidationService,
    JwtStrategy,
    JwtAuthGuard,
    CsrfGuard,
  ],
  exports: [
    AuthenticationService,
    TokenService,
    SessionService,
    SessionValidationService,
    JwtAuthGuard,
    CsrfGuard,
    PassportModule,
    JwtModule,
  ],
})
export class AuthenticationModule {}
