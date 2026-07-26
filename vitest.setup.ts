import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Charge server/.env (DATABASE_URL) pour les tests d'intégration Postgres (accountsRepository,
// service, net/server "comptes") — en CI, DATABASE_URL est fournie autrement (variable
// d'environnement, voir .github/workflows/ci.yml) : `override: false` par défaut chez dotenv
// laisse cette valeur gagner plutôt que d'être écrasée par un `server/.env` absent en CI.
config({ path: fileURLToPath(new URL('./server/.env', import.meta.url)) });
