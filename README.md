# Veille presse — 5 quotidiens nationaux → PDF par e-mail

Workflow n8n qui collecte tous les 3 jours l'actualité du **Monde**, du **Figaro**, du
**Parisien**, de **Libération** et de **La Croix**, met en valeur les données chiffrées,
développe les sujets principaux à partir de sources libres, et envoie une revue de presse
en PDF à `olivia.gallus@gmail.com`.

Rien ne tourne entre deux exécutions : `launchd` réveille tout, produit le rapport, puis
arrête Docker et Ollama.

---

## 1. Sources : ce qui est réellement disponible

### Les 5 quotidiens — l'agenda

Ils disent **ce que la presse française traite**. Neuf flux RSS officiels, vérifiés.

| Journal | Flux | Articles | Date | Résumé | Image |
|---|---|---:|:--:|:--:|:--:|
| **Le Monde** | une + fil continu | 16 + 60 | ✅ | ✅ | ✅ |
| **Le Figaro** | actualités + flash-actu | 19 + 20 | ✅ | ✅ | ✅ |
| **Le Parisien** | une + fil général | 100 + 100 | ❌ | ❌ | ❌ |
| **Libération** | rss-all | 50 | ✅ | ✅ | ❌ |
| **La Croix** | tous univers + France | 50 + 50 | ✅ | ✅ | ✅ |

**Le Parisien** ne renvoie que titre et lien, et son flux « une » contient des archives
remontant à 2019. La date est donc extraite du slug de l'URL (`…-07-09-2026-XXXX.php`),
ce qui permet de filtrer *avant* tout téléchargement ; résumé, image et heure exacte sont
ensuite lus dans les balises `<meta>` de la page. Son flux « une » n'étant pas exploitable,
ce sont ses articles les plus récents qui sont mis en avant.

**Libération** ne publie aucune image dans son flux — limite de la source.

### Les sources libres — la profondeur

Elles n'ont pas de section propre : elles alimentent les blocs « Développement ».

| Source | Corps récupérable |
|---|---|
| **France Info** (Radio France) | 900 – 9 300 c, texte intégral |
| **France 24** (France Médias Monde) | 3 500 – 5 400 c |
| **Euronews** | 1 100 – 3 100 c |
| **RFI** | variable |

---

## 2. Pourquoi pas le texte intégral des quotidiens

Mesuré, pas supposé :

