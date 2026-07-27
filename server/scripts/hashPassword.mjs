#!/usr/bin/env node
/**
 * Génère un hash argon2 à coller dans `ADMIN_PASSWORD_HASH` (server/.env, Lot 5.1) — l'admin
 * n'a pas de ligne en base comme les comptes joueurs, donc pas d'écran d'inscription pour en
 * produire un. Script volontairement en JS simple (pas de build requis), même principe que
 * scripts/loadtest.mjs.
 *
 * Usage : node scripts/hashPassword.mjs <mot-de-passe>
 */
import argon2 from 'argon2';

const password = process.argv[2];
if (!password) {
  console.error('Usage : node scripts/hashPassword.mjs <mot-de-passe>');
  process.exit(1);
}

const hash = await argon2.hash(password);
console.log(hash);
