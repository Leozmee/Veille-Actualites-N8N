// ─── Appariement quotidiens ↔ sources libres ───────────────────────────────
// Score hybride : proximité sémantique (bge-m3) + recouvrement des noms
// propres et des chiffres du titre. Le second terme est décisif : « Saxe-Anhalt »,
// « Merz », « Colombie » distinguent deux sujets là où le sémantique seul,
// qui tasse tous les scores entre 0,68 et 0,79, ne sépare rien.

const tous = $('Fusionner les métadonnées').all().map((i) => ({ ...i.json }));
const prep = $('Préparer les embeddings').first().json;
const cfg = tous[0].cfg;
const d = cfg.developpements;

const agenda = tous.filter((a) => a.role !== 'libre');
const rendre = () => agenda.map((a) => ({ json: a }));

// Ollama injoignable, désactivé, ou réponse inexploitable → rapport sans développements
const rep = $input.first()?.json;
const vecteurs = rep?.embeddings;
if (prep.ignorer || !Array.isArray(vecteurs) || vecteurs.length !== prep.nAgenda + prep.nLibres) {
  return rendre();
}

const normer = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
const vAgenda = vecteurs.slice(0, prep.nAgenda).map(normer);
const vLibres = vecteurs.slice(prep.nAgenda).map(normer);
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// Noms propres et nombres du titre
const STOP = new Set(['Le','La','Les','Un','Une','Des','Du','Ce','Cette','Il','Elle','En','Au','Aux','Pour','Dans','Sur','Avec','Après','Avant','Comment','Pourquoi','Que','Qui','Quoi','Direct','Info','Vidéo','On','Nos','Ses','Son','Leur','Mais','Et','Ou','Plus','Tout','Tous','Ils','Elles','Selon','Face','Entre','Chez','Sans','Vers','Depuis','Quand']);
const entites = (t) => new Set(
  (String(t).match(/(?:[A-ZÀ-Ý][\wÀ-ÿ'’-]{2,})|(?:\d[\d  ,.]*\d|\d+)/g) || [])
    .map((m) => m.replace(/[’']s?$/, ''))
    .filter((m) => !STOP.has(m))
    // Une année nue n'identifie pas un sujet : « CAN 2027 » et « haute couture
    // 2026/2027 » ne parlent pas de la même chose.
    .filter((m) => !/^(?:19|20)\d{2}$/.test(m))
    .map((m) => m.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
);
const recouvre = (a, b) => {
  if (!a.size || !b.size) return 0;
  let i = 0; for (const x of a) if (b.has(x)) i++;
  return i / Math.min(a.size, b.size);
};

// Grilles de programmes et rendez-vous d'antenne : ce ne sont pas des articles.
const EMISSION = /^(?:le\s+)?(?:journal|jt\b|revue de presse|le supplément|l['’]invité|édition|magazine|chronique|podcast|émission|en images|en direct de|le club|débat du|les titres|à la une de)/i;
const DATE_TITRE = /\bdu\s+\d{1,2}(?:er)?\s+\w+\s+20\d{2}\s*$/i;
const estEmission = (t) => EMISSION.test(String(t).trim()) || DATE_TITRE.test(String(t).trim());

const parLien = new Map(tous.map((a) => [a.lien, a]));
const cibles = prep.liensAgenda.map((l) => parLien.get(l)).filter(Boolean);
const sources = prep.liensLibres.map((l) => parLien.get(l)).filter(Boolean);
if (cibles.length !== prep.nAgenda || sources.length !== prep.nLibres) return rendre();
const utilisable = sources.map((a) => !estEmission(a.titre));

const eCibles = cibles.map((a) => entites(a.titre));
const eSources = sources.map((a) => entites(a.titre));

const appariements = cibles.map((a, i) => {
  let best = -1, k = -1;
  for (let j = 0; j < sources.length; j++) {
    if (!utilisable[j]) continue;
    const score = d.poidsSemantique * cos(vAgenda[i], vLibres[j])
                + (1 - d.poidsSemantique) * recouvre(eCibles[i], eSources[j]);
    if (score > best) { best = score; k = j; }
  }
  return { article: a, source: sources[k], score: best };
});

// Un même article libre ne sert qu'une fois, au meilleur candidat
const pris = new Set();
let poses = 0;
for (const m of appariements.sort((x, y) => y.score - x.score)) {
  if (poses >= d.maxBlocs || m.score < d.seuil || pris.has(m.source.lien)) continue;
  pris.add(m.source.lien);
  m.article.developpement = {
    lien: m.source.lien,
    titre: m.source.titre,
    source: m.source.source,
    date: m.source.date,
    score: Math.round(m.score * 100) / 100,
    paragraphes: [],
  };
  poses++;
}

return agenda.map((a) => ({ json: a }));
