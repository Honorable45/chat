import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { createReadStream, ReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

export interface StoredFile {
  /** Chemin relatif interne — jamais exposé tel quel à un client (voir VoiceService.streamAudio). */
  key: string;
  sizeBytes: number;
}

/**
 * Driver "local disque". `STORAGE_DRIVER` prépare le terrain pour un driver
 * S3-compatible en production (section 2/38 : fournisseurs interchangeables)
 * — seul ce fichier changerait, aucun appelant ne dépend du disque local.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly root: string;

  constructor() {
    const driver = process.env.STORAGE_DRIVER ?? 'local';
    if (driver !== 'local') {
      // Échoue tôt et clairement plutôt que d'ignorer silencieusement un
      // driver non implémenté (section 40 : ne jamais faire semblant).
      throw new InternalServerErrorException(
        `STORAGE_DRIVER="${driver}" n'est pas encore implémenté (seul "local" l'est pour l'instant).`,
      );
    }
    this.root = resolve(process.env.STORAGE_LOCAL_PATH ?? './uploads');
  }

  async save(buffer: Buffer, subdirectory: string, extension: string): Promise<StoredFile> {
    const dir = join(this.root, subdirectory);
    await mkdir(dir, { recursive: true });

    const filename = `${randomUUID()}.${extension}`;
    const key = join(subdirectory, filename);
    await writeFile(join(this.root, key), buffer);

    return { key, sizeBytes: buffer.byteLength };
  }

  createReadStream(key: string): ReadStream {
    return createReadStream(this.resolveKey(key));
  }

  /** Relit le fichier entier en mémoire — utilisé pour la (re)transcription. */
  readFile(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch (error) {
      // Best-effort : un fichier déjà absent ne doit jamais faire échouer
      // l'opération métier (ex. suppression d'un message vocal).
      this.logger.warn(
        `Échec de suppression du fichier "${key}" : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Empêche toute traversée de répertoire (`../../etc/passwd`) : la clé
   * résolue doit toujours rester sous la racine de stockage.
   */
  private resolveKey(key: string): string {
    const absolute = resolve(this.root, key);
    if (!absolute.startsWith(this.root)) {
      throw new InternalServerErrorException('Chemin de stockage invalide.');
    }
    return absolute;
  }
}
