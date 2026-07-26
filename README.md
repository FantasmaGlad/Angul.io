# Angul.io

Plateforme de jeu multijoueur en temps réel inspirée d'Agar.io, avec un système de
salons configurables et un système de modes de jeu scriptables ("mods"), pensée dès le
départ pour une future ouverture communautaire de l'API de modding.

- Cahier des charges complet : [cahier_des_charges.md](cahier_des_charges.md)
- Plan d'implémentation (suivi Lots/Sous-Lots) : [plan_implementation.md](plan_implementation.md)
- Formules de jeu (masse, vitesse, split, fusion…) : [metriques.md](metriques.md)

## Statut du projet

En développement — Lot 0 (cadrage & fondations) en cours. Voir
[plan_implementation.md](plan_implementation.md) pour le détail à jour de ce qui est
fait, en cours, et restant à faire.

## Structure du monorepo

```
shared/   code TypeScript partagé (types, constantes) entre server/client/admin
server/   serveur de jeu (boucle de simulation, WebSocket, API de mods)
client/   client web joueur (rendu Canvas, PWA)
admin/    interface d'administration
```

## Développement

Prérequis : Node.js ≥ 20.

```bash
npm install
npm run lint
npm test
npm run build
```

## Licence

Ce projet est distribué sous licence **GNU Affero General Public License v3.0 ou
ultérieure** (AGPL-3.0-or-later) — voir [LICENSE](LICENSE). Toute réutilisation, y
compris commerciale, est autorisée, à condition de rester open source sous la même
licence et de citer l'origine de ce projet.
