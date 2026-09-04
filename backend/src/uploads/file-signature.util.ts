/**
 * Vérifie que le contenu réel d'un fichier envoyé correspond bien au type
 * MIME déclaré par le client (audit de sécurité : le seul champ
 * `file.mimetype` de Multer vient de l'en-tête `Content-Type` du formulaire
 * multipart, entièrement choisi par le client, et ne garantit rien sur le
 * contenu effectif du fichier). Une reconnaissance de signature ("magic
 * bytes") suffit ici : la liste de formats acceptés (voir
 * media-upload.constants.ts / audio-upload.constants.ts) est fermée et
 * courte, une dépendance dédiée serait disproportionnée.
 */

function matchesBytes(buffer: Buffer, offset: number, bytes: number[]): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => buffer[offset + i] === byte);
}

function asciiAt(buffer: Buffer, offset: number, text: string): boolean {
  if (buffer.length < offset + text.length) return false;
  return buffer.toString('latin1', offset, offset + text.length) === text;
}

const ISO_BMFF_BOX_TYPE_OFFSET = 4; // boîte de tête : taille (4o) + type à 4 caractères

/**
 * Conteneur commun à video/mp4, audio/mp4 (.m4a) et video/quicktime (.mov) :
 * un entier 32 bits (taille de la première "boîte") suivi d'un type à 4
 * caractères. "ftyp" couvre l'immense majorité des fichiers réels ; les
 * rares .mov sans ftyp démarrent directement par une autre boîte connue.
 */
function isIsoBaseMediaFile(buffer: Buffer): boolean {
  return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].some((box) =>
    asciiAt(buffer, ISO_BMFF_BOX_TYPE_OFFSET, box),
  );
}

const SIGNATURE_CHECKS: Readonly<Record<string, (buffer: Buffer) => boolean>> = {
  'image/jpeg': (b) => matchesBytes(b, 0, [0xff, 0xd8, 0xff]),
  'image/png': (b) => matchesBytes(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/gif': (b) => asciiAt(b, 0, 'GIF87a') || asciiAt(b, 0, 'GIF89a'),
  'image/webp': (b) => asciiAt(b, 0, 'RIFF') && asciiAt(b, 8, 'WEBP'),
  'video/mp4': isIsoBaseMediaFile,
  'video/quicktime': isIsoBaseMediaFile,
  'video/webm': (b) => matchesBytes(b, 0, [0x1a, 0x45, 0xdf, 0xa3]),
  'audio/webm': (b) => matchesBytes(b, 0, [0x1a, 0x45, 0xdf, 0xa3]),
  'audio/mp4': isIsoBaseMediaFile,
  'audio/ogg': (b) => asciiAt(b, 0, 'OggS'),
  'audio/mpeg': (b) =>
    asciiAt(b, 0, 'ID3') || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  'audio/wav': (b) => asciiAt(b, 0, 'RIFF') && asciiAt(b, 8, 'WAVE'),
  'audio/x-wav': (b) => asciiAt(b, 0, 'RIFF') && asciiAt(b, 8, 'WAVE'),
};

/**
 * `true` si le contenu réel du fichier correspond au type MIME déclaré.
 * Refuse par défaut (`false`) pour un type MIME sans vérification définie
 * ici plutôt que de laisser passer un format inconnu de cette fonction —
 * ne devrait jamais arriver pour un type déjà accepté par une table
 * ALLOWED_*_MIME_TYPES, les deux listes sont tenues en phase volontairement.
 */
export function matchesFileSignature(buffer: Buffer, mimeType: string): boolean {
  const check = SIGNATURE_CHECKS[mimeType];
  return check ? check(buffer) : false;
}
