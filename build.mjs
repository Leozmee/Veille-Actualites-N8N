// ─── Assemblage du workflow n8n ────────────────────────────────────────────
// Injecte le code de src/nodes/*.js dans les nœuds Code et écrit le JSON
// importable :  node build.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(ICI, 'src', 'nodes', f), 'utf8');

// Identifiant SMTP créé dans l'interface n8n (Credentials ▸ SMTP). Référencé ici
// pour que le rattachement survive aux réimports du workflow.
// Interrupteur d'envoi : tant qu'il est à false, le workflow produit et archive
// le rapport sans expédier de mail. À passer à true une fois le rapport validé.
const ENVOI_ACTIF = true;

// Moteur de conversion PDF. Un seul est câblé à la fois : dans n8n, un nœud
// désactivé n'est pas neutre, il transmet son entrée à sa sortie — le nœud de
// secours injectait donc un item sans PDF dans la suite de la chaîne.
const MOTEUR_PDF = 'gotenberg';   // 'gotenberg' | 'pdfshift'

const SMTP_ID = 'gnLXkWNIJq0EGBDR';
const SMTP_NOM = 'SMTP account';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const code = (nom, fichier, [x, y], note) => ({
  parameters: { mode: 'runOnceForAllItems', jsCode: src(fichier) },
  id: nom.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name: nom, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, y],
  notes: note, notesInFlow: false,
});

