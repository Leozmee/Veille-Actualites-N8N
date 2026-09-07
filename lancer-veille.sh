#!/bin/zsh
# ─── Veille presse : exécution puis retour au repos ────────────────────────
# Appelé chaque jour à 8 h par launchd. Ne fait rien tant que l'intervalle
# n'est pas écoulé, ce qui permet de rattraper une exécution manquée (Mac
# éteint) sans la dupliquer.
#
#   ./lancer-veille.sh            exécution si l'intervalle est écoulé
#   ./lancer-veille.sh --force    exécution immédiate, sans condition

set -u
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJET="${0:A:h}"
INTERVALLE_JOURS=3
ETAT="$PROJET/rapports/.etat.json"
JOURNAL="$PROJET/rapports/.journal.log"
WORKFLOW_ID="veillePresse0001"

mkdir -p "$PROJET/rapports"
trace() { print -r -- "$(date '+%Y-%m-%d %H:%M:%S')  $*" >> "$JOURNAL"; }

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

# ── 1. L'intervalle est-il écoulé ? ───────────────────────────────────────
if (( ! FORCE )) && [[ -f "$ETAT" ]]; then
  DERNIER=$(/usr/bin/python3 -c "
import json,sys
try: print(json.load(open('$ETAT')).get('dernierRun') or '')
except Exception: print('')
" 2>/dev/null)
  if [[ -n "$DERNIER" ]]; then
    ECOULE=$(/usr/bin/python3 -c "
from datetime import datetime,timezone
d=datetime.fromisoformat('$DERNIER'.replace('Z','+00:00'))
print(round((datetime.now(timezone.utc)-d).total_seconds()/86400, 3))
" 2>/dev/null)
    if [[ -n "$ECOULE" ]] && (( $(print -- "$ECOULE < $INTERVALLE_JOURS") )); then
      trace "rien à faire — dernier rapport il y a ${ECOULE} jour(s)"
      exit 0
    fi
  fi
fi

trace "─── démarrage ───"
DEMARRE_DOCKER=0
DEMARRE_OLLAMA=0

# ── 2. Ollama (appariement sémantique) ────────────────────────────────────
if ! pgrep -x ollama > /dev/null 2>&1; then
  nohup ollama serve > /dev/null 2>&1 &
  DEMARRE_OLLAMA=1
  for i in {1..20}; do
    curl -sf -o /dev/null --max-time 2 http://localhost:11434/api/tags && break
    sleep 1
  done
  trace "Ollama démarré"
fi

# ── 3. Docker ─────────────────────────────────────────────────────────────
if ! docker info > /dev/null 2>&1; then
  open -a Docker
  DEMARRE_DOCKER=1
  for i in {1..60}; do
    docker info > /dev/null 2>&1 && break
    sleep 5
  done
  if ! docker info > /dev/null 2>&1; then
    trace "ÉCHEC — le démon Docker n'a pas démarré en 5 minutes"
    exit 1
  fi
  trace "Docker démarré"
fi

# ── 4. Exécution ──────────────────────────────────────────────────────────
# Le serveur n8n n'est pas nécessaire : un conteneur éphémère suffit, et il
# évite le conflit de port avec le task broker.
cd "$PROJET" || exit 1
docker compose up -d gotenberg compresseur >> "$JOURNAL" 2>&1
docker compose run --rm --entrypoint n8n n8n execute --id "$WORKFLOW_ID" > /tmp/veille-exec.log 2>&1
CODE=$?

if grep -q "Execution was successful" /tmp/veille-exec.log 2>/dev/null; then
  trace "rapport envoyé"
elif [[ -n "$(find "$PROJET/rapports" -name '*.pdf' -newermt '-10 minutes' 2>/dev/null)" ]]; then
  trace "PDF produit mais l'envoi a échoué (code $CODE) — vérifier les identifiants SMTP"
else
  trace "ÉCHEC (code $CODE) — voir /tmp/veille-exec.log"
fi

# ── 5. Retour au repos ────────────────────────────────────────────────────
docker compose down >> "$JOURNAL" 2>&1
if (( DEMARRE_DOCKER )); then
  osascript -e 'quit app "Docker"' > /dev/null 2>&1
  # L'extinction est progressive (~1 à 2 min) : on la confirme au lieu de la supposer.
  for i in {1..40}; do
    pgrep -f "Docker.app/Contents/MacOS" > /dev/null 2>&1 || break
    sleep 3
  done
  RESTE=$(ps -Ao rss,comm | grep -i "Docker.app/Contents/MacOS" | awk '{s+=$1} END {printf "%.0f", s/1024}')
  if [[ "${RESTE:-0}" -gt 0 ]]; then
    trace "Docker s'arrête encore (${RESTE} Mo résiduels)"
  else
    trace "Docker arrêté (0 Mo)"
  fi
fi
(( DEMARRE_OLLAMA )) && { pkill -x ollama > /dev/null 2>&1; trace "Ollama arrêté"; }
trace "─── terminé ───"
