"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * L'inscription par mot de passe n'existe plus côté Web (section 1 :
 * l'inscription se fait uniquement depuis l'app mobile, par numéro de
 * téléphone + OTP) — cette route ne sert plus qu'à rediriger d'anciens
 * liens/favoris vers /login, qui affiche désormais le QR de connexion
 * (section 6).
 */
export default function RegisterPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/login");
  }, [router]);

  return null;
}