const nodes = [
  {
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 3, triggerAtHour: 8, triggerAtMinute: 0 }] } },
    id: 'declencheur', name: 'Toutes les 3 jours à 8 h',
    type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [-380, 0],
    notes: 'Intervalle réel de 3 jours, déclenchement à 8 h 00 (Europe/Paris). Le compte repart de la date d’activation.',
  },
  {
    parameters: {}, id: 'manuel', name: 'Test manuel',
    type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-380, 200],
    notes: 'Pour lancer un rapport à la demande.',
  },

  {
    parameters: { fileSelector: '/data/rapports/.etat.json', options: {} },
    id: 'lire-etat', name: 'Lire l’état précédent',
    type: 'n8n-nodes-base.readWriteFile', typeVersion: 1, position: [-160, 0],
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: 'Date du dernier envoi et liens déjà expédiés. Absent au premier lancement : la fenêtre par défaut s’applique.',
  },

  code('Configuration', '01-configuration.js', [-160, 100],
       'Destinataire, fenêtre de collecte, plafonds. Le seul nœud à modifier au quotidien.'),
  code('Liste des flux', '02-liste-flux.js', [60, 100],
       '9 flux RSS officiels. Un item = un flux.'),

  {
    parameters: {
      url: '={{ $json.url }}',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'User-Agent', value: UA },
        { name: 'Accept', value: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8' },
      ] },
      options: {
        timeout: 45000,
        batching: { batch: { batchSize: 3, batchInterval: 700 } },
        response: { response: { responseFormat: 'text', outputPropertyName: 'data' } },
      },
    },
    id: 'http-flux', name: 'Récupérer les flux',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [280, 100],
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: 'Un flux indisponible n’interrompt pas le rapport (continueRegularOutput).',
  },
  {
    parameters: {
      mode: 'xmlToJson', dataPropertyName: 'data',
      options: { explicitArray: false, trim: true, attrkey: '$', charkey: '_', ignoreAttrs: false, mergeAttrs: false },
    },
    id: 'xml', name: 'Parser le XML',
    type: 'n8n-nodes-base.xml', typeVersion: 1, position: [500, 100],
    onError: 'continueRegularOutput',
    notes: 'explicitArray=false + trim : format attendu par le nœud suivant.',
  },

  code('Normaliser les articles', '03-normaliser.js', [720, 100],
       'Schéma unifié, journal déduit du domaine, date (flux ou URL), dédoublonnage, fenêtre de 3 jours.'),
  code('Préparer enrichissement', '04-preparer-enrichissement.js', [940, 100],
       'Le Parisien ne renvoie que titre + lien : on liste les pages dont il faut lire les balises <meta>.'),

  {
    parameters: {
      url: '={{ $json.lien }}',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'User-Agent', value: UA },
        { name: 'Accept', value: 'text/html,application/xhtml+xml' },
      ] },
      options: {
        timeout: 45000,
        batching: { batch: { batchSize: 3, batchInterval: 1100 } },
        response: { response: { responseFormat: 'text', outputPropertyName: 'data' } },
      },
    },
    id: 'http-pages', name: 'Récupérer les pages',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1160, 100],
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: 'Lecture des balises <meta> publiques uniquement (og:description, og:image, date). Requêtes étalées.',
  },

  code('Fusionner les métadonnées', '05-fusionner-meta.js', [1380, 100],
       'Complète résumé / image / date, puis re-filtre sur la fenêtre.'),
  code('Préparer les embeddings', '06-preparer-embeddings.js', [1600, 100],
       'Rassemble en un seul appel les titres des unes et ceux des sources libres.'),

  {
    parameters: {
      method: 'POST',
      url: '={{ $json.url }}',
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ model: $json.model, input: $json.input }) }}',
      options: { timeout: 300000 },
    },
    id: 'ollama-embed', name: 'Encoder les titres (Ollama)',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1820, 100],
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: 'Ollama tourne nativement sur le Mac (GPU Metal). S’il est arrêté, le rapport est simplement produit sans développements.',
  },

  code('Apparier les sujets', '07-apparier.js', [2040, 100],
       'Score hybride : 0,65 × proximité sémantique + 0,35 × recouvrement des noms propres.'),
  code('Préparer extraction du corps', '08-preparer-corps.js', [2260, 100],
       'Ne liste que les pages des sources libres effectivement retenues.'),

  {
    parameters: {
      url: '={{ $json.lien }}',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'User-Agent', value: UA },
        { name: 'Accept', value: 'text/html,application/xhtml+xml' },
      ] },
      options: {
        timeout: 45000,
        batching: { batch: { batchSize: 3, batchInterval: 1100 } },
        response: { response: { responseFormat: 'text', outputPropertyName: 'data' } },
      },
    },
    id: 'http-libres', name: 'Récupérer les articles libres',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [2480, 100],
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: 'France Info, France 24, RFI, Euronews : accès libre, texte intégral.',
  },

  code('Extraire le corps', '09-extraire-corps.js', [2700, 100],
       'Paragraphes de l’article source, habillage éditorial écarté. Un développement sans texte est supprimé.'),

  code('Extraire et surligner les chiffres', '10-chiffres.js', [1600, 100],
       'Pourcentages, montants, volumes, périodes → balises <mark> + liste structurée.'),
  code('Préparer les images', '16-preparer-images.js', [3140, 100],
       'Liste les visuels à rapatrier, en version réduite.'),

  {
    parameters: {
      url: '={{ $json.url }}',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'User-Agent', value: UA },
        { name: 'Accept', value: 'image/avif,image/webp,image/jpeg,image/png,*/*' },
      ] },
      options: {
        timeout: 30000,
        batching: { batch: { batchSize: 6, batchInterval: 300 } },
        response: { response: { responseFormat: 'file', outputPropertyName: 'data' } },
      },
    },
    id: 'http-images', name: 'Récupérer les images',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [3360, 100],
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: 'Les visuels sont intégrés au HTML : Gotenberg n’a plus aucune requête réseau à faire au moment d’imprimer.',
  },

  code('Intégrer les images', '17-integrer-images.js', [3580, 100],
       'Convertit chaque visuel en URL « data: ». Une image absente est retirée plutôt que laissée en cadre vide.'),

  code('Préparer le contrôle qualité', '18-preparer-controle.js', [3800, 100],
       'Passe déterministe (coupures, longueurs, résumés recopiés) puis constitution des lots à juger.'),

  {
    parameters: {
      method: 'POST',
      url: '={{ $json.url }}',
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ model: $json.model, prompt: $json.prompt, stream: false, options: { temperature: 0, num_predict: 400 } }) }}',
      options: { timeout: 240000, batching: { batch: { batchSize: 1, batchInterval: 200 } } },
    },
    id: 'ollama-qc', name: 'Juger la qualité (Ollama)',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [4020, 100],
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: 'Modèle local gemma2:9b. Injoignable → seule la passe déterministe s’applique, le rapport est produit quand même.',
  },

  code('Appliquer le contrôle qualité', '19-appliquer-controle.js', [4240, 100],
       'Retire les paragraphes rejetés ; un développement vidé est supprimé plutôt que laissé incohérent.'),

  code('Composer le rapport HTML', '11-rapport-html.js', [1820, 100],
       'Produit index.html + footer.html en binaire (couverture, chiffres clés, sujets multi-titres, sections par journal).'),

  {
    parameters: {
      method: 'POST',
      url: 'http://gotenberg:3000/forms/chromium/convert/html',
      sendBody: true, contentType: 'multipart-form-data',
      bodyParameters: { parameters: [
        { parameterType: 'formBinaryData', name: 'files', inputDataFieldName: 'index.html' },
        { parameterType: 'formBinaryData', name: 'files', inputDataFieldName: 'footer.html' },
        { name: 'paperWidth', value: '8.27' },
        { name: 'paperHeight', value: '11.7' },
        { name: 'marginTop', value: '0.5' },
        { name: 'marginBottom', value: '0.6' },
        { name: 'marginLeft', value: '0.4' },
        { name: 'marginRight', value: '0.4' },
        { name: 'printBackground', value: 'true' },
        { name: 'waitDelay', value: '2s' },
        { name: 'skipNetworkIdleEvent', value: 'false' },
      ] },
      options: {
        timeout: 180000,
        response: { response: { responseFormat: 'file', outputPropertyName: 'data' } },
      },
    },
    id: 'pdf-gotenberg', name: 'Convertir en PDF (Gotenberg)',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [4680, 100],
    disabled: MOTEUR_PDF !== 'gotenberg',
    notes: 'Gotenberg (Chromium sans interface) — fourni par le docker-compose. Aucune clé d’API.',
  },
  {
    parameters: {
      method: 'POST', url: 'https://api.pdfshift.io/v3/convert/pdf',
      authentication: 'genericCredentialType', genericAuthType: 'httpBasicAuth',
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ source: $binary["index.html"].data ? Buffer.from($binary["index.html"].data, "base64").toString("utf8") : "", landscape: false, use_print: true, format: "A4" }) }}',
      options: { timeout: 180000, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } },
    },
    id: 'pdf-pdfshift', name: 'Convertir en PDF (PDFShift — secours)',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [4680, 300],
    disabled: MOTEUR_PDF !== 'pdfshift',
    notes: 'Variante sans Docker (n8n Cloud) : activer ce nœud, désactiver Gotenberg, brancher une clé PDFShift en Basic Auth.',
  },

  {
    parameters: {
      method: 'POST',
      url: 'http://compresseur:3001/compress?preset=printer',
      sendBody: true, contentType: 'binaryData', inputDataFieldName: 'data',
      options: { timeout: 300000, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } },
    },
    id: 'compresser', name: 'Compresser le PDF',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [4900, 100],
    onError: 'continueRegularOutput', alwaysOutputData: true,
    notes: 'Ghostscript en 300 dpi : un rapport illustré passe de ~11,5 Mo à ~2,2 Mo, sans perte visible (les images font 42 mm). Service indisponible → le PDF d’origine est conservé.',
  },

  code('Vérifier la taille du PDF', '13-verifier-taille.js', [3580, 100],
       'Mesure le poids réel du PDF et décide s’il faut basculer sur la version sans images.'),

  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: 'trop-lourd',
          leftValue: '={{ $json.tropLourd }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    },
    id: 'if-taille', name: 'PDF trop lourd ?',
    type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [5340, 100],
    notes: 'Sortie « true » : au-delà du seuil, on régénère sans images. Sortie « false » : on envoie tel quel.',
  },

  code('Basculer sur la version allégée', '14-basculer-allege.js', [4020, 300],
       'Reprend le HTML sans images déjà produit par le nœud de composition.'),

  {
    parameters: {
      method: 'POST',
      url: 'http://gotenberg:3000/forms/chromium/convert/html',
      sendBody: true, contentType: 'multipart-form-data',
      bodyParameters: { parameters: [
        { parameterType: 'formBinaryData', name: 'files', inputDataFieldName: 'index.html' },
        { parameterType: 'formBinaryData', name: 'files', inputDataFieldName: 'footer.html' },
        { name: 'paperWidth', value: '8.27' },
        { name: 'paperHeight', value: '11.7' },
        { name: 'marginTop', value: '0.5' },
        { name: 'marginBottom', value: '0.6' },
        { name: 'marginLeft', value: '0.4' },
        { name: 'marginRight', value: '0.4' },
        { name: 'printBackground', value: 'true' },
        { name: 'waitDelay', value: '1s' },
        { name: 'skipNetworkIdleEvent', value: 'false' },
      ] },
      options: { timeout: 180000, response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } },
    },
    id: 'pdf-leger', name: 'Convertir en PDF (version allégée)',
    type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [5780, 300],
    notes: 'Deuxième passage, sans visuels : le texte seul pèse environ 200 Ko.',
  },

  code('Préparer l’envoi', '12-preparer-envoi.js', [2260, 100],
       'Renomme le PDF et compose le corps de l’e-mail.'),

  {
    parameters: {
      operation: 'write',
      fileName: '=/data/rapports/{{ $json.nomFichier }}',
      dataPropertyName: 'data',
      options: {},
    },
    id: 'archive', name: 'Enregistrer le PDF',
    type: 'n8n-nodes-base.readWriteFile', typeVersion: 1, position: [6220, 260],
    notes: 'Archive le rapport dans ./rapports du projet (monté sur /data/rapports dans le conteneur).',
  },

  code('Mémoriser l’état', '15-memoriser-etat.js', [5120, 100],
       'Enregistre la date et les liens de ce rapport pour le suivant.'),

  {
    parameters: {
      operation: 'write',
      fileName: '/data/rapports/.etat.json',
      dataPropertyName: 'etat',
      options: {},
    },
    id: 'ecrire-etat', name: 'Écrire l’état',
    type: 'n8n-nodes-base.readWriteFile', typeVersion: 1, position: [6660, 100],
    onError: 'continueRegularOutput',
    notes: 'Un échec d’écriture ne doit pas empêcher l’envoi du rapport.',
  },

  {
    parameters: {
      fromEmail: '={{ $json.expediteur }}',
      toEmail: '={{ $json.destinataire }}',
      subject: '={{ $json.sujet }}',
      emailFormat: 'html',
      html: '={{ $json.corpsHtml }}',
      options: { attachments: 'data' },
    },
    credentials: { smtp: { id: SMTP_ID, name: SMTP_NOM } },
    disabled: !ENVOI_ACTIF,
    id: 'email', name: 'Envoyer le rapport',
    type: 'n8n-nodes-base.emailSend', typeVersion: 2.1, position: [6880, 100],
    notes: 'Identifiant SMTP à créer dans n8n. Le PDF est joint depuis la propriété binaire « data ».',
  },
];

