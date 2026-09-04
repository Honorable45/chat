"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthShell, FormField, inputClassName, primaryButtonClassName } from "@/components/auth/AuthShell";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { LanguageSummary } from "@/lib/types";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();

  const [languages, setLanguages] = useState<LanguageSummary[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [primaryLanguageCode, setPrimaryLanguageCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.languages
      .list()
      .then((list) => {
        setLanguages(list);
        setPrimaryLanguageCode((current) => current || list[0]?.code || "");
      })
      .catch(() => {
        // Le formulaire reste utilisable (un code sera tapé au clavier), mais
        // signale l'anomalie plutôt que de la masquer.
        setError("Impossible de charger la liste des langues pour le moment.");
      });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({
        firstName,
        lastName,
        username,
        email: email || undefined,
        password,
        primaryLanguageCode,
      });
      router.replace("/chat");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Inscription impossible. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Créer un compte"
      subtitle="Discutez avec n'importe qui, dans votre langue."
      footer={
        <>
          Déjà un compte ?{" "}
          <Link href="/login" className="font-medium text-[var(--accent-2)] hover:underline">
            Se connecter
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Prénom">
            <input
              className={inputClassName}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Nom">
            <input
              className={inputClassName}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </FormField>
        </div>

        <FormField label="Nom d'utilisateur">
          <input
            className={inputClassName}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            pattern="[a-zA-Z0-9_.]+"
            title="Lettres, chiffres, points et underscores uniquement."
            required
          />
        </FormField>

        <FormField label="Email">
          <input
            type="email"
            className={inputClassName}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </FormField>

        <FormField label="Mot de passe">
          <input
            type="password"
            className={inputClassName}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </FormField>

        <FormField label="Langue principale">
          <select
            className={inputClassName}
            value={primaryLanguageCode}
            onChange={(e) => setPrimaryLanguageCode(e.target.value)}
            required
          >
            {languages.length === 0 && <option value="">Chargement...</option>}
            {languages.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.nativeName}
              </option>
            ))}
          </select>
        </FormField>

        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <button type="submit" className={primaryButtonClassName} disabled={submitting}>
          {submitting ? "Création..." : "Créer mon compte"}
        </button>
      </form>
    </AuthShell>
  );
}
