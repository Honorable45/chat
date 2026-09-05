"use client";

import { useState } from "react";
import { XIcon } from "@/components/icons";
import { api, ApiError } from "@/lib/api";

/**
 * Signalement minimal (section admin/modération) : un seul champ de motif,
 * pas de taxonomie de raisons prédéfinies — peut être enrichi plus tard sans
 * migration bloquante (voir ReportsService côté backend). Traité par une
 * app admin séparée, jamais visible ici une fois envoyé.
 */
export function ReportModal({
  targetType,
  targetId,
  onClose,
}: {
  targetType: "MESSAGE" | "STATUS" | "USER";
  targetId: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!reason.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.reports.create({ targetType, targetId, reason: reason.trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'envoyer ce signalement.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 px-4 pt-24" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface-raised p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Signaler</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Fermer">
            <XIcon size={18} />
          </button>
        </div>

        {sent ? (
          <p className="py-4 text-center text-sm text-muted">
            Signalement envoyé. Merci — notre équipe va l&rsquo;examiner.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted">Décrivez le problème en quelques mots.</p>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="Motif du signalement..."
              className="w-full resize-none rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none placeholder:text-muted focus:border-[var(--accent)]"
            />
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            <button
              onClick={() => void submit()}
              disabled={sending || !reason.trim()}
              className="mt-3 w-full rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:opacity-50"
            >
              {sending ? "Envoi..." : "Envoyer le signalement"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
