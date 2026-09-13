import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { OtpPurpose, type OtpRequest } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { VonageService } from '../sms/vonage.service';
import { OtpService } from './otp.service';

jest.mock('bcrypt');

const mockedBcrypt = jest.mocked(bcrypt);

function buildOtpRequest(overrides: Partial<OtpRequest> = {}): OtpRequest {
  return {
    id: 'otp-1',
    phone: '+22890000000',
    purpose: OtpPurpose.LOGIN,
    codeHash: 'hashed-code',
    attempts: 0,
    maxAttempts: 5,
    verifiedAt: null,
    consumedAt: null,
    continuationTokenHash: null,
    secondFactorAttempts: 0,
    ipAddress: null,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    createdAt: new Date(),
    ...overrides,
  };
}

describe('OtpService', () => {
  let prisma: {
    otpRequest: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let vonage: { sendOtp: jest.Mock };
  let service: OtpService;

  beforeEach(() => {
    prisma = {
      otpRequest: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    vonage = { sendOtp: jest.fn().mockResolvedValue(undefined) };
    mockedBcrypt.hash.mockResolvedValue('hashed-code' as never);

    service = new OtpService(
      prisma as unknown as PrismaService,
      vonage as unknown as VonageService,
    );
  });

  describe('request', () => {
    it("envoie un SMS et crée une nouvelle demande quand aucune n'est active", async () => {
      prisma.otpRequest.findFirst.mockResolvedValue(null);
      prisma.otpRequest.create.mockResolvedValue(buildOtpRequest());

      await service.request('+22890000000', OtpPurpose.LOGIN, '127.0.0.1');

      expect(prisma.otpRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- matcher Jest imbriqué, typé `any` par @types/jest.
          data: expect.objectContaining({ phone: '+22890000000', purpose: OtpPurpose.LOGIN }),
        }),
      );
      expect(vonage.sendOtp).toHaveBeenCalledWith('+22890000000', expect.stringMatching(/^\d{6}$/));
    });

    it('rejette une nouvelle demande trop rapprochée de la précédente (anti-spam)', async () => {
      prisma.otpRequest.findFirst.mockResolvedValue(
        buildOtpRequest({ createdAt: new Date(), consumedAt: null }),
      );

      await expect(service.request('+22890000000', OtpPurpose.LOGIN)).rejects.toThrow(
        BadRequestException,
      );
      expect(vonage.sendOtp).not.toHaveBeenCalled();
    });

    it("invalide l'ancienne demande non consommée avant d'en créer une nouvelle", async () => {
      const old = buildOtpRequest({
        id: 'otp-old',
        createdAt: new Date(Date.now() - 60_000),
      });
      prisma.otpRequest.findFirst.mockResolvedValue(old);
      prisma.otpRequest.create.mockResolvedValue(buildOtpRequest());

      await service.request('+22890000000', OtpPurpose.LOGIN);

      expect(prisma.otpRequest.update).toHaveBeenCalledWith({
        where: { id: 'otp-old' },
        data: { consumedAt: expect.any(Date) as Date },
      });
    });
  });

  describe('verify', () => {
    it('accepte un code correct et marque la demande vérifiée', async () => {
      const active = buildOtpRequest();
      prisma.otpRequest.findFirst.mockResolvedValue(active);
      mockedBcrypt.compare.mockResolvedValue(true as never);
      prisma.otpRequest.update.mockResolvedValue({ ...active, verifiedAt: new Date() });

      const result = await service.verify('+22890000000', OtpPurpose.LOGIN, '583214');

      expect(result.verifiedAt).toBeTruthy();
      expect(prisma.otpRequest.update).toHaveBeenCalledWith({
        where: { id: active.id },
        data: { verifiedAt: expect.any(Date) as Date },
      });
    });

    it('incrémente les tentatives et rejette un code incorrect', async () => {
      const active = buildOtpRequest();
      prisma.otpRequest.findFirst.mockResolvedValue(active);
      mockedBcrypt.compare.mockResolvedValue(false as never);

      await expect(service.verify('+22890000000', OtpPurpose.LOGIN, '000000')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.otpRequest.update).toHaveBeenCalledWith({
        where: { id: active.id },
        data: { attempts: { increment: 1 } },
      });
    });

    it('rejette sans même comparer le code une fois maxAttempts atteint', async () => {
      const active = buildOtpRequest({ attempts: 5, maxAttempts: 5 });
      prisma.otpRequest.findFirst.mockResolvedValue(active);

      await expect(service.verify('+22890000000', OtpPurpose.LOGIN, '583214')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockedBcrypt.compare).not.toHaveBeenCalled();
    });

    it("rejette quand aucune demande active n'existe (expirée/consommée/inexistante)", async () => {
      prisma.otpRequest.findFirst.mockResolvedValue(null);

      await expect(service.verify('+22890000000', OtpPurpose.LOGIN, '583214')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('findByContinuationToken', () => {
    it('retrouve la demande vérifiée correspondant au jeton', async () => {
      const verified = buildOtpRequest({
        verifiedAt: new Date(),
        continuationTokenHash: 'hashed-token',
      });
      prisma.otpRequest.findMany.mockResolvedValue([verified]);
      mockedBcrypt.compare.mockResolvedValue(true as never);

      const result = await service.findByContinuationToken(
        '+22890000000',
        OtpPurpose.LOGIN,
        'raw-token',
      );

      expect(result.id).toBe(verified.id);
    });

    it('rejette un jeton qui ne correspond à aucune demande', async () => {
      prisma.otpRequest.findMany.mockResolvedValue([
        buildOtpRequest({ verifiedAt: new Date(), continuationTokenHash: 'hashed-token' }),
      ]);
      mockedBcrypt.compare.mockResolvedValue(false as never);

      await expect(
        service.findByContinuationToken('+22890000000', OtpPurpose.LOGIN, 'wrong-token'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejette une fois maxAttempts de la 2FA dépassé pour la demande trouvée', async () => {
      prisma.otpRequest.findMany.mockResolvedValue([
        buildOtpRequest({
          verifiedAt: new Date(),
          continuationTokenHash: 'hashed-token',
          secondFactorAttempts: 5,
          maxAttempts: 5,
        }),
      ]);
      mockedBcrypt.compare.mockResolvedValue(true as never);

      await expect(
        service.findByContinuationToken('+22890000000', OtpPurpose.LOGIN, 'raw-token'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
