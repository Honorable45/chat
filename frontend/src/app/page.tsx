"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BellIcon, CheckCheckIcon, MicIcon, UsersIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { LanguageSummary } from "@/lib/types";

const FEATURES = [
  {
    icon: MicIcon,
    title: "Traduction vocale en temps réel",
    description:
      "Enregistrez un message vocal : il est transcrit, traduit puis reproduit à voix haute dans la langue de votre interlocuteur.",
  },
  {
    icon: CheckCheckIcon,
    title: "Texte, vocal et images",
    description: "Messagerie complète — texte, messages vocaux, photos — avec accusés envoyé, livré et lu en temps réel.",
  },
  {
    icon: UsersIcon,
    title: "Multilingue par nature",
    description: "Chacun écrit et parle dans sa langue, choisit celle dans laquelle il veut recevoir les traductions.",
  },
  {
    icon: BellIcon,
    title: "Présence et statuts",
    description: "Qui est en ligne, qui écrit, des statuts qui expirent après 24h — le tout mis à jour instantanément.",
  },
];

function ChatMockup() {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-border bg-surface-raised p-4 shadow-2xl">
      <div className="mb-4 flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium text-white"
          style={{ background: "linear-gradient(135deg, #7c6cf6, #22d3ee)" }}
        >
          MK
        </span>
        <div>
          <p className="text-sm font-medium">Mika</p>
          <p className="text-xs text-[var(--online)]">En ligne</p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-border bg-surface px-3.5 py-2.5 text-sm">
          <p>お元気ですか？</p>
          <p className="mt-1 border-t border-border pt-1 text-xs text-muted">Comment vas-tu ?</p>
        </div>
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-3.5 py-2.5 text-sm text-[var(--accent-contrast)]">
          <p>Ça va très bien, merci !</p>
          <p className="mt-1 border-t border-white/25 pt-1 text-xs opacity-80">元気です、ありがとう！</p>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { status } = useAuth();
  const router = useRouter();
  const [languages, setLanguages] = useState<LanguageSummary[]>([]);

  useEffect(() => {
    if (status === "authenticated") router.replace("/chat");
  }, [status, router]);

  useEffect(() => {
    api.languages.list().then(setLanguages).catch(() => {});
  }, []);

  if (status === "loading" || status === "authenticated") {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <span className="glotta-gradient-text text-2xl font-semibold tracking-tight">Glotta</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--accent), transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute -top-20 -right-40 h-96 w-96 rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--accent-2), transparent 70%)" }}
        />

        <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <span className="glotta-gradient-text text-xl font-semibold tracking-tight">Glotta</span>
          <nav className="flex items-center gap-2">
            <Link href="/login" className="rounded-full px-4 py-2 text-sm text-muted-strong transition hover:text-foreground">
              Se connecter
            </Link>
            <Link
              href="/register"
              className="rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-4 py-2 text-sm font-semibold text-[var(--accent-contrast)] transition hover:opacity-90"
            >
              Créer un compte
            </Link>
          </nav>
        </header>

        <main className="relative mx-auto flex max-w-6xl flex-col items-center gap-14 px-6 pt-10 pb-24 text-center lg:flex-row lg:items-center lg:gap-16 lg:pt-16 lg:text-left">
          <div className="flex max-w-xl flex-col items-center gap-6 lg:items-start">
            <h1 className="text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
              Parlez votre langue.
              <br />
              <span className="glotta-gradient-text">Soyez compris dans la leur.</span>
            </h1>
            <p className="max-w-md text-lg text-muted-strong">
              Glotta traduit vos messages — texte et voix — en temps réel, pour discuter naturellement avec n&rsquo;importe qui,
              où qu&rsquo;il soit.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/register"
                className="rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-6 py-3 text-sm font-semibold text-[var(--accent-contrast)] transition hover:opacity-90"
              >
                Commencer gratuitement
              </Link>
              <Link
                href="/login"
                className="rounded-xl border border-border px-6 py-3 text-sm font-semibold text-foreground transition hover:bg-surface-raised"
              >
                J&rsquo;ai déjà un compte
              </Link>
            </div>
          </div>

          <div className="flex w-full justify-center lg:w-auto">
            <ChatMockup />
          </div>
        </main>
      </div>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-2xl border border-border bg-surface-raised p-5">
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)]">
                <Icon size={18} />
              </span>
              <h3 className="mb-1.5 text-sm font-semibold">{title}</h3>
              <p className="text-sm text-muted">{description}</p>
            </div>
          ))}
        </div>
      </section>

      {languages.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 pb-24 text-center">
          <p className="mb-4 text-xs font-medium tracking-wide text-muted uppercase">Langues disponibles aujourd&rsquo;hui</p>
          <div className="flex flex-wrap justify-center gap-2">
            {languages.map((lang) => (
              <span key={lang.code} className="rounded-full border border-border bg-surface-raised px-3.5 py-1.5 text-sm text-muted-strong">
                {lang.nativeName}
              </span>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted">
            Registre de langues extensible — d&rsquo;autres viendront s&rsquo;ajouter avec le temps.
          </p>
        </section>
      )}

      <footer className="border-t border-border px-6 py-8 text-center text-xs text-muted">
        <span className="glotta-gradient-text font-semibold">Glotta</span> — messagerie multilingue avec traduction vocale en
        temps réel.
      </footer>
    </div>
  );
}
