"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "@/components/icons";
import { useTheme } from "@/lib/use-theme";
import type { ThemeMode } from "@/lib/theme";

const OPTIONS: { mode: ThemeMode; label: string; icon: typeof SunIcon }[] = [
  { mode: "light", label: "Clair", icon: SunIcon },
  { mode: "dark", label: "Sombre", icon: MoonIcon },
  { mode: "system", label: "Système", icon: MonitorIcon },
];

/**
 * Applique immédiatement (voir lib/use-theme.ts) — pas de bouton
 * "Enregistrer" : un thème n'est pas un réglage serveur, juste une
 * préférence locale au navigateur (localStorage), comme dans la plupart des
 * applications de messagerie.
 */
export function AppearanceSection() {
  const { mode, setTheme } = useTheme();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Choisissez l&rsquo;apparence de l&rsquo;application sur cet appareil.</p>
      <div className="grid grid-cols-3 gap-2.5">
        {OPTIONS.map(({ mode: optionMode, label, icon: Icon }) => {
          const active = mode === optionMode;
          return (
            <button
              key={optionMode}
              onClick={() => setTheme(optionMode)}
              className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-sm transition ${
                active
                  ? "border-[var(--accent-2)] bg-surface-raised text-foreground"
                  : "border-border text-muted hover:bg-surface-raised hover:text-foreground"
              }`}
            >
              <Icon size={20} />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
