// ─── Normalisation des flux RSS ────────────────────────────────────────────
// Entrée  : sortie du nœud XML (une entrée par flux)
// Sortie  : un item par article, schéma unifié, dédoublonné et filtré par date.

const fluxItems = $('Liste des flux').all();
const cfg = fluxItems[0].json.cfg;

// ── Utilitaires de lecture XML (xml2js : explicitArray=false, attrkey='$') ──
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const txt = (v) => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') return txt(v._ ?? v['#text'] ?? '');
  return '';
};
// Les attributs XML se retrouvent soit sous « $ » (attrkey par défaut), soit
// fusionnés dans l'objet parent selon la configuration du nœud XML. On accepte
// les deux formes : sans cela, les images de media:content sont perdues.
const attr = (v, name) => {
  if (!v || typeof v !== 'object') return '';
  if (v.$ && v.$[name] != null) return v.$[name];
  if (v[name] != null && typeof v[name] !== 'object') return v[name];
  if (v['@' + name] != null) return v['@' + name];
  if (v.$$ && v.$$[name] != null) return v.$$[name];
  return '';
};

// Retire les balises HTML éventuellement présentes dans les descriptions
const deTag = (s) =>
  String(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '’')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

// ── Identification du journal par le domaine du lien (robuste aux décalages) ─
const JOURNAUX = [
  { test: /(^|\.)lemonde\.fr/i,    source: 'Le Monde',    couleur: '#1a1a1a' },
  { test: /(^|\.)lefigaro\.fr/i,   source: 'Le Figaro',   couleur: '#00539f' },
  { test: /(^|\.)leparisien\.fr/i, source: 'Le Parisien', couleur: '#e2001a' },
  { test: /(^|\.)liberation\.fr/i, source: 'Libération',  couleur: '#e10600' },
  { test: /(^|\.)la-croix\.com/i,  source: 'La Croix',    couleur: '#0069b4' },
  // sources libres (profondeur) — pas de section propre dans le rapport
  { test: /(^|\.)(?:france)?tvinfo\.fr|(^|\.)franceinfo\.fr/i, source: 'France Info', couleur: '#0a3d62', role: 'libre' },
  { test: /(^|\.)france24\.com/i,  source: 'France 24',   couleur: '#0a3d62', role: 'libre' },
  { test: /(^|\.)rfi\.fr/i,        source: 'RFI',         couleur: '#0a3d62', role: 'libre' },
  { test: /(^|\.)euronews\.com/i,  source: 'Euronews',    couleur: '#0a3d62', role: 'libre' },
];
const identifier = (lien) => {
  let host = '';
  try { host = new URL(lien).hostname; } catch (e) { host = String(lien); }
  return JOURNAUX.find((j) => j.test.test(host)) || null;
};

