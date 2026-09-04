"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <span className="glotta-gradient-text text-2xl font-semibold tracking-tight">Glotta</span>
      </div>
    );
  }

  // h-dvh (pas flex-1) : ancre la hauteur au viewport réel plutôt que de
  // dépendre du <body> (min-h-full, pas h-full — voir globals.css/layout.tsx
  // racine), sans quoi rien dans cette chaîne flex n'a de hauteur bornée et
  // les listes internes (conversations, messages) ne peuvent jamais défiler
  // seules : c'est toute la page qui grandirait et défilerait à leur place.
  return <div className="flex h-dvh overflow-hidden bg-background">{children}</div>;
}
