/**
 * Limiteur de débit minimal pour les événements WebSocket entrants (audit de
 * sécurité) : `ThrottlerGuard` (HTTP, section 23) est désactivé sur les deux
 * gateways via `@SkipThrottle()` — son implémentation suppose un objet
 * réponse Express (`res.header(...)`) absent en contexte WebSocket, voir le
 * commentaire sur EventsGateway — ce qui laissait chaque événement entrant
 * (`message:typing`, signalisation d'appel...) sans aucune limite. Une
 * fenêtre glissante par (socket, catégorie d'événement) : suffisant ici, un
 * client ne peut pas se refaire un quota juste en spammant tant que son
 * socket reste ouvert (une reconnexion recrée un nouvel id de socket, donc
 * un nouveau quota — même compromis que le rate limiting HTTP par IP,
 * suffisant contre un client bavard/bogué, pas contre un botnet dédié).
 */
export class SocketRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** `true` si l'appel est autorisé (et compté dans le quota), `false` au-delà de la limite. */
  consume(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** À appeler à la déconnexion du socket : sans ça, `hits` grossirait indéfiniment. */
  clear(key: string): void {
    this.hits.delete(key);
  }
}
