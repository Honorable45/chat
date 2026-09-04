/**
 * Lit les vraies dimensions/durée d'un fichier image/vidéo choisi par
 * l'utilisateur, directement dans le navigateur, avant l'envoi — jamais
 * inventé (section 40) : ces valeurs sont purement cosmétiques (mise en
 * page de la grille côté destinataire) et ne sont d'ailleurs jamais
 * recalculées côté serveur (pas de ffmpeg/sharp disponible, voir
 * MessagesService.sendMedia), donc doivent être réelles ici ou absentes.
 */
export interface MediaFileMeta {
  fileName: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
}

function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function readVideoMetadata(
  file: File,
): Promise<{ width: number; height: number; durationSeconds: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        durationSeconds: Number.isFinite(video.duration) ? Math.round(video.duration) : 0,
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    video.src = url;
  });
}

export async function readMediaMeta(file: File): Promise<MediaFileMeta> {
  if (file.type.startsWith("video/")) {
    const video = await readVideoMetadata(file);
    return { fileName: file.name, width: video?.width, height: video?.height, durationSeconds: video?.durationSeconds };
  }
  const image = await readImageDimensions(file);
  return { fileName: file.name, width: image?.width, height: image?.height };
}
