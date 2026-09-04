/** Formats acceptés pour les statuts photo/vidéo (section 21, section 23 : validation stricte). */
export const ALLOWED_IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const ALLOWED_VIDEO_MIME_TYPES: Readonly<Record<string, string>> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024; // 8 Mo
export const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50 Mo

function invert(map: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([mime, ext]) => [ext, mime]));
}

export const IMAGE_EXTENSION_TO_MIME_TYPE = invert(ALLOWED_IMAGE_MIME_TYPES);
export const VIDEO_EXTENSION_TO_MIME_TYPE = invert(ALLOWED_VIDEO_MIME_TYPES);

/** Nombre maximum de fichiers dans un même album (POST /messages/media) —
 * garde des grilles d'affichage raisonnables côté frontend, pas seulement
 * une limite de charge serveur. */
export const MAX_MEDIA_ALBUM_ITEMS = 10;
