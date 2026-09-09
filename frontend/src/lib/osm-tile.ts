/**
 * Position ponctuelle affichée via une seule tuile OpenStreetMap (256x256,
 * gratuite, sans clé) plutôt qu'un service de carte statique payant (Mapbox/
 * Google) ou un service tiers de repère intégré (indisponible depuis ce
 * sandbox) — voir LocationPreview.tsx. `xPercent`/`yPercent` positionnent le
 * repère au pixel près à l'intérieur de cette unique tuile, calculés à
 * partir de la position FRACTIONNAIRE (pas seulement l'index entier de la
 * tuile) dans la projection Web Mercator standard.
 */
export function locationTile(
  latitude: number,
  longitude: number,
  zoom: number,
): { tileUrl: string; xPercent: number; yPercent: number } {
  const n = 2 ** zoom;
  const latRad = (latitude * Math.PI) / 180;
  const xExact = ((longitude + 180) / 360) * n;
  const yExact = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xExact);
  const y = Math.floor(yExact);
  return {
    tileUrl: `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`,
    xPercent: (xExact - x) * 100,
    yPercent: (yExact - y) * 100,
  };
}

/**
 * Ouvre la position dans Google Maps — demandé explicitement (par défaut),
 * possible sans aucune clé API : ce lien de recherche public
 * (`google.com/maps/search`) n'est pas un appel à l'API Google Maps
 * (facturée, nécessite une clé), juste une URL classique du site, au même
 * titre que copier-coller des coordonnées dans la barre de recherche. Voir
 * MessageBubble ; la vignette de la bulle reste servie par OpenStreetMap
 * (locationTile ci-dessus), seul le lien "ouvrir" change.
 */
export function googleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
