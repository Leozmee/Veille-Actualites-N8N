// ─── Banc d'essai local ────────────────────────────────────────────────────
// Rejoue la chaîne n8n hors n8n, sur les vrais flux, avec le même parseur XML
// (xml2js) et les mêmes réglages que le nœud XML du workflow.
//   node test-local.mjs        → out/rapport.html + out/diagnostic.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser } from 'xml2js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const NODES = path.join(ICI, 'src', 'nodes');
const OUT = path.join(ICI, 'out');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const store = {};   // sorties par nom de nœud, comme $('Nom').all() dans n8n

async function executer(fichier, nom, entree) {
  const code = fs.readFileSync(path.join(NODES, fichier), 'utf8');
  const ctx = {
    helpers: {
      prepareBinaryData: async (buf, fileName, mimeType) => ({
        data: buf.toString('base64'), mimeType, fileName,
        fileExtension: fileName.split('.').pop(), fileSize: `${buf.length} B`,
      }),
    },
  };
  const $input = {
    all: () => entree,
    first: () => entree[0],
    last: () => entree[entree.length - 1],
  };
  const $ = (n) => {
    if (!store[n]) throw new Error(`Nœud « ${n} » introuvable dans le contexte`);
    return { all: () => store[n], first: () => store[n][0] };
  };
  const fn = new Function('$input', '$', '$now', 'Buffer', `return (async () => {\n${code}\n})()`);
  const sortie = await fn.call(ctx, $input, $, new Date(), Buffer);
  store[nom] = sortie;
  console.log(`  ✓ ${nom.padEnd(34)} ${sortie.length} item(s)`);
  return sortie;
}

const recuperer = async (url, label) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    if (!r.ok) return { json: { error: `HTTP ${r.status}`, data: '' } };
    return { json: { data: await r.text() } };
  } catch (e) {
    console.log(`     ! échec ${label}: ${e.message}`);
    return { json: { error: e.message, data: '' } };
  }
};

