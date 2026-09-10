"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { LanguageSummary } from "./types";

// `GET /languages` est public et stable sur la durée d'une session : on le
// charge une seule fois pour toute l'application (sélecteurs de traduction
// des vocaux, langue de réception des appels...).
let cache: LanguageSummary[] | null = null;
let pending: Promise<LanguageSummary[]> | null = null;

export function loadLanguages(): Promise<LanguageSummary[]> {
  if (cache) return Promise.resolve(cache);
  pending ??= api.languages
    .list()
    .then((list) => {
      cache = list;
      return list;
    })
    .catch(() => {
      pending = null;
      return [];
    });
  return pending;
}

/** Registre des langues activées — `[]` tant qu'il n'est pas chargé. */
export function useLanguages(): LanguageSummary[] {
  const [languages, setLanguages] = useState<LanguageSummary[]>(cache ?? []);
  useEffect(() => {
    let alive = true;
    if (!cache) void loadLanguages().then((list) => alive && setLanguages(list));
    return () => {
      alive = false;
    };
  }, []);
  return languages;
}

export function languageLabel(code: string | null, languages: LanguageSummary[]): string {
  if (!code) return "";
  return languages.find((l) => l.code === code)?.nativeName ?? code;
}
