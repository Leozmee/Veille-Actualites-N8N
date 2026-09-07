// ─── Fusion des métadonnées récupérées sur les pages ───────────────────────
// Entrée : HTML brut des pages (aligné sur « Préparer enrichissement »).
// On extrait og:description / article:published_time / og:image, puis on
// refusionne avec la liste complète d'articles issue de la normalisation.

const articles = $('Normaliser les articles').all().map((i) => ({ ...i.json }));
const cibles = $('Préparer enrichissement').all().map((i) => i.json);
const pages = $input.all();
const cfg = articles[0].cfg;

const meta = (html, cles) => {
  for (const cle of cles) {
    const re = new RegExp(
      '<meta[^>]*(?:property|name)\\s*=\\s*["\']' + cle + '["\'][^>]*>',
      'i'
    );
    const balise = html.match(re);
    if (!balise) continue;
    const val = balise[0].match(/content\s*=\s*["']([^"']*)["']/i);
    if (val && val[1].trim()) return val[1].trim();
  }
  return '';
};
const decode = (s) =>
  String(s)
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, '’')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ').trim();

// Les URL de redimensionnement du Parisien sont signées : impossible d'y changer
// la taille après coup. On cherche donc dans la page la plus petite variante déjà
// signée pour la même image (≥ 600 px), sans quoi le PDF gonfle de plusieurs Mo
// par article. La carte ne fait que 42 mm, soit ~500 px à l'impression.
const imageLegere = (html, defaut) => {
  if (!defaut || !/leparisien\.fr\/resizer/.test(defaut)) return defaut;
  const fichier = defaut.split('/').pop().split('?')[0];
  if (!fichier) return defaut;
  const candidats = [];
  for (const m of html.matchAll(/https:\/\/www\.leparisien\.fr\/resizer\/[^"'\s\\]+/g)) {
    const u = m[0];
    if (u.split('/').pop().split('?')[0] !== fichier) continue;
    const t = u.match(/\/(\d+)x(\d+)\//);
    if (t && +t[1] >= 600) candidats.push({ url: u, largeur: +t[1] });
  }
  if (!candidats.length) return defaut;
  candidats.sort((a, b) => a.largeur - b.largeur);
  return candidats[0].url;
};

// Indexation des métadonnées par URL
const parLien = new Map();
pages.forEach((p, i) => {
  const cible = cibles[Math.min(i, cibles.length - 1)];
  if (!cible || cible.sentinelle) return;
  const html = typeof p.json.data === 'string' ? p.json.data : (p.json.body || '');
  if (!html || html.length < 200) return;
  parLien.set(cible.lien, {
    resume: decode(meta(html, ['og:description', 'description', 'twitter:description'])),
    image: imageLegere(html, meta(html, ['og:image', 'twitter:image'])),
    datePubliee: meta(html, ['article:published_time', 'datePublished', 'article:modified_time']),
  });
});

// Application + re-filtrage sur la fenêtre (une date exacte peut maintenant être connue)
const maintenant = new Date();
const limite = new Date(maintenant.getTime() - cfg.fenetreJours * 86400000);

const enrichis = articles.map((a) => {
  const m = parLien.get(a.lien);
  if (!m) return a;
  if (!a.resume && m.resume) { a.resume = m.resume; }
  if (!a.image && m.image) a.image = m.image;
  if (m.datePubliee) {
    const d = new Date(m.datePubliee);
    if (!isNaN(d)) { a.date = d.toISOString(); a.dateOrigine = 'page'; }
  }
  return a;
});

const retenus = enrichis
  .filter((a) => {
    const d = new Date(a.date);
    return d >= limite && d <= new Date(maintenant.getTime() + 86400000);
  })
  .sort((a, b) => new Date(b.date) - new Date(a.date));

if (retenus.length === 0) throw new Error('Aucun article dans la fenêtre après enrichissement.');

return retenus.map((a) => ({ json: a }));
