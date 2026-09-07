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

const vues = new Set();
const liste = [];
for (const a of articles) {
  if (!a.image) continue;
  const u = reduireImage(a.image);
  if (!/^https?:\/\//i.test(u) || vues.has(u)) continue;
  vues.add(u);
  liste.push({ url: u, origine: a.image });
  if (liste.length >= cfg.maxImages) break;
}

if (liste.length === 0) return [{ json: { url: '', sentinelle: true } }];
return liste.map((x) => ({ json: { ...x, sentinelle: false } }));
