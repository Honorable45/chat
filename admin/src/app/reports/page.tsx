"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, ApiError } from "@/lib/api";
import type { Report, ReportStatus } from "@/lib/types";

const TARGET_LABEL: Record<Report["targetType"], string> = {
  MESSAGE: "Message",
  STATUS: "Statut",
  USER: "Utilisateur",
};

export default function ReportsPage() {
  const [status, setStatus] = useState<ReportStatus>("PENDING");
  const [reports, setReports] = useState<Report[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    // Différé : le corps d'un effet ne doit jamais déclencher de setState de
    // façon synchrone (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      setLoading(true);
      setError(null);
    });
    api.admin
      .listReports({ status })
      .then((page) => {
        setReports(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les signalements."))
      .finally(() => setLoading(false));
  }, [status]);

  async function loadMore() {
    if (!nextCursor) return;
    try {
      const page = await api.admin.listReports({ status, cursor: nextCursor });
      setReports((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de charger la suite.");
    }
  }

  async function resolve(report: Report, action: "DISMISS" | "REMOVE_CONTENT") {
    if (action === "REMOVE_CONTENT" && !window.confirm("Supprimer définitivement ce contenu ?")) return;
    setBusyId(report.id);
    try {
      await api.admin.resolveReport(report.id, action);
      // Le statut filtré (PENDING) ne l'inclut plus une fois traité — retiré de la liste plutôt que mis à jour en place.
      setReports((prev) => prev.filter((r) => r.id !== report.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de traiter ce signalement.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Shell>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Signalements</h1>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ReportStatus)}
          className="rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-sm outline-none"
        >
          <option value="PENDING">En attente</option>
          <option value="RESOLVED">Résolus</option>
          <option value="DISMISSED">Ignorés</option>
        </select>
      </div>

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {loading && <p className="text-sm text-muted">Chargement...</p>}
      {!loading && reports.length === 0 && <p className="text-sm text-muted">Aucun signalement.</p>}

      <div className="flex flex-col gap-3">
        {reports.map((report) => (
          <div key={report.id} className="rounded-2xl border border-border bg-surface-raised p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium tracking-wide text-muted uppercase">
                  {TARGET_LABEL[report.targetType]} · signalé par @{report.reporter.username}
                </p>
                <p className="mt-1 text-sm">{report.reason}</p>
                <p className="mt-2 truncate text-sm text-muted italic">
                  {report.targetPreview ?? "Contenu déjà supprimé."}
                </p>
              </div>
              {status === "PENDING" && (
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => void resolve(report, "DISMISS")}
                    disabled={busyId === report.id}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs transition hover:bg-surface disabled:opacity-50"
                  >
                    Ignorer
                  </button>
                  {report.targetType !== "USER" && (
                    <button
                      onClick={() => void resolve(report, "REMOVE_CONTENT")}
                      disabled={busyId === report.id}
                      className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-50"
                    >
                      Supprimer le contenu
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {nextCursor && (
        <button
          onClick={() => void loadMore()}
          className="mt-4 rounded-xl border border-border px-4 py-2 text-sm transition hover:bg-surface-raised"
        >
          Charger plus
        </button>
      )}
    </Shell>
  );
}
