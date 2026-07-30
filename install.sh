#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# install.sh — Bootstrap complet et mise à jour d'un nœud Angul.io (Lot 8)
# ==============================================================================
# Pensé pour le Wyse 5070 (§8.2 du cahier des charges) sur Ubuntu Server ou Debian
# fraîchement installé (dépôts NodeSource/Caddy agnostiques de la distro).
#
# Ce script met en place et maintient :
#   - Dépendances système + Node.js v20+ (§8.4)
#   - PostgreSQL + rôle/base applicatifs, `server/.env` (`DATABASE_URL`/`ADMIN_PASSWORD_HASH`)
#     et migrations automatiques (Lot 3, comptes joueurs)
#   - Récupération, nettoyage propre des caches TypeScript (`.tsbuildinfo`) et compilation
#     intégrale du code depuis GitHub (shared, server, client, admin)
#   - Service systemd du serveur de jeu (`angulio.service`), démarré automatiquement au boot (§8.4)
#     avec vérification immédiate de santé au lancement
#   - Pare-feu ufw (SSH + HTTP/HTTPS uniquement — le port de jeu n'est pas exposé directement)
#   - Caddy en reverse proxy avec HTTPS automatique (Let's Encrypt) sur le sous-domaine DuckDNS (§8.5)
#   - Timer systemd de mise à jour périodique de l'IP DuckDNS (§8.3)
#   - Alerte ntfy.sh optionnelle si le service de jeu tombe (§8.6, voir ALERT_NTFY_TOPIC)
#
# Idempotent et auto-nettoyant :
#   Relancer ce script après un `git push` nettoie les résidus/caches locaux, récupère
#   la dernière version, rebuild proprement, rejoue les migrations PostgreSQL et
#   redémarre le service sans interrompre la configuration existante (`server/.env` conservé).
#
# Usage :
#   1. Renseigner DUCKDNS_SUBDOMAIN, DUCKDNS_TOKEN et ADMIN_PASSWORD (ou ADMIN_PASSWORD_HASH)
#      en haut de ce script au premier déploiement.
#   2. sudo ./install.sh
# ==============================================================================

# --- Configuration à adapter --------------------------------------------------
REPO_URL="https://github.com/FantasmaGlad/Angul.io.git"
APP_DIR="/opt/angulio"
APP_USER="angulio"
GAME_PORT="8080"
NODE_MAJOR="20"

DUCKDNS_SUBDOMAIN="${DUCKDNS_SUBDOMAIN:-angulio}"                                  # ex. "angulio" -> angulio.duckdns.org
DUCKDNS_TOKEN="${DUCKDNS_TOKEN:-04a14b39-d04b-4a17-a8a8-c8488c457aaf}"              # jeton depuis https://www.duckdns.org
LETSENCRYPT_EMAIL="clement.barillot3901@gmail.com"    # contact ACME de Caddy
ADMIN_PASSWORD=""                                     # mot de passe admin en clair au premier déploiement
ADMIN_PASSWORD_HASH=""                                # alternative : hash argon2 déjà calculé
DB_NAME="angulio_prod"
DB_USER="angulio"
ALERT_NTFY_TOPIC=""    # optionnel — sujet ntfy.sh (ex. "angulio-alertes-x7q2f")
# --------------------------------------------------------------------------------

if [[ $EUID -ne 0 ]]; then
  echo "Ce script doit être exécuté en root (sudo ./install.sh)." >&2
  exit 1
fi

if [[ -z "$DUCKDNS_SUBDOMAIN" || -z "$DUCKDNS_TOKEN" ]]; then
  echo "Renseigne DUCKDNS_SUBDOMAIN et DUCKDNS_TOKEN en haut de ce script avant de le lancer." >&2
  exit 1
fi

DOMAIN="${DUCKDNS_SUBDOMAIN}.duckdns.org"

log() { echo -e "\n>>> $1"; }

