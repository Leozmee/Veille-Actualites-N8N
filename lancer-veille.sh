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
    # Comparaison en jours CALENDAIRES, pas en heures écoulées : un rapport
    # produit un soir à 20 h ne doit pas repousser l'envoi suivant d'une
    # journée entière sous prétexte qu'à 8 h il ne s'est écoulé que 2,5 jours.
    ECOULE=$(/usr/bin/python3 -c "
from datetime import datetime
d=datetime.fromisoformat('$DERNIER'.replace('Z','+00:00')).astimezone().date()
print((datetime.now().astimezone().date()-d).days)
" 2>/dev/null)
    if [[ -n "$ECOULE" ]] && (( ECOULE < INTERVALLE_JOURS )); then
      trace "rien à faire — dernier rapport il y a ${ECOULE} jour(s) calendaire(s)"
      exit 0
    fi
  fi
fi

trace "─── démarrage ───"
DEMARRE_DOCKER=0
DEMARRE_OLLAMA=0
DOCKER_RECUPERE=0

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
# Docker Desktop démarre parfois sa VM sans que le réseau interne soit joignable
# (« no route to host » vers 192.168.65.x). Le démon ne répond alors jamais.
# Seul un redémarrage complet, résidus compris, le remet d'aplomb : on tente
# donc deux fois plutôt que d'abandonner et de sauter le rapport.
attendre_docker() {           # $1 = nombre de tentatives de 5 s
  for _ in $(seq 1 "$1"); do
    docker info > /dev/null 2>&1 && return 0
    sleep 5
  done
  return 1
}

arreter_docker_de_force() {
  osascript -e 'quit app "Docker"' > /dev/null 2>&1
  for _ in {1..20}; do
    pgrep -f "Docker.app/Contents/MacOS" > /dev/null 2>&1 || break
    sleep 3
  done
  pgrep -f "Docker.app/Contents/MacOS" > /dev/null 2>&1 && pkill -f "Docker.app/Contents/MacOS" 2>/dev/null
  sleep 5
}

if ! docker info > /dev/null 2>&1; then
  open -a Docker
  DEMARRE_DOCKER=1
  if ! attendre_docker 24; then          # 2 min
    trace "Docker ne répond pas — redémarrage forcé"
    arreter_docker_de_force
    open -a Docker
    if ! attendre_docker 36; then        # 3 min de plus
      trace "ÉCHEC — le démon Docker reste injoignable après redémarrage forcé"
      exit 1
    fi
    trace "Docker démarré après redémarrage forcé"
    # Une extinction forcée laisse des couches de stockage corrompues
    # (« RWLayer unexpectedly nil ») : les conteneurs doivent être recréés.
    DOCKER_RECUPERE=1
  else
    trace "Docker démarré"
  fi
fi

# ── 4. Exécution ──────────────────────────────────────────────────────────
# Le serveur n8n n'est pas nécessaire : un conteneur éphémère suffit, et il
# évite le conflit de port avec le task broker.
cd "$PROJET" || exit 1
if (( DOCKER_RECUPERE )); then
  docker compose down --remove-orphans >> "$JOURNAL" 2>&1
  for c in veille-n8n veille-gotenberg veille-compresseur; do docker rm -f "$c" > /dev/null 2>&1; done
  trace "conteneurs recréés après récupération de Docker"
fi
docker compose up -d gotenberg compresseur >> "$JOURNAL" 2>&1

# Les services doivent réellement répondre avant de lancer le workflow.
for _ in {1..20}; do
  docker exec veille-gotenberg sh -c 'wget -qO- --timeout=3 http://127.0.0.1:3000/health' > /dev/null 2>&1 && break
  sleep 3
done
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
# Rien ne doit survivre à l'exécution. Trois pièges rencontrés :
#   · le « quit » gracieux de Docker Desktop n'aboutit pas toujours — il faut
#     forcer, sinon ~900 Mo restent en mémoire jusqu'au prochain redémarrage ;
#   · les greffons « docker-agent » ne meurent pas avec l'application ;
#   · conditionner l'extinction au fait d'avoir démarré Docker soi-même est un
#     piège : une exécution qui échoue à l'éteindre le laisse allumé, et toutes
#     les suivantes le trouvent déjà démarré et ne l'éteignent donc jamais.
#     On éteint donc dès lors qu'aucun conteneur étranger ne tourne.
docker compose down >> "$JOURNAL" 2>&1

AUTRES=$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')
if [[ "${AUTRES:-0}" -gt 0 ]]; then
  trace "Docker laissé actif — ${AUTRES} conteneur(s) étranger(s) en cours"
else
  arreter_docker_de_force
  pkill -f "cli-plugins/docker-agent" > /dev/null 2>&1
  sleep 2
  RESTE=$(ps -Ao rss,comm | grep -i "Docker.app" | awk '{s+=$1} END {printf "%.0f", s/1024}')
  if [[ "${RESTE:-0}" -gt 0 ]]; then
    trace "ATTENTION — ${RESTE} Mo Docker résiduels malgré l'extinction forcée"
  else
    trace "Docker arrêté (0 Mo)"
  fi
fi

pkill -x ollama > /dev/null 2>&1 && trace "Ollama arrêté"
trace "─── terminé ───"
