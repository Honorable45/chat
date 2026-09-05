"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, ApiError } from "@/lib/api";
import type { AdminMetrics } from "@/lib/types";

function Card({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin
      .metrics()
      .then(setMetrics)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger le tableau de bord."));
  }, []);

  return (
    <Shell>
      <h1 className="mb-5 text-lg font-semibold">Tableau de bord</h1>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!metrics && !error && <p className="text-sm text-muted">Chargement...</p>}

      {metrics && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card label="Utilisateurs" value={metrics.users.total} hint={`${metrics.users.active} actifs`} />
          <Card
            label="Messages envoyés"
            value={metrics.messagesSent.total}
            hint={`${metrics.messagesSent.last7Days} sur les 7 derniers jours`}
          />
          <Card label="Appels" value={metrics.calls.total} />
          <Card label="Statuts actifs" value={metrics.activeStatuses} hint="Non expirés (24h)" />
          <Card label="Signalements en attente" value={metrics.reports.pending} />
        </div>
      )}
    </Shell>
  );
}
