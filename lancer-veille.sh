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

# Répondre sur /api/tags ne veut pas dire savoir encoder : le modèle n'est pas
# encore en mémoire. Le 28/09, la première requête d'encodage est tombée sur un
# « timed out waiting for llama-server to start » et le rapport a perdu tous ses
# temps forts. On force donc le chargement ici, hors de la course, sur une
# machine qui sort de veille et démarre Docker en même temps.
PRECHAUFFE=0
for i in {1..30}; do
  if curl -sf -o /dev/null --max-time 20 http://localhost:11434/api/embed \
       -d '{"model":"bge-m3","input":["préchauffage"]}'; then
    PRECHAUFFE=1
    break
  fi
  sleep 4
done
if (( PRECHAUFFE )); then
  trace "modèle d'appariement prêt"
else
  trace "ATTENTION : bge-m3 ne répond pas — rapport probablement sans temps forts"
fi

# ── Réseau réellement établi ──────────────────────────────────────────────
# Les exécutions parties à 08:00 pile durent deux minutes ; celles différées
# par launchd parce que le Mac dormait — 08 h 07, 08 h 11, 08 h 16 — durent
# trois quarts d'heure à deux heures et demie, et l'une d'elles a vu Gmail
# fermer la connexion en cours d'envoi. Le point commun n'est pas la taille du
# rapport mais le réveil : le Wi-Fi vient de se réassocier et le débit sortant
# met un moment à revenir. On attend donc de pouvoir réellement ouvrir une
# connexion vers le serveur SMTP, pas seulement d'avoir une interface up.
RESEAU=0
for i in {1..30}; do
  if nc -z -G 5 smtp.gmail.com 465 > /dev/null 2>&1; then
    RESEAU=1
    break
  fi
  sleep 5
done
if (( RESEAU )); then
  (( i > 1 )) && trace "réseau établi après $(( (i - 1) * 5 )) s d'attente"
else
  trace "ATTENTION : smtp.gmail.com injoignable — l'envoi risque d'échouer"
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
# L'état est écrit par le workflow AVANT l'envoi du mail. Un envoi qui échoue
# laisse donc 200 articles marqués « déjà reçus » alors que personne ne les a
# eus, et le rapport suivant les omet en silence : c'est ce qui s'est produit
# le 28/10, connexion SMTP fermée en cours de route. On garde une copie pour
# pouvoir revenir en arrière — « dernierRun » retrouve alors sa valeur
# précédente, et la tentative repart d'elle-même le lendemain.
AVANT_RUN=$(mktemp)
cp "$ETAT" "$AVANT_RUN" 2>/dev/null || : > "$AVANT_RUN"
DEBUT_RUN=$(date +%s)

docker compose run --rm --no-deps --entrypoint n8n n8n execute --id "$WORKFLOW_ID" > /tmp/veille-exec.log 2>&1
CODE=$?

if grep -q "Execution was successful" /tmp/veille-exec.log 2>/dev/null; then
  trace "rapport envoyé"
  # Une exécution « réussie » peut livrer un rapport amputé : les nœuds Ollama
  # et HTTP sont en continueRegularOutput, une panne y est donc avalée sans
  # faire échouer quoi que ce soit. C'est ce qui s'est produit le 28/09 — zéro
  # développement, plus aucun temps fort, et rien dans le journal pour le dire.
  DEV=$(/usr/bin/python3 -c "
import json
try:
    d = json.load(open('$ETAT')).get('diagnostic') or {}
    print((d.get('qualite') or {}).get('developpementsRestants', ''))
except Exception: print('')
" 2>/dev/null)
  if [[ "$DEV" == "0" ]]; then
    trace "ATTENTION : aucun développement — rapport sans temps forts (appariement Ollama en échec ?)"
  elif [[ -n "$DEV" ]]; then
    trace "${DEV} développement(s) retenus"
  fi
  rm -f "$AVANT_RUN"
else
  # Un envoi lent repoussait le PDF hors de la fenêtre fixe de dix minutes : le
  # 28/10, le rapport était bien sur le disque depuis 09 h 28 et le journal a
  # tout de même écrit « ÉCHEC » sans mentionner qu'il existait. On compare
  # désormais au début de l'exécution.
  if [[ -n "$(find "$PROJET/rapports" -name '*.pdf' -newermt "@$DEBUT_RUN" 2>/dev/null)" ]]; then
    MOTIF="PDF produit, envoi en échec"
  else
    MOTIF="aucun rapport produit"
  fi
  CAUSE=$(grep -m1 -oE '"(message)":"[^"]{0,90}"' /tmp/veille-exec.log 2>/dev/null | cut -c13- | tr -d '"')
  trace "ÉCHEC (code $CODE) — ${MOTIF}${CAUSE:+ : $CAUSE}"
  # Retour à l'état d'avant : les articles de ce rapport redeviennent éligibles
  # et l'intervalle n'est pas consommé, donc le lendemain réessaie.
  if [[ -s "$AVANT_RUN" ]]; then
    cp "$AVANT_RUN" "$ETAT"
    trace "état restauré — nouvelle tentative au prochain réveil"
  fi
  rm -f "$AVANT_RUN"
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
# ── Purge des exécutions n8n ──────────────────────────────────────────────
# n8n conserve chaque exécution avec ses données — images en base64 comprises,
# soit ~30 Mo par rapport. En trois semaines la base atteignait 1,9 Go. Sa
# purge intégrée ne tourne que dans un serveur permanent, or n8n n'est lancé
# ici qu'en ligne de commande, le temps d'une exécution : il faut donc le faire
# soi-même. La clé étrangère est en CASCADE, supprimer l'exécution emporte ses
# données. VACUUM n'est lancé que si quelque chose a réellement été supprimé,
# car il réécrit toute la base.
RETENTION_JOURS=30
VOL=$(docker volume ls --format '{{.Name}}' | grep -x 'veille-presse-n8n_n8n_data' | head -1)
if [[ -n "$VOL" ]]; then
  PURGE=$(docker run --rm --mount "source=$VOL,target=/d" veille-compresseur:1 sh -c "
    n=\$(sqlite3 /d/database.sqlite \"SELECT COUNT(*) FROM execution_entity WHERE startedAt < datetime('now','-${RETENTION_JOURS} days');\")
    if [ \"\$n\" -gt 0 ]; then
      sqlite3 /d/database.sqlite \"PRAGMA foreign_keys=ON; DELETE FROM execution_entity WHERE startedAt < datetime('now','-${RETENTION_JOURS} days');\"
      sqlite3 /d/database.sqlite 'VACUUM;'
    fi
    echo \"\$n \$(du -m /d/database.sqlite | cut -f1)\"
  " 2>/dev/null)
  SUPPRIMEES=${PURGE%% *}
  TAILLE=${PURGE##* }
  if [[ "${SUPPRIMEES:-0}" -gt 0 ]]; then
    trace "purge n8n : ${SUPPRIMEES} exécution(s) de plus de ${RETENTION_JOURS} j supprimées — base à ${TAILLE} Mo"
  else
    trace "purge n8n : rien à supprimer — base à ${TAILLE:-?} Mo"
  fi
fi

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
