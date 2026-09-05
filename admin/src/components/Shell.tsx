"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";

const NAV = [
  { href: "/dashboard", label: "Tableau de bord" },
  { href: "/users", label: "Utilisateurs" },
  { href: "/reports", label: "Signalements" },
] as const;

/**
 * Enveloppe toute page authentifiée : redirige vers /login si personne n'est
 * connecté, affiche "Accès refusé" pour un compte réel mais non-admin
 * (jamais de redirection dans ce cas — le compte est valide, voir
 * auth-context.tsx). La vraie autorisation reste de toute façon vérifiée à
 * chaque requête par AdminGuard côté serveur ; cet écran n'est qu'un
 * affichage cohérent avec ça, jamais la garantie elle-même.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const { user, status, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status === "loading" || status === "anonymous") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="glotta-gradient-text text-xl font-semibold tracking-tight">Glotta Admin</span>
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-lg font-semibold">Accès refusé</p>
        <p className="max-w-sm text-sm text-muted">
          Le compte {user?.username} est bien connecté, mais n&rsquo;a pas les droits administrateur.
        </p>
        <button
          onClick={() => void logout()}
          className="mt-2 rounded-xl border border-border px-4 py-2 text-sm transition hover:bg-surface-raised"
        >
          Se déconnecter
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3.5">
        <div className="flex items-center gap-6">
          <span className="glotta-gradient-text text-sm font-semibold tracking-tight">Glotta Admin</span>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  pathname === item.href
                    ? "bg-surface-raised text-foreground"
                    : "text-muted hover:bg-surface-raised hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">{user?.firstName} {user?.lastName}</span>
          <button
            onClick={() => void logout()}
            className="rounded-lg border border-border px-3 py-1.5 text-sm transition hover:bg-surface-raised"
          >
            Se déconnecter
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
    </div>
  );
}
