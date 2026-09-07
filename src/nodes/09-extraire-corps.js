// ─── Extraction du corps des articles libres ───────────────────────────────
// Deux voies : les paragraphes de la zone <article>/<main>, sinon le champ
// articleBody du JSON-LD. Les blocs de navigation et d'abonnement sont écartés.

const articles = $('Apparier les sujets').all().map((i) => ({ ...i.json }));
const cibles = $('Préparer extraction du corps').all().map((i) => i.json);
const pages = $input.all();
const d = articles[0].cfg.developpements;

const deTag = (s) => String(s)
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
  .replace(/&#0?39;|&apos;/gi, '’').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/\s+/g, ' ').trim();

// Habillage éditorial à ne pas confondre avec du texte d'article
const REBUT = /^(?:s['’]abonner|abonnez|newsletter|partager|publicit|cet article|lire aussi|à lire|voir aussi|suivez|retrouvez tous|tous droits|© |commentaire|inscrivez|connectez|déjà abonné|profitez de|sans engagement|découvrez|recevez|en cliquant|vos préférences|cookies?\b|pour sauvegarder|pour profiter|vous devez être|votre compte|identifiez-vous|créez un compte|ce contenu est|activez javascript|veuillez activer)/i;
// Messages d'interface glissés au milieu du texte : lecteur vidéo bloqué,
// navigateur non pris en charge, invitation à accepter les traceurs…
const TECHNIQUE = /(?:extension de votre navigateur|lecteur (?:vid[ée]o|audio)|bloque[rz]? le chargement|regarder ce contenu|d[ée]sactiver ou la d[ée]sinstaller|votre navigateur (?:n[e’']|ne )|n[e’']est pas (?:pris en charge|compatible)|veuillez (?:accepter|activer|autoriser)|activer le javascript|acceptez les cookies|pour lire cette vid[ée]o|contenu (?:non )?disponible)/i;
const estRebut = (t) => REBUT.test(t)
  || TECHNIQUE.test(t)
  || (/\b(abonn|newsletter|cookies?|connect[ée]|inscription|javascript)\b/i.test(t) && t.length < 260);

const viaJsonLd = (html) => {
  let best = '';
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (typeof o.articleBody === 'string' && o.articleBody.length > best.length) best = o.articleBody;
        for (const v of Object.values(o)) Array.isArray(v) ? v.forEach(walk) : walk(v);
      };
      walk(JSON.parse(m[1].trim()));
    } catch (e) { /* bloc JSON-LD invalide : on passe */ }
  }
  return deTag(best);
};

const viaParagraphes = (html) => {
  const zones = [...html.matchAll(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  const src = zones.length ? zones.sort((a, b) => b.length - a.length)[0] : html;
  const vus = new Set(); const ps = [];
  for (const m of src.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = deTag(m[1]);
    if (t.length < 80 || estRebut(t)) continue;
    if (!/[.!?…»]$/.test(t) && t.length < 140) continue;   // fragment d'interface
    const k = t.slice(0, 60);
    if (vus.has(k)) continue;
    vus.add(k); ps.push(t);
  }
  return ps;
};

const corps = (html) => {
  let ps = viaParagraphes(html);
  if (ps.length < 2) {
    const ld = viaJsonLd(html);
    if (ld) ps = ld.split(/(?<=[.!?…»])\s+(?=[A-ZÀ-Ý«"])/).reduce((a, p) => {
      if (!a.length || a[a.length - 1].length > 220) a.push(p); else a[a.length - 1] += ' ' + p;
      return a;
    }, []);
  }
  const out = []; let n = 0;
  for (const p of ps) {
    if (out.length >= d.paragraphes || n + p.length > d.maxCaracteres) break;
    out.push(p); n += p.length;
  }
  return out;
};

const parLien = new Map();
pages.forEach((p, i) => {
  const cible = cibles[Math.min(i, cibles.length - 1)];
  if (!cible || cible.sentinelle) return;
  const html = typeof p.json.data === 'string' ? p.json.data : (p.json.body || '');
  if (!html || html.length < 500) return;
  const ps = corps(html);
  if (ps.length) parLien.set(cible.lien, ps);
});

// Un développement sans texte exploitable est retiré : mieux vaut rien qu'un bloc vide.
for (const a of articles) {
  if (!a.developpement) continue;
  const ps = parLien.get(a.developpement.lien);
  if (ps && ps.length) a.developpement.paragraphes = ps;
  else delete a.developpement;
}

return articles.map((a) => ({ json: a }));