const chaine = [
  ['Toutes les 3 jours à 8 h', 'Lire l’état précédent'],
  ['Test manuel', 'Lire l’état précédent'],
  ['Lire l’état précédent', 'Configuration'],
  ['Configuration', 'Liste des flux'],
  ['Liste des flux', 'Récupérer les flux'],
  ['Récupérer les flux', 'Parser le XML'],
  ['Parser le XML', 'Normaliser les articles'],
  ['Normaliser les articles', 'Préparer enrichissement'],
  ['Préparer enrichissement', 'Récupérer les pages'],
  ['Récupérer les pages', 'Fusionner les métadonnées'],
  ['Fusionner les métadonnées', 'Préparer les embeddings'],
  ['Préparer les embeddings', 'Encoder les titres (Ollama)'],
  ['Encoder les titres (Ollama)', 'Apparier les sujets'],
  ['Apparier les sujets', 'Préparer extraction du corps'],
  ['Préparer extraction du corps', 'Récupérer les articles libres'],
  ['Récupérer les articles libres', 'Extraire le corps'],
  ['Extraire le corps', 'Extraire et surligner les chiffres'],
  ['Extraire et surligner les chiffres', 'Préparer les images'],
  ['Préparer les images', 'Récupérer les images'],
  ['Récupérer les images', 'Intégrer les images'],
  ['Intégrer les images', 'Préparer le contrôle qualité'],
  ['Préparer le contrôle qualité', 'Juger la qualité (Ollama)'],
  ['Juger la qualité (Ollama)', 'Appliquer le contrôle qualité'],
  ['Appliquer le contrôle qualité', 'Composer le rapport HTML'],
  ['Composer le rapport HTML', MOTEUR_PDF === 'gotenberg' ? 'Convertir en PDF (Gotenberg)' : 'Convertir en PDF (PDFShift — secours)'],
  [MOTEUR_PDF === 'gotenberg' ? 'Convertir en PDF (Gotenberg)' : 'Convertir en PDF (PDFShift — secours)', 'Compresser le PDF'],
  ['Compresser le PDF', 'Vérifier la taille du PDF'],
  ['Vérifier la taille du PDF', 'PDF trop lourd ?'],
  ['PDF trop lourd ?', 'Basculer sur la version allégée', 0],
  ['PDF trop lourd ?', 'Préparer l’envoi', 1],
  ['Basculer sur la version allégée', 'Convertir en PDF (version allégée)'],
  ['Convertir en PDF (version allégée)', 'Préparer l’envoi'],
  ['Préparer l’envoi', 'Enregistrer le PDF'],
  ['Enregistrer le PDF', 'Mémoriser l’état'],
  ['Mémoriser l’état', 'Écrire l’état'],
  ['Écrire l’état', 'Envoyer le rapport'],
];

