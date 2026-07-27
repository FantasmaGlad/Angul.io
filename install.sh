#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# install.sh — Bootstrap complet d'un nœud Angul.io (plan_implementation.md, Lot 8)
# ==============================================================================
# Pensé pour le Wyse 5070 (§8.2 du cahier des charges) sur Ubuntu Server fraîchement
# installé. Met en place :
#   - dépendances système + Node.js (§8.4)
#   - PostgreSQL + rôle/base applicatifs, `server/.env` (`DATABASE_URL`/`ADMIN_PASSWORD_HASH`)
#     et migrations (Lot 3, comptes joueurs — voir étape 6 ci-dessous)
#   - récupération et build du code depuis GitHub
#   - service systemd du serveur de jeu, démarré automatiquement au boot (§8.4)
#   - pare-feu ufw (SSH + HTTP/HTTPS uniquement — le port de jeu n'est jamais exposé
#     directement, tout passe par le reverse proxy)
#   - Caddy en reverse proxy avec HTTPS automatique (Let's Encrypt) sur le sous-domaine
#     DuckDNS (§8.5) — gère aussi le proxy WebSocket (upgrade géré nativement par Caddy)
#   - mise à jour périodique de l'IP DuckDNS, en filet de sécurité (§8.3)
#   - alerte ntfy.sh optionnelle si le service de jeu tombe (§8.6, voir ALERT_NTFY_TOPIC)
#
# Hors périmètre de ce script (à faire manuellement — voir plan_implementation.md) :
#   - §8.1 : installation de l'OS et premier accès SSH (préalable à tout le reste).
#   - §8.2 : redirection de port (NAT/PAT) sur la box Internet vers cette machine,
#     ports 80 et 443 — impossible à configurer depuis la machine elle-même.
#
# Idempotent : relancer ce script après une mise à jour du code (git push) récupère
# la dernière version, rebuild, rejoue les migrations, et redémarre le service — pas
# seulement un run jetable. `server/.env` n'est généré qu'au **premier** déploiement
# (mot de passe PostgreSQL/admin conservés tels quels sur les runs suivants, jamais
# régénérés dans le dos d'un déploiement existant).
#
# Usage :
#   1. Renseigner DUCKDNS_SUBDOMAIN, DUCKDNS_TOKEN et ADMIN_PASSWORD ci-dessous (les
#      autres valeurs par défaut conviennent pour un déploiement standard).
#      ADMIN_PASSWORD n'est nécessaire qu'au premier déploiement (server/.env absent) —
#      peut être vidé après coup, il n'est jamais réécrit sur le disque tel quel (seul
#      son hash argon2 l'est, dans server/.env).
#   2. sudo ./install.sh
# ==============================================================================

# --- Configuration à adapter --------------------------------------------------
REPO_URL="https://github.com/FantasmaGlad/Angul.io.git"
APP_DIR="/opt/angulio"
APP_USER="angulio"
GAME_PORT="8080"
NODE_MAJOR="20"

DUCKDNS_SUBDOMAIN=""                                  # ex. "angulio" -> angulio.duckdns.org — À REMPLIR
DUCKDNS_TOKEN=""                                      # jeton depuis https://www.duckdns.org — À REMPLIR
LETSENCRYPT_EMAIL="clement.barillot3901@gmail.com"    # contact ACME de Caddy, modifiable
ADMIN_PASSWORD=""                                     # mot de passe admin (Lot 5.1) — requis
                                                       # seulement au premier déploiement (voir
                                                       # étape 6 du script) — À REMPLIR puis, si voulu,
                                                       # vidable après un premier `./install.sh`
                                                       # réussi (seul son hash est conservé).
DB_NAME="angulio_prod"
DB_USER="angulio"
ALERT_NTFY_TOPIC=""    # optionnel (Lot 8.6) — sujet ntfy.sh (https://ntfy.sh) recevant une
                       # alerte si le service tombe. Aucun compte requis : choisis un nom de
                       # sujet difficile à deviner (ex. "angulio-alertes-x7q2f"), abonne-toi
                       # depuis l'app ntfy ou https://ntfy.sh/<sujet> dans un navigateur. Laissé
                       # vide : pas d'alerte configurée, le reste du script fonctionne pareil.
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

# --- 4. Utilisateur système dédié (pas de home pré-rempli : évite un conflit avec
#        git clone, qui exige un répertoire cible vide ou inexistant) ---------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Création de l'utilisateur système $APP_USER"
  useradd --system --no-create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

# --- 5. Récupération et build du code ---------------------------------------------
if [[ -d "$APP_DIR/.git" ]]; then
  log "Code déjà présent dans $APP_DIR : mise à jour (git pull)"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
else
  log "Clonage du dépôt dans $APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi

log "Installation des dépendances npm et build (shared/server/client/admin)"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci && npm run build"

