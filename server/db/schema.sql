-- =============================================================================================
-- Angul.io — schéma PostgreSQL de référence (comptes joueurs, Lot 3)
-- =============================================================================================
--
-- Ce fichier N'EST PAS exécuté par l'application ni par les tests : c'est une photographie
-- lisible du schéma actuel, à jour manuellement, destinée au tracking et à la documentation
-- (voir structure.md). La source de vérité exécutable reste les migrations versionnées dans
-- server/migrations/ (node-pg-migrate, appliquées via `npm run migrate:up --workspace=server`).
--
-- Si tu ajoutes/modifies une migration : mets aussi ce fichier à jour dans le même commit, pour
-- qu'un nouveau contributeur puisse lire l'état actuel sans reconstituer l'historique complet
-- des migrations dans sa tête.
--
-- Migrations reconstituées ici (dans l'ordre d'application) :
--   1785090813268_init.cjs              → table `players` (squelette)
--   1785093515852_add-password-hash.cjs → players.password_hash
--   1785093516340_full-account-model.cjs→ players.{level,xp,premium,cosmetics} + player_best_scores
--   1785135367447_add-banned-flag.cjs   → players.banned
--   1785167636144_seed-fanta-premium.cjs→ UPDATE de données (pas de schéma) : premium=TRUE pour
--                                          le compte "Fanta" (refonte UI/UX accueil)
--   1785200000000_add-avatar-color.cjs  → players.avatar_color (avatar procédural)
--   1785210000000_add-death-screen-customization.cjs → players.{death_message,death_banner_id}
--
-- Portée : uniquement les données persistantes (PostgreSQL). L'état de partie en cours (positions,
-- masses, salons actifs) vit en mémoire côté serveur (server/src/engine/) et n'est jamais écrit
-- ici — voir cahier_des_charges.md §4.4 ("mémoire pour le chaud, PostgreSQL pour le froid").
-- Les sessions/tokens de connexion sont elles aussi en mémoire uniquement
-- (server/src/accounts/sessionStore.ts), pas de table de sessions dans ce schéma.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- Table : players
-- ---------------------------------------------------------------------------------------------
-- Un compte joueur (cahier des charges §5.2). Créée à l'inscription (Lot 3.2), modifiable par
-- l'admin (Lot 5.2-5.4, server/src/net/server.ts routes /api/admin/players/*) et par le serveur
-- de jeu en fin de partie (level/xp, voir accountsRepository.recordGameResult).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE players (
    id            SERIAL PRIMARY KEY,

    -- Identifiant affiché, unique (cahier des charges §5.2). Recherché par sous-chaîne
    -- insensible à la casse côté admin (ILIKE '%query%') — pas d'index dédié pour l'instant,
    -- volume de comptes attendu (10-50 joueurs simultanés, MVP) trop faible pour en justifier un.
    pseudo         TEXT        NOT NULL UNIQUE,

    -- Hash argon2 (server/src/accounts/passwords.ts) — jamais de mot de passe en clair
    -- (cahier des charges §5.1, exigence de sécurité non négociable).
    password_hash  TEXT        NOT NULL,

    -- Progression du compte. `level` est dénormalisé : recalculé et réécrit à chaque partie
    -- (server/src/accounts/levels.ts, `levelForXp`) plutôt que dérivé à la volée à chaque
    -- lecture — l'écran de profil (Lot 3.6) fait une simple lecture directe.
    level          INTEGER     NOT NULL DEFAULT 1,
    xp             INTEGER     NOT NULL DEFAULT 0,

    -- Statut Premium (don libre, cahier des charges §5.3) — active la création de salons
    -- (Lot 6.4). Activation manuelle par l'admin pour le MVP, voir server/src/net/server.ts.
    premium        BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Identifiants de cosmétiques débloqués — simple tableau de texte, pas de table dédiée tant
    -- que le contenu détaillé des cosmétiques n'est pas spécifié (cahier des charges §8.2).
    cosmetics      TEXT[]      NOT NULL DEFAULT '{}',

    -- Bannissement (Lot 5.2, cahier des charges §5.4). Colonne booléenne simple : pas de motif
    -- ni de durée, pas d'historique des sanctions pour le MVP (voir aussi §10 du cahier des
    -- charges UI/UX — un historique de modération est une évolution possible, pas encore faite).
    banned         BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Avatar procédural (refonte UI/UX) : couleur de blob choisie parmi shared/src/avatarPalette.ts
    -- (NULL = pas de choix explicite, repli déterministe sur le pseudo, voir connectionHandler.ts).
    avatar_color   TEXT,

    -- Écran de mort personnalisé (cahier des charges fourni) : message libre + bannière parmi le
    -- catalogue shared/src/deathBanners.ts (pas d'upload d'image, voir la migration dédiée).
    death_message    VARCHAR(100) NOT NULL DEFAULT 'Bien joué ! À la prochaine.'
                     CONSTRAINT chk_death_message_length CHECK (char_length(death_message) <= 100),
    death_banner_id  VARCHAR(50)  NOT NULL DEFAULT 'default_skull',

    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------------------------
-- Table : player_best_scores
-- ---------------------------------------------------------------------------------------------
-- Meilleur score par (joueur, mode) — un mode = un fichier de config chargé dynamiquement
-- (server/src/mods/parametric/, server/configs/*.json), pas une énumération fixée en base,
-- donc `mode_id` est un texte libre plutôt qu'une clé étrangère vers une table "modes"
-- (qui n'existe pas). Écrite en fin de partie (Lot 3.5,
-- server/src/accounts/accountsRepository.ts `recordGameResult`, transaction avec la mise à jour
-- de players.xp/level).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE player_best_scores (
    player_id   INTEGER     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    mode_id     TEXT        NOT NULL,
    best_score  INTEGER     NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (player_id, mode_id)
);


-- ---------------------------------------------------------------------------------------------
-- Requêtes de tracking utiles (lecture seule) — pense-bête pour l'admin/le débogage manuel.
-- Pas utilisées par le code applicatif (qui passe par accountsRepository.ts), juste pratiques
-- en psql direct.
-- ---------------------------------------------------------------------------------------------

-- Comptes récemment créés :
--   SELECT id, pseudo, level, xp, premium, banned, created_at
--   FROM players ORDER BY created_at DESC LIMIT 20;

-- Classement global (tous modes confondus) — équivalent de l'endpoint de classement qui
-- n'existe pas encore côté API (cahier_des_charges_ui_ux.md §10) :
--   SELECT p.pseudo, s.mode_id, s.best_score
--   FROM player_best_scores s
--   JOIN players p ON p.id = s.player_id
--   ORDER BY s.best_score DESC LIMIT 50;

-- Comptes Premium actifs (utile pour recouper avec les dons Ko-fi reçus, §5.5) :
--   SELECT id, pseudo, created_at FROM players WHERE premium = TRUE ORDER BY created_at DESC;
