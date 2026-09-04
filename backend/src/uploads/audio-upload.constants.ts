/**
 * Formats acceptés pour les messages vocaux (section 23 : validation stricte
 * des fichiers uploadés). Couvre les sorties usuelles de MediaRecorder côté
 * navigateur (webm/ogg) ainsi que quelques formats mobiles/desktop courants.
 */
export const ALLOWED_AUDIO_MIME_TYPES: Readonly<Record<string, string>> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

export const EXTENSION_TO_MIME_TYPE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ALLOWED_AUDIO_MIME_TYPES).map(([mime, ext]) => [ext, mime]),
);

// Section 23 : "limite de taille audio".
export const MAX_AUDIO_SIZE_BYTES = 15 * 1024 * 1024; // 15 Mo
export const MAX_VOICE_DURATION_SECONDS = 300; // 5 minutes
