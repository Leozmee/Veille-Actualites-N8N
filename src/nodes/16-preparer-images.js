// ─── Images à télécharger ──────────────────────────────────────────────────
// Les intégrer en base64 dans le HTML rend l'impression déterministe : plus de
// requête réseau au moment du rendu, donc plus d'image manquante au hasard
// d'un délai ou d'une protection anti-hotlink.

const articles = $input.all().map((i) => i.json);
const cfg = articles[0].cfg;

// Même réduction qu'à l'affichage : inutile de rapatrier du 3000×2000.
const reduireImage = (url) => {
  if (!url) return '';
  const u = String(url);
  if (/img\.lemde\.fr/.test(u))   return u.replace(/\/\d{3,4}\/\d{3,4}\/(\d{1,3})\/(\d)\//, '/644/322/$1/$2/');
  if (/i\.f1g\.fr/.test(u))       return u.replace(/\/media\/cms\/[^/]+\//, '/media/cms/704x396_crop/');
  if (/i\.la-croix\.com/.test(u)) return u.replace(/^(https?:\/\/i\.la-croix\.com)\/[^/]+\//, '$1/620x412/');
  return u;
};

// Priorité aux articles RÉELLEMENT illustrés dans le rapport. Le plafond
// s'appliquait jusqu'ici à la simple liste chronologique : les images partaient
// aux articles les plus récents, qui finissent le plus souvent en brèves — donc
// sans visuel — et les cartes se retrouvaient sans rien. On reproduit ici la
// sélection du nœud de composition : sujets développés, puis premières cartes
// de chaque journal.
const agenda = articles.filter((a) => a.role !== 'libre');
const parJournal = new Map();
for (const a of agenda) {
  if (!parJournal.has(a.source)) parJournal.set(a.source, []);
  parJournal.get(a.source).push(a);
}
const affiches = new Set();
for (const a of agenda) if (a.developpement?.paragraphes?.length || a.developpement) affiches.add(a.lien);
for (const liste of parJournal.values()) {
  liste.sort((x, y) => new Date(y.date) - new Date(x.date));
  let une = liste.filter((x) => x.rubrique === 'une').slice(0, cfg.maxUneParSource);
  if (une.length === 0) une = liste.slice(0, cfg.maxUneParSource);
  une.forEach((x) => affiches.add(x.lien));
}

const ordonnes = [...agenda].sort((x, y) => (affiches.has(y.lien) ? 1 : 0) - (affiches.has(x.lien) ? 1 : 0));

const vues = new Set();
const liste = [];
for (const a of ordonnes) {
  if (!a.image) continue;
  const u = reduireImage(a.image);
  if (!/^https?:\/\//i.test(u) || vues.has(u)) continue;
  vues.add(u);
  liste.push({ url: u, origine: a.image });
  if (liste.length >= cfg.maxImages) break;
}

if (liste.length === 0) return [{ json: { url: '', sentinelle: true } }];
return liste.map((x) => ({ json: { ...x, sentinelle: false } }));
