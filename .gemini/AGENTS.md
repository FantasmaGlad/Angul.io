# Consignes et Directives de Développement pour Gemini & Antigravity

Ce document régit les principes d'architecture, la méthodologie de travail et l'utilisation de la cartographie du dépôt **Angul.io** pour l'assistant **Gemini / Antigravity**.

---

## 1. Vue d'ensemble de l'Architecture (Monorepo)

Le dépôt Angul.io est structuré sous forme de monorepo **npm workspaces** comprenant 4 paquets :

```
shared/   Code TypeScript partagé (types, protocole WebSocket, formules géométriques/mouvement)
server/   Serveur de jeu Node.js (moteur de simulation, GameMods, WebSocket, comptes, admin)
client/   Client web joueur (rendu Canvas 2D + interface React, PWA)
admin/    Interface d'administration indépendante (React)
```

- `server` dépend de `shared`.
- `client` et `admin` dépendent de `shared` et sont deux applications React complètement **indépendantes** (bundles séparés).
- La documentation technique principale est [README.md](file:///home/fanta/Dev/Angul.io/README.md) et la cartographie détaillée fichier par fichier est dans [structure.md](file:///home/fanta/Dev/Angul.io/structure.md).

---

## 2. RÈGLE D'OR DE NAVIGATION : Utilisation du Serveur MCP

> [!IMPORTANT]
> **Interdiction d'avancer à l'aveugle.**
> Avant d'effectuer une recherche textuelle large (`grep`) ou d'explorer l'arborescence au hasard, tu **DOIS** utiliser le serveur MCP local `angulio-project-map`.

### Outils MCP disponibles (`angulio-project-map`) :
- `find_file(query)` : Recherche par mot-clé (ex: "dash", "skin avatar", "collision bots") dans la cartographie des 100+ fichiers du repo.
- `list_topics()` : Liste les catégories thématiques pré-indexées (ex: `bots`, `dash`, `avatars/skins`, `collision/tunneling`).
- `get_topic_files(topic)` : Récupère directement tous les fichiers pertinents pour un sujet donné.
- `list_workspaces()` : Affiche le rôle et les dépendances des 4 workspaces npm.
- `get_full_map()` : Retourne la cartographie JSON complète (`project-structure.json`).

---

## 3. Maintenance de la Cartographie

Toute modification de structure de fichiers (ajout, déplacement ou suppression d'un module, composant ou asset) impose une mise à jour immédiate :
1. **[structure.md](file:///home/fanta/Dev/Angul.io/structure.md)** : Mettre à jour la description humaine dans le même commit.
2. **`project-structure.json`** : Mettre à jour l'entrée correspondante dans `.claude/project-structure.json` (ou `.gemini/project-structure.json`).

---

## 4. Principes de Développement

1. **Partage Client/Serveur** : Les formules physiques (ex: mouvement en fonction de la masse dans `shared/src/movement.ts`) et les types de protocoles (`shared/src/protocol.ts`) DOIVENT rester strictement identiques entre la prédiction client et l'autorité serveur.
2. **Système de Mods (`GameMod`)** : Tout nouveau mode de jeu doit implémenter l'interface `GameMod` définie dans `server/src/engine/mod.ts` et s'appuyer sur des configurations JSON (`server/configs/`).
3. **Tests** : Utiliser Vitest (`npm test` ou `npx vitest`) pour valider toute modification de la logique métier dans `shared/` ou `server/`.
4. **Principes généraux** (portables, communs à tous mes projets — dupliqués à l'identique dans [CLAUDE.md](file:///home/fanta/Dev/Angul.io/CLAUDE.md), garder les deux synchronisés) :
   - Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
   - Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
   - Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
   - Keep components modular and concerns clearly separated.
   - Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
   - Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume a library lacks a capability without checking its documentation and types.
   - Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.
