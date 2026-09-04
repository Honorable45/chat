import { InternalServerErrorException } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let tempDir: string;
  let service: StorageService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'glotta-storage-test-'));
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_LOCAL_PATH = tempDir;
    service = new StorageService();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('refuse tout driver autre que "local"', () => {
    process.env.STORAGE_DRIVER = 's3';
    expect(() => new StorageService()).toThrow(InternalServerErrorException);
  });

  it('écrit puis relit le même contenu', async () => {
    const buffer = Buffer.from('contenu audio de test');
    const stored = await service.save(buffer, 'voice', 'wav');

    expect(stored.sizeBytes).toBe(buffer.byteLength);
    expect(await service.exists(stored.key)).toBe(true);

    const content = readFileSync(join(tempDir, stored.key));
    expect(content.equals(buffer)).toBe(true);
  });

  it('empêche toute traversée de répertoire hors de la racine de stockage', () => {
    expect(() => service.createReadStream('../../etc/passwd')).toThrow(
      InternalServerErrorException,
    );
  });

  it("indique false pour un fichier qui n'existe pas", async () => {
    expect(await service.exists('voice/inconnu.wav')).toBe(false);
  });

  it('delete() ne plante jamais même si le fichier est déjà absent', async () => {
    await expect(service.delete('voice/inconnu.wav')).resolves.toBeUndefined();
  });
});
