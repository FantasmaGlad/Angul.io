/**
 * Rate Limiter générique basé sur une fenêtre glissante (sliding window).
 * Permet de restreindre le nombre de tentatives par clé (ex: adresse IP) sur une période donnée.
 */
export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts = 3, windowMs = 60_000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  /**
   * Vérifie et enregistre une tentative pour la clé donnée.
   * Renvoie `true` si la tentative est autorisée, `false` si la limite est dépassée.
   */
  consume(key: string): boolean {
    if (this.maxAttempts <= 0 || !Number.isFinite(this.maxAttempts)) {
      return true;
    }

    const now = Date.now();
    const timestamps = this.attempts.get(key) ?? [];

    const validTimestamps = timestamps.filter((t) => now - t < this.windowMs);

    if (validTimestamps.length >= this.maxAttempts) {
      this.attempts.set(key, validTimestamps);
      return false;
    }

    validTimestamps.push(now);
    this.attempts.set(key, validTimestamps);
    return true;
  }

  /**
   * Nettoie les clés expirées de la mémoire.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.attempts.entries()) {
      const valid = timestamps.filter((t) => now - t < this.windowMs);
      if (valid.length === 0) {
        this.attempts.delete(key);
      } else {
        this.attempts.set(key, valid);
      }
    }
  }

  /**
   * Efface l'historique pour une clé ou pour toutes les clés (utile pour les tests).
   */
  reset(key?: string): void {
    if (key) {
      this.attempts.delete(key);
    } else {
      this.attempts.clear();
    }
  }
}