const connections = {};
for (const [de, vers, sortie = 0] of chaine) {
  connections[de] ??= { main: [] };
  while (connections[de].main.length <= sortie) connections[de].main.push([]);
  connections[de].main[sortie].push({ node: vers, type: 'main', index: 0 });
}

const workflow = {
  id: 'veillePresse0001',
  name: 'Veille presse — 5 quotidiens → PDF par e-mail',
  nodes, connections,
  settings: { executionOrder: 'v1', saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner', timezone: 'Europe/Paris' },
  pinData: {}, active: false,
  tags: [{ name: 'veille' }, { name: 'presse' }],
  meta: { instanceId: 'veille-presse' },
};

// ─── Schéma du workflow, injecté dans le rapport ───────────────────────────
// Construit à partir des nœuds réellement définis ci-dessus : le schéma
// imprimé en fin de PDF ne peut donc pas diverger du workflow exécuté.
const ROLES = {
  'Toutes les 3 jours à 8 h': 'Déclencheur interne, inactif : c’est launchd qui commande.',
  'Test manuel': 'Permet de produire un rapport à la demande.',
  'Lire l’état précédent': 'Date du dernier envoi et liens déjà expédiés.',
  'Configuration': 'Destinataires, fenêtre de collecte, seuils, plafonds.',
  'Liste des flux': '21 flux RSS : 9 quotidiens, 12 sources libres.',
  'Récupérer les flux': 'Téléchargement, 3 en parallèle, tolérant aux pannes.',
  'Parser le XML': 'Conversion en données exploitables.',
  'Normaliser les articles': 'Journal déduit du domaine, datation, dédoublonnage, fenêtre de 3 jours.',
  'Préparer enrichissement': 'Repère les articles sans résumé — Le Parisien n’en fournit aucun.',
  'Récupérer les pages': 'Lecture des balises <meta> publiques.',
  'Fusionner les métadonnées': 'Complète résumé, image et date exacte.',
  'Préparer les embeddings': 'Rassemble les titres à comparer.',
  'Encoder les titres (Ollama)': 'bge-m3, local : transforme chaque titre en vecteur.',
  'Apparier les sujets': 'Sémantique + noms propres partagés : 8 % d’appariement en lexical seul, ~55 % ainsi.',
  'Préparer extraction du corps': 'Liste les articles libres à lire.',
  'Récupérer les articles libres': 'France Info, France 24, RFI, Euronews — texte intégral accessible.',
  'Extraire le corps': 'Paragraphes de l’article, habillage éditorial écarté.',
  'Extraire et surligner les chiffres': 'Pourcentages, montants, volumes, périodes.',
  'Préparer les images': 'Visuels à rapatrier, en version réduite.',
  'Récupérer les images': 'Téléchargement des visuels.',
  'Intégrer les images': 'Conversion en base64 : aucune requête réseau à l’impression.',
  'Préparer le contrôle qualité': 'Détecte coupures, longueurs aberrantes, résumés recopiés.',
  'Juger la qualité (Ollama)': 'gemma2:9b, local : écarte parasites et phrases sans information.',
  'Appliquer le contrôle qualité': 'Retire le rejeté ; llama3.1:8b rédige les thèmes, vérifiés sur le titre.',
  'Composer le rapport HTML': 'Mise en page A4, plus une variante sans images.',
  'Convertir en PDF (Gotenberg)': 'Chromium sans interface, en conteneur.',
  'Convertir en PDF (PDFShift — secours)': 'Variante sans Docker, inactive.',
  'Compresser le PDF': 'Ghostscript 300 dpi : ~22 Mo ramenés à ~2 Mo.',
  'Vérifier la taille du PDF': 'Au-delà de 20 Mo, bascule sur la version sans images.',
  'PDF trop lourd ?': 'Aiguillage vers le repli.',
  'Basculer sur la version allégée': 'Reprend le HTML sans visuels.',
  'Convertir en PDF (version allégée)': 'Second passage, texte seul.',
  'Préparer l’envoi': 'Nomme le PDF et compose le corps du message.',
  'Enregistrer le PDF': 'Archivage dans rapports/.',
  'Mémoriser l’état': 'Note la date et les liens de ce rapport.',
  'Écrire l’état': 'Sauvegarde pour l’exécution suivante.',
  'Envoyer le rapport': 'Expédition par SMTP, PDF en pièce jointe.',
};
const ETAPES = [
  ['Déclenchement', ['Toutes les 3 jours à 8 h', 'Test manuel', 'Lire l’état précédent', 'Configuration']],
  ['Collecte', ['Liste des flux', 'Récupérer les flux', 'Parser le XML', 'Normaliser les articles']],
  ['Enrichissement', ['Préparer enrichissement', 'Récupérer les pages', 'Fusionner les métadonnées']],
  ['Rapprochement des sujets', ['Préparer les embeddings', 'Encoder les titres (Ollama)', 'Apparier les sujets']],
  ['Développement', ['Préparer extraction du corps', 'Récupérer les articles libres', 'Extraire le corps']],
  ['Analyse et visuels', ['Extraire et surligner les chiffres', 'Préparer les images', 'Récupérer les images', 'Intégrer les images']],
  ['Contrôle qualité', ['Préparer le contrôle qualité', 'Juger la qualité (Ollama)', 'Appliquer le contrôle qualité']],
  ['Mise en page et PDF', ['Composer le rapport HTML', 'Convertir en PDF (Gotenberg)', 'Compresser le PDF', 'Vérifier la taille du PDF', 'PDF trop lourd ?', 'Basculer sur la version allégée', 'Convertir en PDF (version allégée)']],
  ['Diffusion', ['Préparer l’envoi', 'Enregistrer le PDF', 'Mémoriser l’état', 'Écrire l’état', 'Envoyer le rapport']],
];
const presents = new Set(nodes.filter((n) => !n.disabled).map((n) => n.name));
const schema = ETAPES.map(([titre, noms]) => ({
  titre,
  noeuds: noms.filter((n) => presents.has(n)).map((n) => ({ nom: n, role: ROLES[n] || '' })),
})).filter((e) => e.noeuds.length);

const manquants = [...presents].filter((n) => !ETAPES.some(([, l]) => l.includes(n)));
if (manquants.length) console.warn('⚠ nœuds absents du schéma :', manquants.join(', '));

const composeur = nodes.find((n) => n.name === 'Composer le rapport HTML');
composeur.parameters.jsCode = composeur.parameters.jsCode.replace(
  '/* __SCHEMA__ */ []', JSON.stringify(schema));

const sortie = path.join(ICI, 'workflow-veille-presse.json');
fs.writeFileSync(sortie, JSON.stringify(workflow, null, 2));
const noms = nodes.map((n) => n.name);
console.log(`✓ ${path.basename(sortie)} — ${nodes.length} nœuds, ${chaine.length} liaisons`);
console.log('  ' + noms.join('\n  '));
