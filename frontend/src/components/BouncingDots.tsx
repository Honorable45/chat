/** Indicateur de chargement à deux points qui rebondissent en alternance
 * (façon TikTok) — réutilise l'utilitaire `animate-bounce` de Tailwind avec
 * un délai décalé entre les deux points, sans keyframes personnalisées. */
export function BouncingDots({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-1.5 ${className}`} role="status" aria-label="Chargement">
      <span
        className="h-2 w-2 animate-bounce rounded-full bg-[var(--accent)]"
        style={{ animationDelay: "0ms" }}
      />
      <span
        className="h-2 w-2 animate-bounce rounded-full bg-[var(--accent-2)]"
        style={{ animationDelay: "150ms" }}
      />
    </div>
  );
}