const lots = async (liste, taille, fn) => {
  const res = [];
  for (let i = 0; i < liste.length; i += taille) {
    res.push(...(await Promise.all(liste.slice(i, i + taille).map(fn))));
  }
  return res;
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('\n▶ Chaîne de traitement\n');

  await executer('01-configuration.js', 'Configuration', [{ json: {} }]);
  const flux = await executer('02-liste-flux.js', 'Liste des flux', store['Configuration']);

  console.log(`  … téléchargement de ${flux.length} flux RSS`);
  const xmlBruts = await lots(flux, 5, (f) => recuperer(f.json.url, f.json.url));
  store['Récupérer les flux'] = xmlBruts;

  // Nœud XML de n8n : xml2js, explicitArray=false, attrkey='$', trim=true
  const parser = new Parser({ explicitArray: false, attrkey: '$', charkey: '_', trim: true, explicitRoot: true });
  const parses = [];
  for (const it of xmlBruts) {
    try { parses.push({ json: await parser.parseStringPromise(it.json.data) }); }
    catch (e) { parses.push({ json: { error: `XML illisible: ${e.message}` } }); }
  }
  store['Parser le XML'] = parses;
  console.log(`  ✓ ${'Parser le XML'.padEnd(34)} ${parses.length} item(s)`);

  const normalises = await executer('03-normaliser.js', 'Normaliser les articles', parses);
  const cibles = await executer('04-preparer-enrichissement.js', 'Préparer enrichissement', normalises);

  console.log(`  … enrichissement de ${cibles.length} page(s) (balises <meta>)`);
  const pages = await lots(cibles, 6, (c) => recuperer(c.json.lien, c.json.lien));
  store['Récupérer les pages'] = pages;

  const fusionnes = await executer('05-fusionner-meta.js', 'Fusionner les métadonnées', pages);

  // ── Appariement sémantique via Ollama ──
  const prep = await executer('06-preparer-embeddings.js', 'Préparer les embeddings', fusionnes);
  const req = prep[0].json;
  // Hors conteneur, « host.docker.internal » n'existe pas : on vise le Mac directement.
  req.url = req.url.replace('host.docker.internal', 'localhost');
  let embed = [{ json: { error: 'ignoré' } }];
  if (!req.ignorer) {
    console.log(`  … encodage de ${req.input.length} titres (${req.model})`);
    try {
      const r = await fetch(req.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: req.model, input: req.input }),
        signal: AbortSignal.timeout(300000),
      });
      embed = [{ json: r.ok ? await r.json() : { error: `HTTP ${r.status}` } }];
      if (!r.ok) console.log(`     ! Ollama a répondu ${r.status}`);
    } catch (e) { console.log(`     ! Ollama injoignable : ${e.message}`); }
  }
  store['Encoder les titres (Ollama)'] = embed;

  const apparies = await executer('07-apparier.js', 'Apparier les sujets', embed);
  const cibles2 = await executer('08-preparer-corps.js', 'Préparer extraction du corps', apparies);
  console.log(`  … lecture de ${cibles2.filter((c) => !c.json.sentinelle).length} article(s) de sources libres`);
  const pagesLibres = await lots(cibles2, 6, (c) => recuperer(c.json.lien, c.json.lien));
  store['Récupérer les articles libres'] = pagesLibres;

  const avecCorps = await executer('09-extraire-corps.js', 'Extraire le corps', pagesLibres);
  const chiffres = await executer('10-chiffres.js', 'Extraire et surligner les chiffres', avecCorps);
  const rapport = await executer('11-rapport-html.js', 'Composer le rapport HTML', chiffres);

  const html = Buffer.from(rapport[0].binary['index.html'].data, 'base64').toString('utf8');
  // Même convention de nommage que les rapports produits par n8n
  const jour = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(OUT, `revue-de-presse-${jour}.html`), html);
  fs.writeFileSync(path.join(OUT, 'rapport.html'), html);   // alias stable pour le rendu PDF
  fs.writeFileSync(path.join(OUT, 'footer.html'), Buffer.from(rapport[0].binary['footer.html'].data, 'base64').toString('utf8'));

  const diag = {
    genere: new Date().toISOString(),
    fluxInterroges: flux.length,
    diagnosticFlux: normalises[0].json.diag,
    articlesApresNormalisation: normalises.length,
    pagesEnrichies: cibles.filter((c) => !c.json.sentinelle).length,
    articlesFinaux: fusionnes.length,
    articlesAvecChiffres: chiffres.filter((c) => c.json.nbChiffres > 0).length,
    developpements: chiffres.filter((c) => c.json.developpement?.paragraphesHtml?.length).length,
    detailDeveloppements: chiffres.filter((c) => c.json.developpement?.paragraphesHtml?.length)
      .map((c) => ({ quotidien: c.json.source, titre: c.json.titre.slice(0, 70),
                     source: c.json.developpement.source, titreSource: c.json.developpement.titre.slice(0, 70),
                     score: c.json.developpement.score, paragraphes: c.json.developpement.paragraphesHtml.length })),
    totalChiffresDetectes: chiffres.reduce((s, c) => s + c.json.nbChiffres, 0),
    ...rapport[0].json,
  };
  fs.writeFileSync(path.join(OUT, 'diagnostic.json'), JSON.stringify(diag, null, 2));

  console.log('\n▶ Résultat\n');
  console.log(`  Articles retenus ............ ${diag.articlesFinaux}`);
  console.log(`  Avec données chiffrées ...... ${diag.articlesAvecChiffres} (${diag.totalChiffresDetectes} chiffres)`);
  console.log(`  Sujets multi-titres ......... ${diag.nbSujetsCommuns}`);
  console.log(`  Blocs « Développement » ..... ${diag.developpements}`);
  console.log(`  Répartition ................. ${diag.repartition.map((r) => `${r.source} ${r.total}`).join(' · ')}`);
  console.log(`\n  → out/revue-de-presse-${jour}.html (${(html.length / 1024).toFixed(0)} Ko)\n`);
})();