# --- 1. Dépendances système ------------------------------------------------------
log "Mise à jour du système et installation des dépendances de base"
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git ufw ca-certificates gnupg apt-transport-https openssl postgresql

# --- 2. Node.js -------------------------------------------------------------------
CURRENT_NODE_MAJOR="$(command -v node >/dev/null && node -v | grep -oE '^v[0-9]+' | tr -d v || echo 0)"
if [[ "$CURRENT_NODE_MAJOR" -lt "$NODE_MAJOR" ]]; then
  log "Installation de Node.js ${NODE_MAJOR}.x (dépôt NodeSource)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  log "Node.js déjà présent ($(node -v)), installation ignorée"
fi

# --- 3. Caddy (reverse proxy + HTTPS automatique) ---------------------------------
if ! command -v caddy >/dev/null; then
  log "Installation de Caddy (dépôt officiel)"
  apt-get install -y debian-keyring debian-archive-keyring
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
else
  log "Caddy déjà présent, installation ignorée"
fi

# --- 4. Utilisateur système dédié --------------------------------------------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Création de l'utilisateur système $APP_USER"
  useradd --system --no-create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

# --- 5. Récupération, réinitialisation propre et build du code ---------------------
if [[ -d "$APP_DIR/.git" ]]; then
  log "Code déjà présent dans $APP_DIR : réinitialisation propre et mise à jour (git pull)"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard
  sudo -u "$APP_USER" git -C "$APP_DIR" clean -fd
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
else
  log "Clonage du dépôt dans $APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "Nettoyage complet des caches de compilation (tsbuildinfo, dist, public généré) et compilation globale"
# Les 4 workspaces (shared, server, client, admin) produisent chacun leur propre
# tsconfig.tsbuildinfo — un déploiement précédent qui n'en purgeait que 2/4 (shared, server)
# pouvait laisser le cache incrémental de tsc du CLIENT/ADMIN perimé d'un déploiement à l'autre.
# client/public et admin/public (assets copiés par le script `prebuild`, voir client/package.json)
# sont eux aussi entièrement régénérés à chaque build : les supprimer avant plutôt que de laisser
# `cp -r`/vite accumuler d'anciens fichiers qu'un déploiement suivant n'aurait plus de raison de
# recopier (asset renommé/supprimé côté source).
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && rm -rf shared/dist server/dist client/dist admin/dist client/public admin/public shared/tsconfig.tsbuildinfo server/tsconfig.tsbuildinfo client/tsconfig.tsbuildinfo admin/tsconfig.tsbuildinfo && npm ci && npm run build"

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# --- 6. PostgreSQL & Migrations ---------------------------------------------------
systemctl enable --now postgresql

ENV_FILE="${APP_DIR}/server/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Premier déploiement : création du rôle/base PostgreSQL et de server/.env"

  if [[ -z "$ADMIN_PASSWORD" && -z "$ADMIN_PASSWORD_HASH" ]]; then
    echo "Renseigne ADMIN_PASSWORD ou ADMIN_PASSWORD_HASH en haut de ce script avant le premier déploiement." >&2
    exit 1
  fi

  DB_PASSWORD="$(openssl rand -hex 24)"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
    || sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
    || sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

  if [[ -z "$ADMIN_PASSWORD_HASH" ]]; then
    ADMIN_PASSWORD_HASH="$(sudo -u "$APP_USER" --chdir="${APP_DIR}/server" node scripts/hashPassword.mjs "$ADMIN_PASSWORD")"
  fi

  cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}
ADMIN_PASSWORD_HASH=${ADMIN_PASSWORD_HASH}
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  log "server/.env déjà présent : identifiants et hash admin conservés"
fi

log "Application des migrations PostgreSQL"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR/server' && npm run migrate:up"

# --- 7. Service systemd du serveur de jeu (+ alerte optionnelle) -------------------
ONFAILURE_LINE=""
if [[ -n "$ALERT_NTFY_TOPIC" ]]; then
  log "Écriture de l'alerte ntfy.sh (sujet : $ALERT_NTFY_TOPIC)"
  cat > /opt/angulio-alert.sh <<EOF
