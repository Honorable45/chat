"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Aucun contenu propre : /dashboard décide ensuite (via Shell) s'il faut plutôt aller vers /login. */
export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return null;
}
