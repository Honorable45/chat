"use client";

import { useEffect, useState } from "react";
import { applyTheme, getStoredTheme, setStoredTheme, type ThemeMode } from "./theme";

/**
 * État réactif du thème pour l'UI (voir AppearanceSection) — la valeur
 * effective est déjà posée sur <html> avant même le premier rendu (script
 * inline, voir app/layout.tsx et THEME_INIT_SCRIPT) ; ce hook ne fait que
 * refléter ce choix côté React pour que les boutons "Clair/Sombre/Système"
 * sachent lequel est actif.
 */
export function useTheme(): { mode: ThemeMode; setTheme: (mode: ThemeMode) => void } {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    // queueMicrotask : voir le commentaire équivalent dans auth-context.tsx —
    // le corps de l'effet ne doit jamais déclencher de setState de façon
    // synchrone (react-hooks/set-state-in-effect), même pour une simple
    // lecture de localStorage au montage.
    queueMicrotask(() => {
      const stored = getStoredTheme();
      setMode(stored);
      applyTheme(stored); // idempotent : déjà posé par le script inline, sauf en cas de valeur périmée.
    });
  }, []);

  function setTheme(next: ThemeMode) {
    setStoredTheme(next);
    setMode(next);
  }

  return { mode, setTheme };
}