// ── Datation ───────────────────────────────────────────────────────────────
// 1) <pubDate> / <dc:date>  2) date contenue dans l'URL (Le Parisien n'en a pas d'autre)
const dateDepuisUrl = (lien) => {
  const u = String(lien);
  let m = u.match(/[-/](\d{2})-(\d{2})-(20\d{2})[-/.]/);          // -07-09-2026-  (Le Parisien)
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T09:00:00+02:00`);
  m = u.match(/[-/_](20\d{2})(\d{2})(\d{2})(?:[-_/.]|$)/);        // -20260907     (Figaro, Libé, La Croix)
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T09:00:00+02:00`);
  m = u.match(/\/(20\d{2})\/(\d{2})\/(\d{2})\//);                 // /2026/09/07/  (Le Monde)
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T09:00:00+02:00`);
  return null;
};
const lireDate = (it, lien) => {
  for (const cle of ['pubDate', 'dc:date', 'date', 'published', 'updated']) {
    const brut = txt(it[cle]);
    if (brut) {
      const d = new Date(brut.trim());
      if (!isNaN(d)) return { date: d, source: 'flux' };
    }
  }
  const d = dateDepuisUrl(lien);
  return d && !isNaN(d) ? { date: d, source: 'url' } : { date: null, source: 'aucune' };
};

// ── Image de l'article ─────────────────────────────────────────────────────
const urlDe = (v) => {
  if (!v) return '';
  if (typeof v === 'string') return /^https?:/i.test(v) ? v : '';
  return attr(v, 'url');
};
const lireImage = (it) => {
  for (const cle of ['media:content', 'media:thumbnail', 'image', 'enclosure']) {
    for (const v of asArray(it[cle])) {
      if (cle === 'enclosure') {
        const type = attr(v, 'type');
        if (type && !/^image\//i.test(type)) continue;
      }
      const u = urlDe(v);
      if (u) return u;
    }
  }
  // Dernier recours : une image citée dans le contenu enrichi du flux
  const html = txt(it['content:encoded']) || txt(it.description);
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : '';
};

// ── Parcours des flux ──────────────────────────────────────────────────────
const maintenant = new Date();
const limite = new Date(maintenant.getTime() - cfg.fenetreJours * 86400000);
const parUrl = new Map();
const diag = [];
// Articles déjà partis dans un rapport précédent : on ne les reprend pas.
const dejaVus = new Set($('Configuration').first().json.dejaEnvoyes || []);

$input.all().forEach((entree, i) => {
  const meta = fluxItems[Math.min(i, fluxItems.length - 1)].json;
  const doc = entree.json;
  const canal = doc?.rss?.channel ?? doc?.channel ?? doc?.feed ?? null;
  const bruts = asArray(canal?.item ?? canal?.entry ?? []);

  if (!canal || bruts.length === 0) {
    diag.push({ flux: meta.url, source: meta.source, articles: 0, erreur: doc?.error ? String(doc.error).slice(0, 200) : 'flux vide ou illisible' });
    return;
  }

  let retenus = 0;
  for (const it of bruts) {
    const lien = (txt(it.link) || txt(it.guid) || attr(asArray(it.link)[0], 'href')).trim();
    if (!lien || !/^https?:/i.test(lien)) continue;

    const journal = identifier(lien) || { source: meta.source, couleur: meta.couleur };
    const titre = deTag(txt(it.title));
    if (!titre) continue;

    const { date, source: origineDate } = lireDate(it, lien);
    // Sans date exploitable on ne peut pas garantir la fraîcheur : on écarte.
    if (!date) continue;
    if (date < limite || date > new Date(maintenant.getTime() + 86400000)) continue;

    const cle = lien.split('?')[0].replace(/\/$/, '');
    if (dejaVus.has(cle)) continue;
    const existant = parUrl.get(cle);
    const article = {
      titre,
      lien,
      resume: deTag(txt(it.description) || txt(it['content:encoded']) || txt(it.summary)),
      date: date.toISOString(),
      dateOrigine: origineDate,
      source: journal.source,
      couleur: journal.couleur,
      role: journal.role || meta.role || 'agenda',
      rubrique: (journal.role || meta.role) === 'libre' ? 'libre' : meta.rubrique,
      fluxLibelle: meta.libelle,
      categorie: deTag(asArray(it.category).map(txt).filter(Boolean).join(' · ')),
      auteur: deTag(txt(it['dc:creator'])),
      image: lireImage(it),
    };

    // Un article vu dans « une » et dans « fil » reste en « une »
    if (existant) {
      if (existant.rubrique === 'fil' && article.rubrique === 'une') parUrl.set(cle, { ...existant, rubrique: 'une', fluxLibelle: article.fluxLibelle });
      if (!existant.resume && article.resume) parUrl.get(cle).resume = article.resume;
      if (!existant.image && article.image) parUrl.get(cle).image = article.image;
      continue;
    }
    parUrl.set(cle, article);
    retenus++;
  }
  diag.push({ flux: meta.url, source: meta.source, rubrique: meta.rubrique, recus: bruts.length, retenus });
});

// ── Plafond par journal, les plus récents d'abord ──────────────────────────
const tous = [...parUrl.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
const compte = {};
const retenus = [];
for (const a of tous) {
  compte[a.source] = (compte[a.source] || 0) + 1;
  const plafond = a.role === 'libre' ? cfg.maxArticlesLibres : cfg.maxArticlesParSource;
  if (compte[a.source] <= plafond) retenus.push(a);
}

if (retenus.filter((a) => a.role !== 'libre').length === 0) {
  throw new Error('Aucun article collecté sur la fenêtre demandée. Diagnostic : ' + JSON.stringify(diag));
}

return retenus.map((a, idx) => ({
  json: {
    ...a,
    id: idx,
    besoinEnrichissement: a.role !== 'libre' && (!a.resume || a.resume.length < 40),
    cfg,
    diag: idx === 0 ? diag : undefined,
  },
}));
