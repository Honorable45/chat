"use client";

import { MapPinIcon } from "@/components/icons";
import { locationTile } from "@/lib/osm-tile";

const DEFAULT_ZOOM = 15;

/** Tuile OpenStreetMap + repère positionné au pixel près (voir lib/osm-tile.ts) — partagé entre ShareLocationModal (avant l'envoi) et MessageBubble (après l'envoi), jamais dupliqué. */
export function LocationPreview({
  latitude,
  longitude,
  height = 160,
}: {
  latitude: number;
  longitude: number;
  height?: number;
}) {
  const { tileUrl, xPercent, yPercent } = locationTile(latitude, longitude, DEFAULT_ZOOM);

  return (
    <div className="relative overflow-hidden bg-surface" style={{ height }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tuile OpenStreetMap externe, jamais un asset next/image. */}
      <img src={tileUrl} alt="Carte de la position partagée" className="h-full w-full object-cover" />
      <span
        className="absolute text-danger drop-shadow-md"
        style={{ left: `${xPercent}%`, top: `${yPercent}%`, transform: "translate(-50%, -100%)" }}
      >
        <MapPinIcon size={30} />
      </span>
    </div>
  );
}
