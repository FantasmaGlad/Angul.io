---
name: angulio-navigation
description: Guide et recherche d'architecture dans le monorepo Angul.io à l'aide de la cartographie MCP et de structure.md. À utiliser au début de chaque tâche pour localiser les fichiers pertinents sans avancer à l'aveugle.
---

# Skill de Navigation — Angul.io

Ce skill régit la recherche de code et d'architecture dans le monorepo **Angul.io** (shared, server, client, admin).

## Quand utiliser ce skill ?
- Lorsque l'utilisateur demande de créer ou modifier une fonctionnalité (ex: "ajouter un pouvoir", "modifier les bots", "corriger un bug de rendu canvas", "ajouter un paramètre admin").
- Avant de faire tout `grep_search` ou exploration de fichiers.

## Instructions
1. **Interroger l'outil MCP `angulio-project-map`** :
   - Pour trouver les fichiers par thématique : utiliser `find_file` avec des mots-clés (ex: `find_file(query: "dash impulsion")`).
   - Pour explorer par domaine : utiliser `list_topics` puis `get_topic_files`.
   - Pour comprendre les dépendances entres paquets : utiliser `list_workspaces`.

2. **Référer à la cartographie humaine** :
   - Lire `structure.md` ou `README.md` si une vision d'ensemble du moteur de jeu ou du protocole réseau est nécessaire.

3. **Conserver la cartographie à jour** :
   - Si ton travail ajoute, déplace ou supprime des fichiers dans le projet, mets impérativement à jour `structure.md` et `.claude/project-structure.json`.
