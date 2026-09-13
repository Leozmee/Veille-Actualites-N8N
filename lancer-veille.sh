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
# Rendormir le Mac après le rapport s'il dormait avant (voir § 6).
RENDORMIR=1
INACTIVITE_MINI=240          # secondes sans clavier ni souris pour conclure « absent »
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

# Empêche le Mac de se rendormir pendant l'exécution. Sans cela, une tâche
# déclenchée au réveil peut être coupée en plein milieu si la machine retombe
# en veille — le rapport serait alors perdu sans trace d'erreur.
# Le garde-fou s'efface tout seul à la fin du script.
caffeinate -dimsu -w $$ > /dev/null 2>&1 &

# Inactivité relevée avant de commencer : un Mac qui sort de veille affiche
# une inactivité élevée, un Mac en cours d'utilisation une inactivité nulle.
# C'est ce qui permet de ne rendormir que ce qui dormait.
INACTIVITE_DEPART=$(ioreg -c IOHIDSystem 2>/dev/null | awk '/HIDIdleTime/ {printf "%d", $NF/1000000000; exit}')
INACTIVITE_DEPART=${INACTIVITE_DEPART:-0}
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
  # Même raison qu'à l'extinction : on ne force qu'en dernier recours, quand
  # le démon est de toute façon inutilisable, et on recrée alors les conteneurs.
  pgrep -f "Docker.app/Contents/MacOS" > /dev/null 2>&1 && pkill -f "Docker.app/Contents/MacOS" 2>/dev/null
  sleep 8
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

# Les conteneurs sont systématiquement repartis de zéro. Un arrêt brutal de
# Docker (plantage, mise en veille, extinction du Mac) laisse des conteneurs
# dont la couche de stockage est incohérente : « RWLayer unexpectedly nil ».
# Les supprimer coûte quelques secondes et évite de perdre le rapport.
demarrer_services() {
  docker compose down --remove-orphans > /dev/null 2>&1
  for c in veille-n8n veille-gotenberg veille-compresseur; do
    docker rm -f "$c" > /dev/null 2>&1
  done
  docker compose up -d gotenberg compresseur >> "$JOURNAL" 2>&1
}

# Les deux images n'offrent pas le même client HTTP : Gotenberg embarque curl
# mais pas wget, le compresseur l'inverse. Tester avec un seul des deux fait
# échouer le contrôle quel que soit l'état réel du service.
sonder() {                    # $1 = conteneur, $2 = URL
  docker exec "$1" sh -c "curl -sf --max-time 3 '$2' || wget -qO- --timeout=3 '$2'" > /dev/null 2>&1
}

services_prets() {
  for _ in {1..25}; do
    if sonder veille-gotenberg   http://127.0.0.1:3000/health \
       && sonder veille-compresseur http://127.0.0.1:3001/health; then
      return 0
    fi
    sleep 3
  done
  return 1
}

demarrer_services
if ! services_prets; then
  trace "services indisponibles — seconde tentative après nettoyage complet"
  demarrer_services
  if ! services_prets; then
    trace "ÉCHEC — Gotenberg ou le compresseur ne répond pas"
    docker compose down > /dev/null 2>&1
    exit 1
  fi
  trace "services démarrés à la seconde tentative"
fi

# --no-deps : sans cela, « compose run » relance gotenberg et compresseur en
# parallèle de ceux déjà lancés, d'où la double création de réseau observée.
docker compose run --rm --no-deps --entrypoint n8n n8n execute --id "$WORKFLOW_ID" > /tmp/veille-exec.log 2>&1
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
#   · le « quit » AppleScript n'aboutit pas de façon fiable, et le forcer
#     corrompt les couches de stockage. « docker desktop stop » fait les deux
#     correctement : arrêt complet et état écrit proprement ;
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
  # « docker desktop stop » est l'arrêt propre officiel : il éteint la VM en
  # laissant containerd écrire son état, et ramène réellement à 0 Mo. Le quit
  # AppleScript, lui, n'aboutit pas toujours, et un « pkill » corrompt les
  # couches de stockage — trois rapports ont été perdus ainsi (10-12/09).
  if docker desktop stop > /dev/null 2>&1; then
    sleep 8
  else
    trace "« docker desktop stop » indisponible — repli sur le quit AppleScript"
    osascript -e 'quit app "Docker"' > /dev/null 2>&1
    for _ in {1..40}; do
      pgrep -f "Docker.app/Contents/MacOS" > /dev/null 2>&1 || break
      sleep 3
    done
  fi
  pkill -f "cli-plugins/docker-agent" > /dev/null 2>&1
  RESTE=$(ps -Ao rss,comm | grep -i "Docker.app" | awk '{s+=$1} END {printf "%.0f", s/1024}')
  if [[ "${RESTE:-0}" -gt 0 ]]; then
    trace "Docker encore actif (${RESTE} Mo) — laissé tel quel, le tuer corromprait les conteneurs"
  else
    trace "Docker arrêté (0 Mo)"
  fi
fi

pkill -x ollama > /dev/null 2>&1 && trace "Ollama arrêté"
# ── 6. Rendormir le Mac s'il dormait ──────────────────────────────────────
# launchd ne réveille pas la machine : une tâche calendaire est différée puis
# lancée à la sortie de veille. Avec « sudo pmset repeat wakeorpoweron », le
# Mac se réveille de lui-même à l'heure dite — il faut alors le rendormir,
# sinon il resterait allumé toute la journée.
# On ne le fait que si personne ne s'en sert : l'inactivité relevée au
# démarrage distingue un réveil programmé d'une exécution manuelle.
if (( RENDORMIR )) && [[ "${INACTIVITE_DEPART:-0}" -ge "$INACTIVITE_MINI" ]]; then
  INACTIVITE_FIN=$(ioreg -c IOHIDSystem 2>/dev/null | awk '/HIDIdleTime/ {printf "%d", $NF/1000000000; exit}')
  if [[ "${INACTIVITE_FIN:-0}" -ge 60 ]]; then
    trace "personne aux commandes — retour en veille"
    pmset sleepnow > /dev/null 2>&1
  else
    trace "activité détectée pendant l'exécution — Mac laissé éveillé"
  fi
else
  trace "Mac en cours d'utilisation — laissé éveillé"
fi

trace "─── terminé ───"
