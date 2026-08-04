# CLAUDE.md

Consignes de projet pour Claude Code sur **Angul.io**, lues automatiquement en début de session.

Pour l'architecture détaillée, voir [README.md](README.md) (référence technique + guide de
modding) et [structure.md](structure.md) (cartographie fichier par fichier). Équivalent pour
Gemini/Antigravity : [.gemini/AGENTS.md](.gemini/AGENTS.md) — les principes généraux ci-dessous y
sont dupliqués à l'identique ; garde les deux synchronisés si tu les modifies (voir structure.md
§1bis pour la logique de coordination entre plateformes IA).

## Navigation

Avant une recherche textuelle large (`grep`) ou une exploration du dépôt à l'aveugle, interroge le
serveur MCP local `angulio-project-map` (`find_file`, `list_topics`, `get_topic_files`,
`get_full_map`, `list_workspaces`) — cartographie indexée des 100+ fichiers du dépôt, voir
structure.md §1bis.

## Principes généraux

- Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility
  layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative
  abstractions, configuration, and indirection.
- Grow the system in layers. Start from the smallest version that works end to end, and add each
  new capability on top of a product that already works. Never trade a working product for
  unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve
  reliability. Do not reimplement common functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own implementation or adding
  packages. Do not assume a library lacks a capability without checking its documentation and
  types.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now
  and is meant to be replaced later.

## Maintenance de la cartographie

Toute modification de structure de fichiers (ajout, déplacement, suppression d'un module,
composant ou asset) impose une mise à jour immédiate (même commit) de structure.md et de
`.claude/project-structure.json` (symlinké depuis `.gemini/project-structure.json`).
