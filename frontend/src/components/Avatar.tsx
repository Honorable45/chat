import { resolveAvatarSrc } from "@/lib/api";
import { avatarGradient, initials } from "@/lib/format";

interface AvatarProps {
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  size?: number;
  /** Affiche un point de présence en bas à droite si précisé. */
  online?: boolean;
  seed?: string;
  className?: string;
}

export function Avatar({
  firstName,
  lastName,
  avatarUrl,
  size = 40,
  online,
  seed,
  className = "",
}: AvatarProps) {
  const dimension = { width: size, height: size };
  const src = resolveAvatarSrc(avatarUrl);
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={dimension}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL arbitraire fournie par l'utilisateur (voir UpdateProfileDto.avatarUrl) ou servie publiquement par le backend (voir resolveAvatarSrc), pas un asset local à optimiser.
        <img
          src={src}
          alt=""
          className="h-full w-full rounded-full object-cover"
          style={dimension}
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center rounded-full font-medium text-white"
          style={{ ...dimension, background: avatarGradient(seed ?? `${firstName}${lastName}`), fontSize: size * 0.38 }}
        >
          {initials({ firstName, lastName })}
        </span>
      )}
      {online !== undefined && (
        <span
          className={`absolute right-0 bottom-0 rounded-full border-2 border-[var(--surface)] ${
            online ? "bg-[var(--online)]" : "bg-[var(--muted)]"
          }`}
          style={{ width: size * 0.28, height: size * 0.28 }}
        />
      )}
    </span>
  );
}