# --- 6. PostgreSQL (Lot 3, comptes joueurs) : rôle/base applicatifs, server/.env,
#        migrations ------------------------------------------------------------------
# Ne génère server/.env (mot de passe PostgreSQL, hash admin) qu'au **premier** déploiement —
# un run ultérieur ne doit jamais régénérer des identifiants et casser une configuration qui
# fonctionne déjà (cohérent avec l'idempotence du reste du script).
systemctl enable --now postgresql

ENV_FILE="${APP_DIR}/server/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Premier déploiement : création du rôle/base PostgreSQL et de server/.env"

  if [[ -z "$ADMIN_PASSWORD" ]]; then
    echo "Renseigne ADMIN_PASSWORD en haut de ce script avant le premier déploiement (voir étape 6 du script)." >&2
    exit 1
  fi

  DB_PASSWORD="$(openssl rand -hex 24)"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
    || sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
    || sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

  # Mot de passe admin haché via le même script que le développement local
  # (server/scripts/hashPassword.mjs) — exécuté depuis server/ pour résoudre `argon2` installé
  # par `npm ci` juste au-dessus, jamais le mot de passe en clair écrit sur le disque.
  ADMIN_PASSWORD_HASH="$(sudo -u "$APP_USER" bash -c "cd '${APP_DIR}/server' && node scripts/hashPassword.mjs '${ADMIN_PASSWORD}'")"

  cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}
ADMIN_PASSWORD_HASH=${ADMIN_PASSWORD_HASH}
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  log "server/.env déjà présent : rôle/base PostgreSQL et hash admin conservés tels quels"
fi

log "Application des migrations PostgreSQL"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR/server' && npm run migrate:up"

# --- 7. Service systemd du serveur de jeu (+ alerte optionnelle, Lot 8.6) ----------
# `OnFailure=` (dans [Unit]) ne se déclenche pas à chaque redémarrage individuel (déjà couverts
# par `Restart=on-failure`, transparent) mais quand systemd renonce après plusieurs échecs
# rapprochés (`StartLimitIntervalSec`/`StartLimitBurst`) — un service qui redémarre une fois
# tout seul ne doit pas spammer d'alerte, un service qui crash-loop réellement, si.
ONFAILURE_LINE=""
if [[ -n "$ALERT_NTFY_TOPIC" ]]; then
  log "Écriture de l'alerte ntfy.sh (sujet : $ALERT_NTFY_TOPIC)"
  cat > /opt/angulio-alert.sh <<EOF
#!/usr/bin/env bash
curl -fsS -H "Title: Angul.io down" -d "Le service angulio.service est tombé sur $(hostname)." \\
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
  log "ALERT_NTFY_TOPIC non renseigné : pas d'alerte configurée (Lot 8.6, optionnel)"
fi

log "Écriture du service systemd angulio.service"
cat > /etc/systemd/system/angulio.service <<EOF
[Unit]
Description=Angul.io - serveur de jeu
After=network.target
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

# --- 8. Reverse proxy Caddy (HTTPS automatique sur le domaine DuckDNS) -------------
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

# --- 9. Pare-feu (ufw) : uniquement SSH + HTTP/HTTPS -------------------------------
# Le port de jeu (GAME_PORT) n'est volontairement pas ouvert : le serveur Node
# n'est joignable que via Caddy (localhost), jamais directement depuis l'extérieur.
log "Configuration du pare-feu (ufw)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# --- 10. Mise à jour périodique de l'IP DuckDNS (filet de sécurité, §8.3) -----------
log "Configuration de la mise à jour périodique DuckDNS"
mkdir -p /opt/duckdns
cat > /opt/duckdns/update.sh <<EOF
#!/usr/bin/env bash
curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=" \\
  -o /var/log/duckdns.log
EOF
chmod +x /opt/duckdns/update.sh

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

# --- Résumé -------------------------------------------------------------------------
log "Terminé."
echo "Serveur de jeu : systemctl status angulio        (écoute sur 127.0.0.1:${GAME_PORT})"
echo "PostgreSQL     : systemctl status postgresql      (base ${DB_NAME}, config dans server/.env)"
echo "Reverse proxy  : systemctl status caddy           (https://${DOMAIN})"
echo "DuckDNS        : systemctl status duckdns-update.timer"
if [[ -n "$ALERT_NTFY_TOPIC" ]]; then
  echo "Alerte         : ntfy.sh/${ALERT_NTFY_TOPIC} (abonne-toi depuis l'app ou un navigateur)"
else
  echo "Alerte         : non configurée (ALERT_NTFY_TOPIC vide, voir en tête de script)"
fi
echo
echo "Étape manuelle restante (hors de portée de ce script, §8.2 du plan) :"
echo "  configurer la redirection de port (NAT/PAT) sur la box Internet vers l'IP"
echo "  locale de cette machine, ports 80 et 443 (TCP)."
