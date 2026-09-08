"use client";

import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { BouncingDots } from "@/components/BouncingDots";
import { PlusIcon } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Status } from "@/lib/types";
import { StatusComposer } from "./StatusComposer";
import { StatusRing } from "./StatusRing";
import { StatusViewer } from "./StatusViewer";

interface AuthorGroup {
  author: Status["author"];
  statuses: Status[]; // du plus ancien au plus récent
  hasUnviewed: boolean;
}

function groupByAuthor(statuses: Status[]): AuthorGroup[] {
  const byAuthor = new Map<string, Status[]>();
  // La liste arrive triée du plus récent au plus ancien (voir
  // StatusesService.listVisible) : on la parcourt à l'envers pour que
  // chaque groupe soit dans l'ordre chronologique attendu par le viewer.
  for (const status of [...statuses].reverse()) {
    const list = byAuthor.get(status.author.id) ?? [];
    list.push(status);
    byAuthor.set(status.author.id, list);
  }
  return [...byAuthor.values()].map((list) => ({
    author: list[0].author,
    statuses: list,
    hasUnviewed: list.some((s) => !s.viewedByMe),
  }));
}

/**
 * Occupe la 2e colonne (même emplacement que ConversationList) quand
 * "Statuts" est sélectionné dans le rail d'icônes — plus une modale
 * flottante, pour un comportement de navigation cohérent avec les autres
 * entrées (voir IconRail/chat/page.tsx). Composer et viewer restent des
 * recouvrements plein écran (immersion volontaire, comme avant).
 */
export function StatusesPanel({ hiddenOnMobile }: { hiddenOnMobile?: boolean }) {
  const { user } = useAuth();
  const [statuses, setStatuses] = useState<Status[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [viewingGroup, setViewingGroup] = useState<AuthorGroup | null>(null);

  function load() {
    api.statuses
      .list()
      .then(setStatuses)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les statuts."));
  }

  useEffect(load, []);

  const groups = useMemo(() => groupByAuthor(statuses ?? []), [statuses]);
  const myGroup = user ? groups.find((g) => g.author.id === user.id) : undefined;
  const otherGroups = user ? groups.filter((g) => g.author.id !== user.id) : groups;

  function handleCreated(status: Status) {
    setComposerOpen(false);
    setStatuses((prev) => [status, ...(prev ?? [])]);
  }

  function handleDeleted(statusId: string) {
    setStatuses((prev) => {
      const next = prev?.filter((s) => s.id !== statusId) ?? null;
      setViewingGroup((group) => {
        if (!group) return null;
        const remaining = group.statuses.filter((s) => s.id !== statusId);
        return remaining.length > 0 ? { ...group, statuses: remaining } : null;
      });
      return next;
    });
  }

  return (
    <div
      className={`min-h-0 min-w-0 flex-1 flex-col border-r border-border lg:flex lg:w-80 lg:flex-none lg:shrink-0 ${
        hiddenOnMobile ? "hidden" : "flex"
      }`}
    >
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-lg font-semibold">Statuts</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto glotta-scroll-hidden p-5">
        {user && (
          <div className="mb-5">
            <button onClick={() => setComposerOpen(true)} className="flex items-center gap-3 text-left">
              <span className="relative">
                <Avatar firstName={user.firstName} lastName={user.lastName} avatarUrl={user.profile?.avatarUrl} size={56} />
                <span className="absolute right-0 bottom-0 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[var(--surface)] bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)]">
                  <PlusIcon size={12} />
                </span>
              </span>
              <div>
                <p className="text-sm font-medium">Mon statut</p>
                <p className="text-xs text-muted">
                  {myGroup ? `${myGroup.statuses.length} statut(s) actif(s)` : "Ajouter un statut"}
                </p>
              </div>
            </button>

            {composerOpen && (
              <div className="mt-4">
                <StatusComposer onCreated={handleCreated} onClose={() => setComposerOpen(false)} />
              </div>
            )}
          </div>
        )}

        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
        {statuses === null && !error && (
          <div className="flex justify-center py-6">
            <BouncingDots />
          </div>
        )}

        {statuses !== null && otherGroups.length === 0 && (
          <p className="text-sm text-muted">Aucun statut récent de vos contacts.</p>
        )}

        {otherGroups.length > 0 && (
          <>
            <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Récents</p>
            <div className="flex flex-wrap gap-3">
              {otherGroups.map((group) => (
                <StatusRing
                  key={group.author.id}
                  author={group.author}
                  hasUnviewed={group.hasUnviewed}
                  onClick={() => setViewingGroup(group)}
                />
              ))}
            </div>
          </>
        )}

        {myGroup && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Mes statuts</p>
            <button onClick={() => setViewingGroup(myGroup)} className="flex items-center gap-2 text-sm text-[var(--accent-2)] hover:underline">
              Voir mes {myGroup.statuses.length} statut(s)
            </button>
          </div>
        )}
      </div>

      {viewingGroup && (
        <StatusViewer
          statuses={viewingGroup.statuses}
          startIndex={Math.max(
            0,
            viewingGroup.statuses.findIndex((s) => !s.viewedByMe),
          )}
          onClose={() => setViewingGroup(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