#!/usr/bin/env bash
curl -fsS -H "Title: Angul.io down" -d "Le service angulio.service est tombé sur $(hostname)." \
  "https://ntfy.sh/${ALERT_NTFY_TOPIC}" -o /var/log/angulio-alert.log
EOF
  chmod +x /opt/angulio-alert.sh

  cat > /etc/systemd/system/angulio-alert.service <<'EOF'
[Unit]
Description=Alerte ntfy.sh si angulio.service tombe

[Service]
Type=oneshot
ExecStart=/opt/angulio-alert.sh
EOF
  ONFAILURE_LINE="OnFailure=angulio-alert.service"
else
  log "ALERT_NTFY_TOPIC non renseigné : pas d'alerte configurée"
fi

log "Écriture du service systemd angulio.service"
cat > /etc/systemd/system/angulio.service <<EOF
[Unit]
Description=Angul.io - serveur de jeu
After=network.target postgresql.service
Wants=postgresql.service
StartLimitIntervalSec=60
StartLimitBurst=5
${ONFAILURE_LINE}

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}/server
Environment=PORT=${GAME_PORT}
ExecStart=/usr/bin/node ${APP_DIR}/server/dist/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable angulio
systemctl restart angulio

# Vérification active de santé du service
sleep 2
if ! systemctl is-active --quiet angulio; then
  log "ERREUR : Le service angulio n'a pas pu démarrer. Extrait du journal systemd :"
  journalctl -u angulio -n 25 --no-pager >&2
  exit 1
fi

# --- 8. Mise à jour de l'IP DuckDNS ------------------------------------------------
log "Configuration de la mise à jour périodique DuckDNS"
mkdir -p /opt/duckdns
cat > /opt/duckdns/update.sh <<EOF
#!/usr/bin/env bash
curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=" \
  -o /var/log/duckdns.log
EOF
chmod +x /opt/duckdns/update.sh

log "Mise à jour immédiate de l'IP DuckDNS"
/opt/duckdns/update.sh || true

cat > /etc/systemd/system/duckdns-update.service <<'EOF'
[Unit]
Description=Mise a jour de l'IP DuckDNS

[Service]
Type=oneshot
ExecStart=/opt/duckdns/update.sh
EOF

cat > /etc/systemd/system/duckdns-update.timer <<'EOF'
[Unit]
Description=Lance la mise a jour DuckDNS toutes les 5 minutes

[Timer]
OnBootSec=30
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now duckdns-update.timer

# --- 9. Reverse proxy Caddy --------------------------------------------------------
log "Écriture du Caddyfile pour $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
{
    email ${LETSENCRYPT_EMAIL}
}

${DOMAIN} {
    reverse_proxy localhost:${GAME_PORT}
}
EOF

systemctl enable caddy
systemctl restart caddy

# --- 10. Pare-feu (ufw) ------------------------------------------------------------
log "Configuration du pare-feu (ufw)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# --- Résumé -------------------------------------------------------------------------
log "Déploiement et installation terminés avec succès."
echo "Serveur de jeu : systemctl status angulio        (actif sur 127.0.0.1:${GAME_PORT})"
echo "PostgreSQL     : systemctl status postgresql      (base ${DB_NAME})"
echo "Reverse proxy  : systemctl status caddy           (https://${DOMAIN})"
echo "DuckDNS        : systemctl status duckdns-update.timer"
if [[ -n "$ALERT_NTFY_TOPIC" ]]; then
  echo "Alerte         : ntfy.sh/${ALERT_NTFY_TOPIC}"
else
  echo "Alerte         : non configurée"
fi
echo
echo "Note :"
echo "  S'assurer que la redirection de port (NAT/PAT) sur la box Internet pointe vers"
echo "  l'IP locale de cette machine pour les ports 80 et 443 (TCP)."
