// ─── Mémoire d'un rapport à l'autre ────────────────────────────────────────
// Conserve la date de l'envoi et les liens déjà expédiés, pour que le rapport
// suivant reparte exactement d'où celui-ci s'arrête : ni trou après une
// exécution retardée, ni doublon après un lancement manuel.

const articles = $('Extraire et surligner les chiffres').all().map((i) => i.json);
const info = $input.first();

const liensActuels = articles.map((a) => a.lien.split('?')[0].replace(/\/$/, ''));
const anciens = $('Configuration').first().json.dejaEnvoyes || [];

// On garde de quoi couvrir deux rapports : au-delà, la fenêtre de dates suffit.
const liens = [...new Set([...liensActuels, ...anciens])].slice(0, 900);

// Trace de la décision sur le poids du PDF : le journal d'exécution de n8n est
// tronqué, ce fichier ne l'est pas.
let diagnostic = null;
try {
  const v = $('Vérifier la taille du PDF').first();
  diagnostic = {
    origine: v.json.origine,
    tailleMo: v.json.tailleMo,
    tropLourd: v.json.tropLourd,
    binairesRecus: Object.fromEntries(Object.entries(v.binary || {}).map(([k, b]) => [k, b.fileSize])),
    binaireEnvoye: Object.fromEntries(Object.entries(info.binary || {}).map(([k, b]) => [k, b.fileSize])),
  };
} catch (e) { diagnostic = { erreur: String(e).slice(0, 200) }; }

const etat = {
  dernierRun: new Date().toISOString(),
  diagnostic,
  dernierFichier: info.json.nomFichier,
  nbArticles: articles.length,
  liens,
};

const contenu = JSON.stringify(etat, null, 2);
let bin;
try {
  bin = await this.helpers.prepareBinaryData(Buffer.from(contenu, 'utf8'), '.etat.json', 'application/json');
} catch (e) {
  bin = { data: Buffer.from(contenu, 'utf8').toString('base64'), mimeType: 'application/json', fileName: '.etat.json', fileExtension: 'json' };
}

// Le PDF doit rester attaché pour le nœud d'envoi qui suit.
return [{ json: info.json, binary: { ...info.binary, etat: bin } }];
