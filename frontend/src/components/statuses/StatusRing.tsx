import { Avatar } from "@/components/Avatar";
import type { StatusAuthor } from "@/lib/types";

/** Anneau coloré façon "story" : dégradé si au moins un statut du groupe
 * n'a pas encore été vu, gris discret sinon. `hasUnviewed` vaut toujours
 * `undefined` pour "mon statut" (la notion ne s'applique pas à soi-même —
 * voir StatusesService.markViewed côté backend, qui ignore ses propres
 * statuts). */
export function StatusRing({
  author,
  hasUnviewed,
  size = 56,
  onClick,
}: {
  author: StatusAuthor;
  hasUnviewed?: boolean;
  size?: number;
  onClick?: () => void;
}) {
  const ringPadding = 3;
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5"
      style={{ width: size + 16 }}
    >
      <span
        className="flex items-center justify-center rounded-full"
        style={{
          width: size + ringPadding * 2,
          height: size + ringPadding * 2,
          background:
            hasUnviewed === false
              ? "var(--border-strong)"
              : "linear-gradient(135deg, var(--accent), var(--accent-2))",
          padding: ringPadding,
        }}
      >
        <span className="rounded-full bg-surface p-0.5">
          <Avatar firstName={author.firstName} lastName={author.lastName} avatarUrl={author.avatarUrl} size={size} />
        </span>
      </span>
      <span className="max-w-full truncate text-xs text-muted-strong">{author.firstName}</span>
    </button>
  );
}
