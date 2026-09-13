import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';

const PIN_REGEX = /^[0-9]{4,6}$/;
const PIN_MESSAGE = 'Le PIN doit contenir entre 4 et 6 chiffres.';

export class EnableTwoFactorDto {
  @ApiProperty({ example: '4821' })
  @IsString()
  @Matches(PIN_REGEX, { message: PIN_MESSAGE })
  pin!: string;
}

export class DisableTwoFactorDto {
  @ApiProperty({ example: '4821' })
  @IsString()
  @Matches(PIN_REGEX, { message: PIN_MESSAGE })
  pin!: string;
}

export class ChangePinDto {
  @ApiProperty({ example: '4821' })
  @IsString()
  @Matches(PIN_REGEX, { message: PIN_MESSAGE })
  currentPin!: string;

  @ApiProperty({ example: '9034' })
  @IsString()
  @Matches(PIN_REGEX, { message: PIN_MESSAGE })
  newPin!: string;
}

export class RequestRecoveryEmailDto {
  @ApiProperty({ example: 'honore@example.com' })
  @IsEmail()
  email!: string;
}

export class VerifyRecoveryEmailDto {
  @ApiProperty({ example: '583214' })
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'Code invalide.' })
  code!: string;
}

export class RecoveryVerifyPhoneDto {
  @ApiProperty({ example: '+22890000000' })
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Numéro de téléphone invalide.' })
  phone!: string;

  @ApiProperty({ example: '583214' })
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'Code invalide.' })
  code!: string;
}

export class RecoveryResetPinDto {
  @ApiProperty({ example: '+22890000000' })
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Numéro de téléphone invalide.' })
  phone!: string;

  @ApiProperty({ description: 'Jeton renvoyé par /2fa/recovery/verify-phone' })
  @IsString()
  continuationToken!: string;

  @ApiProperty({ example: '583214', description: "Code reçu par l'email de secours" })
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'Code invalide.' })
  emailCode!: string;

  @ApiProperty({ example: '9034' })
  @IsString()
  @Matches(PIN_REGEX, { message: PIN_MESSAGE })
  newPin!: string;
}

export class VerifyTwoFactorDto {
  @ApiProperty({ example: '+22890000000' })
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Numéro de téléphone invalide.' })
  phone!: string;

  @ApiProperty({ description: 'Jeton renvoyé par /auth/login/verify-otp quand la 2FA est active' })
  @IsString()
  continuationToken!: string;

  @ApiProperty({ example: '4821' })
  @IsString()
  @Matches(PIN_REGEX, { message: PIN_MESSAGE })
  pin!: string;

  @ApiPropertyOptional({ example: 'iPhone de Honoré' })
  @IsOptional()
  @IsString()
  deviceLabel?: string;
}
