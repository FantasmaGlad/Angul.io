import { randomUUID } from 'node:crypto';

/** Score/XP d'une vie de joueur INVITÉ (pas de compte au moment de la mort), en attente d'être
 * réclamé s'il crée un compte ou se connecte dans la foulée (demande utilisateur, écran de fin de
 * partie) — voir `AccountsService.createScoreClaim`/`claimScore`. */
interface PendingScoreClaim {
  modId: string;
  /** Masse maximale atteinte pendant cette vie (voir `DeathInfo.finalScore`) — créditée à
   * `player_best_scores` via `recordBestMass`, JAMAIS transformée par un mod (même convention que
   * pour un joueur déjà connecté, voir broadcast.ts `onPlayerDeath`). */
  finalScore: number;
  /** Score/XP APRÈS `GameMod.transformScoreForAccount` — créditée via `recordGameResult`. */
  transformedScore: number;
  transformedXp: number;
  expiresAt: number;
}

export interface PendingScoreClaims {
  /** Enregistre une vie d'invité qui vient de se terminer, renvoie un identifiant OPAQUE
   * (UUID aléatoire, jamais le score lui-même) à transmettre au client — voir le commentaire
   * d'en-tête sur pourquoi le montant ne transite jamais par le client en clair. */
  create(modId: string, finalScore: number, transformedScore: number, transformedXp: number): string;
  /** Usage UNIQUE : `undefined` si l'identifiant est inconnu, déjà consommé, ou expiré — la
   * réclamation retire l'entrée dans tous les cas (succès ou échec), jamais rejouable. */
  consume(claimId: string): PendingScoreClaim | undefined;
}

/** Assez long pour couvrir le temps de décision + inscription/connexion d'un joueur qui vient de
 * mourir (lire l'écran de fin de partie, hésiter, remplir un formulaire), assez court pour ne pas
 * accumuler indéfiniment des entrées jamais réclamées (voir le `setTimeout` de nettoyage dans
 * `create`, ci-dessous — filet de sécurité si `consume` n'est jamais appelé pour ce claim). */
const DEFAULT_CLAIM_TTL_MS = 30 * 60_000;

/**
 * Table en mémoire (claim opaque -> score en attente), symétrique de `SessionStore` (voir
 * sessionStore.ts) — même raison d'être hors base de données : purement éphémère, jamais besoin
 * de survivre à un redémarrage du process.
 */
export function createPendingScoreClaims(ttlMs: number = DEFAULT_CLAIM_TTL_MS): PendingScoreClaims {
  const claimsById = new Map<string, PendingScoreClaim>();

  return {
    create(modId, finalScore, transformedScore, transformedXp) {
      const claimId = randomUUID();
      claimsById.set(claimId, {
        modId,
        finalScore,
        transformedScore,
        transformedXp,
        expiresAt: Date.now() + ttlMs,
      });
      // Filet de sécurité : purge même si `consume` n'est jamais appelé (invité qui ne crée
      // finalement pas de compte) — sans ça, chaque mort de joueur invité laisserait une entrée
      // orpheline indéfiniment (fuite mémoire lente sur un serveur de longue durée).
      setTimeout(() => claimsById.delete(claimId), ttlMs);
      return claimId;
    },
    consume(claimId) {
      const claim = claimsById.get(claimId);
      if (!claim) return undefined;
      claimsById.delete(claimId);
      if (Date.now() > claim.expiresAt) return undefined;
      return claim;
    },
  };
}