| Journal | Réponse à une requête sur la page | robots.txt |
|---|---|---|
| Le Monde | **HTTP 402** « Accès restreint » | interdit ClaudeBot / GPTBot |
| Libération | **HTTP 403** + défi anti-bot | interdit ClaudeBot / GPTBot |
| Le Parisien | 200 | **`anthropic-ai`, `ClaudeBot` : Disallow /** |
| Le Figaro | 200, JSON-LD partiel | interdit GPTBot |
| La Croix | 200, JSON-LD partiel | aucune restriction |

Deux de ces titres **bloquent techniquement** l'accès automatisé et Le Parisien interdit
nommément les robots d'IA. Passer outre supposerait de casser un défi anti-bot et de
contourner un paywall : ce n'est pas fait, et ça casserait de toute façon à leur prochaine
mise à jour. Le rapport s'en tient donc, pour les quotidiens, au **titre, au chapô et au
lien** — ce que les éditeurs publient précisément pour être repris — et va chercher la
substance chez les sources libres.

La seule requête hors RSS est la lecture des **balises `<meta>` publiques** des pages du
Parisien, celles destinées aux réseaux sociaux, pour reconstituer le résumé que son flux omet.

---

## 3. Chaîne de traitement (34 nœuds)

```
launchd (8 h, tous les 3 jours)
  └─ Lire l’état précédent ..... date du dernier envoi + liens déjà expédiés
  └─ Configuration ............. fenêtre réelle, plafonds, seuils
  └─ Liste des flux ............ 15 flux (9 quotidiens + 6 sources libres)
  └─ Récupérer / Parser XML .... tolérant aux pannes
  └─ Normaliser ................ journal par domaine, datation, dédoublonnage
  └─ Enrichir <meta> ........... résumés manquants du Parisien
  └─ Préparer les embeddings ─┐
  └─ Encoder (Ollama bge-m3) ─┤  appariement quotidiens ↔ sources libres
  └─ Apparier les sujets ─────┘
  └─ Récupérer / Extraire le corps
  └─ Surligner les chiffres
  └─ Rapatrier et intégrer les images .. en base64 dans le HTML
  └─ Composer le rapport ....... HTML A4 + variante sans images
  └─ Gotenberg ................. HTML → PDF
  └─ Compresser (Ghostscript) .. ~11,5 Mo → ~0,8 Mo
  └─ Vérifier la taille ........ repli sans images si > 20 Mo
  └─ Enregistrer le PDF ........ rapports/
  └─ Mémoriser l’état
  └─ Envoyer par SMTP
```

Un flux hors service, une page inaccessible, Ollama arrêté ou le compresseur absent
n'interrompent pas le rapport : chaque étape a son repli.

---

## 4. Appariement sémantique (Ollama, local)

Rapprocher un titre du *Monde* d'un article de France Info **mot à mot** ne marche pas :
deux rédactions ne titrent jamais pareil. Mesuré sur une journée réelle, Jaccard n'apparie
que **8 %** des sujets. Les embeddings seuls ne font pas mieux (10 %) : `bge-m3` tasse tous
les scores entre 0,68 et 0,79 et ne sépare rien.

Ce qui marche est **hybride** : `0,65 × proximité sémantique + 0,35 × recouvrement des
noms propres et des chiffres du titre`. « Saxe-Anhalt », « Merz », « Colombie » sont ce qui
distingue réellement deux sujets. Résultat : **~55 % d'appariement**, et **100 % de justesse
au-delà de 0,76**. Les années nues sont exclues du calcul (sinon « CAN 2027 » épouse
« haute couture 2026/2027 ») et les grilles de programmes radio sont écartées.

**Le bloc porte toujours le titre de l'article source**, jamais celui du quotidien. Un
rapprochement erroné devient ainsi un article voisin un peu hors sujet, visible d'un coup
d'œil — au lieu d'attribuer un texte au mauvais sujet.

Modèle : `bge-m3` (1,2 Go), multilingue. Ollama tourne **nativement sur le Mac**, jamais
dans Docker : les conteneurs macOS n'ont pas accès au GPU Metal.

---

## 4 bis. Structure du rapport

Trois niveaux, du plus important au plus secondaire :

1. **Les temps forts** — les sujets majeurs, en grand format : visuel, chapô, développement
   tiré d'une source libre, puis **le même sujet vu par les autres titres** (leurs propres
   titres et chapôs, mot pour mot). C'est la façon la plus fiable de montrer les angles :
   attribuable, vérifiable, sans risque d'invention.
2. **L'essentiel** — les autres sujets suivis, en format compact, développés d'abord.
3. **Par journal** — les articles mis en avant, puis les brèves.

Un même événement traité par plusieurs quotidiens n'occupe **qu'une entrée**, enrichie des
angles des autres titres. Le rapprochement combine similarité de titres et noms propres
partagés — les noms composés comptent aussi par leurs parties, sans quoi « Saxe-Anhalt »
ne pèserait qu'une unité.

**Les images sont rapatriées puis intégrées en base64.** Gotenberg n'a ainsi aucune requête
réseau à faire au moment d'imprimer : plus d'image manquante au hasard d'un délai ou d'une
protection anti-hotlink, et une image indisponible est retirée plutôt que laissée en cadre vide.

---

## 5. Données chiffrées

| Type | Exemples reconnus | Couleur |
|---|---|---|
| **Pourcentage** | `+11 %`, `25%`, `-2,5 points de pourcentage` | ambre |
| **Montant** | `92 millions de dollars`, `3,4 milliards d'euros`, `450 €` | vert |
| **Volume** | `45 000 logements`, `12 000 personnes`, `100 000 morts` | bleu |
| **Période** | `2023-2026`, `de 2020 à 2026` | violet |

Format français géré (espace insécable des milliers, virgule décimale). Résultat surligné
dans le texte, résumé en pastilles sous chaque article, et compilé en **« Les chiffres qui
ressortent »** en page de garde.

Faux positifs écartés : années isolées (`2026` — sinon tout le document serait surligné,
mais `2023-2026` est gardé) et horaires précédés de `à`, `dès`, `vers`, `jusqu'à`
(« à 19 heures » ignoré, « a duré 19 heures » conservé).

---

## 6. Poids du PDF

Les images en pleine résolution donnaient un PDF de **65 Mo**. Deux leviers :

1. **Réduction à la source** — les CDN acceptent une taille dans l'URL
   (`i.f1g.fr/media/cms/704x396_crop/`, `i.la-croix.com/620x412/`). Le Parisien signe ses
   URL : on y cherche la plus petite variante déjà signée dans la page.
2. **Compression Ghostscript** (`/printer`, 300 dpi) dans un conteneur dédié :
   **11,5 Mo → ~0,8 Mo**, sans perte visible — les images font 42 mm à l'impression.

Si le résultat dépasse malgré tout `maxPdfMo` (20 Mo), le rapport est régénéré **sans
images** ; le texte seul pèse ~200 Ko. Ce repli ne devrait jamais se déclencher.

---

## 7. Pas de redite, pas de trou

Chaque rapport écrit `rapports/.etat.json` : date d'envoi et liens expédiés. Le suivant
repart de cette date au lieu d'une fenêtre fixe de 3 jours.

- Exécution **retardée** (Mac éteint deux jours) → la fenêtre s'élargit d'autant, plafonnée
  à `fenetreMaxJours` (8). Aucun article perdu.
- Exécution **manuelle** le même jour → les liens déjà envoyés sont écartés. Aucun doublon.

---

## 8. Installation

```bash
cd ~/Projets/veille-presse-n8n
docker compose up -d
```

1. **Compte n8n** — <http://localhost:5678>, créer le compte propriétaire.
2. **Importer** `workflow-veille-presse.json` (Workflows ▸ ⋯ ▸ Import from File),
   ou en ligne de commande :
   `docker compose run --rm --entrypoint n8n n8n import:workflow --input=/tmp/wf.json`
3. **SMTP** — Credentials ▸ New ▸ SMTP, puis rattacher au nœud « Envoyer le rapport ».
   Avec Gmail : `smtp.gmail.com`, port `465`, SSL, et un **mot de passe d'application**
   (la validation en deux étapes doit être active ; le mot de passe habituel est refusé).
4. **Ollama** — `ollama pull bge-m3` si le modèle n'est pas déjà présent.

**Ne pas activer le workflow dans n8n** : c'est `launchd` qui déclenche, l'activer ferait
partir deux rapports.

---

## 9. Planification (launchd)

```bash
cp com.leogallus.veille-presse.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.leogallus.veille-presse.plist
```

`launchd` réveille `lancer-veille.sh` **chaque jour à 8 h**. Le script vérifie d'abord si
3 jours se sont écoulés depuis le dernier rapport ; sinon il s'arrête aussitôt. C'est ce
qui permet de **rattraper une exécution manquée** — le planificateur interne de n8n, lui,
saute simplement le rendez-vous si le Mac dort.

Le script démarre Ollama et Docker **seulement s'ils ne tournent pas déjà**, exécute le
workflow dans un conteneur éphémère (pas besoin du serveur n8n, ce qui évite le conflit de
port avec le task broker), puis arrête tout ce qu'il a démarré.

```bash
./lancer-veille.sh --force     # exécution immédiate
tail -f rapports/.journal.log  # suivi
launchctl bootout gui/$UID/com.leogallus.veille-presse   # désactiver
```

**Coût au repos : zéro.** À titre de comparaison, laisser les conteneurs allumés en
permanence consomme ~1,4 Go et ~4,5 % de CPU.

---

## 10. Où atterrissent les fichiers

- **`rapports/`** — les vrais rapports : `revue-de-presse-AAAA-MM-JJ.pdf`, plus
  `.etat.json` (mémoire) et `.journal.log` (historique des exécutions).
- **`out/`** — sorties du banc d'essai local (`npm test`), écrasées à chaque test.

Un rapport tous les 3 jours, ~1 Mo pièce : négligeable. Pour purger malgré tout :

```bash
find ~/Projets/veille-presse-n8n/rapports -name '*.pdf' -mtime +180 -delete
```

---

## 11. Réglages

Tout est dans le nœud **Configuration** (`src/nodes/01-configuration.js`) :

| Paramètre | Défaut | Rôle |
|---|---|---|
| `destinataire` | `olivia.gallus@gmail.com` | Adresse d'envoi |
| `fenetreJours` | `3` | Fenêtre au tout premier lancement |
| `fenetreMaxJours` | `8` | Plafond après une longue absence |
| `maxArticlesParSource` | `45` | Plafond par quotidien |
| `maxUneParSource` | `8` | Articles en cartes, par journal |
| `maxPdfMo` | `20` | Au-delà, repli sans images |
| `developpements.seuil` | `0.58` | Sensibilité de l'appariement |
| `maxBrevesParSource` | `16` | Brèves affichées par journal |
| `maxTempsForts` | `5` | Sujets majeurs en grand format |
| `maxEssentielSansDev` | `7` | Sujets non développés admis en tête |
| `developpements.maxBlocs` | `60` | Nb max de blocs « Développement » |
| `seuilSujetCommun` | `0.40` | Détection des sujets multi-titres |

**Changer la fréquence** : `INTERVALLE_JOURS` dans `lancer-veille.sh`, et l'heure dans le
`.plist` (`StartCalendarInterval`).

**Ajouter un journal** : une ligne dans « Liste des flux », une entrée dans `JOURNAUX`
(nœud « Normaliser ») et dans `ORDRE` (nœud « Composer le rapport »).

---

## 12. Développement

Le code des nœuds vit dans `src/nodes/*.js` — **c'est la source de vérité**. Le JSON du
workflow en est généré.

```bash
npm install        # xml2js, uniquement pour le banc d'essai
npm test           # rejoue toute la chaîne hors n8n, sur les vrais flux
npm run build      # régénère workflow-veille-presse.json
```

`npm test` écrit `out/revue-de-presse-AAAA-MM-JJ.html` et `out/diagnostic.json`
(compte-rendu flux par flux, liste des appariements avec leur score). Pratique pour
vérifier une modification sans redéployer n8n.

```
src/nodes/
  01-configuration.js          réglages + reprise de l'état
  02-liste-flux.js             15 flux
  03-normaliser.js             schéma unifié, datation, dédoublonnage
  04-preparer-enrichissement.js / 05-fusionner-meta.js      balises <meta>
  06-preparer-embeddings.js / 07-apparier.js                appariement sémantique
  08-preparer-corps.js / 09-extraire-corps.js               texte des sources libres
  10-chiffres.js               moteur d'extraction des données chiffrées
  11-rapport-html.js           mise en page A4 (+ variante sans images)
  12-preparer-envoi.js         nommage du PDF, corps de l'e-mail
  13-verifier-taille.js        contrôle du poids
  14-basculer-allege.js        repli sans images
  15-memoriser-etat.js         mémoire d'un rapport à l'autre
  16-preparer-images.js        visuels à rapatrier
  17-integrer-images.js        intégration en base64
compresseur/                   Ghostscript derrière une API HTTP
```

---

## 13. Points de vigilance

- **Usage privé.** Le PDF reprend des titres et des chapôs protégés par le droit d'auteur,
  et des extraits de sources libres avec attribution. Une revue de presse interne est un
  usage courant ; une rediffusion large relèverait du CFC.
- **Le Parisien reste le maillon fragile** : sans date ni résumé dans son flux, il dépend
  du format de ses URL et de ses balises `og:`. Un changement de leur côté le ferait passer
  à 0 article — visible immédiatement dans les compteurs de la page de garde.
- **Flux vérifiés au 7 septembre 2026.** Si un journal disparaît du rapport, lancez
  `npm test` : le diagnostic indique le flux fautif.
- **Environ 55 % des unes** obtiennent un bloc « Développement ». Les sujets très locaux ou
  de niche n'ont simplement pas d'équivalent dans les sources libres.
