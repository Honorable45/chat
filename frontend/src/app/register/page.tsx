"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthShell, FormField, inputClassName, primaryButtonClassName } from "@/components/auth/AuthShell";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Prénom/nom/langue principale sont laissés à leurs valeurs par défaut
      // côté backend (nom d'utilisateur comme nom affiché, "fr" comme langue)
      // — modifiables ensuite depuis Paramètres → Profil, jamais redemandés
      // ici (section "juste nom d'utilisateur/email/mot de passe").
      await register({ username, email, password });
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
