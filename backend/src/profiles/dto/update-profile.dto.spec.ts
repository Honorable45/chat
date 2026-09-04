import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

describe('UpdateProfileDto', () => {
  it("rejette une valeur hors de l'enum WhoCanInteract", async () => {
    const dto = plainToInstance(UpdateProfileDto, { whoCanMessageMe: 'TOUT_LE_MONDE' });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'whoCanMessageMe')).toBe(true);
  });

  it('rejette une URL invalide pour avatarUrl', async () => {
    const dto = plainToInstance(UpdateProfileDto, { avatarUrl: 'pas-une-url' });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'avatarUrl')).toBe(true);
  });

  it('accepte un payload valide sans erreur', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      whoCanMessageMe: 'CONTACTS',
      statusText: 'Disponible',
      voiceCloningConsent: true,
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
