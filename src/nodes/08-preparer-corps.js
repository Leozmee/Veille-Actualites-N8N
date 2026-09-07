// ─── Pages des sources libres à télécharger ────────────────────────────────
// Uniquement celles retenues par l'appariement. Item sentinelle si aucune,
// pour que la branche reste vivante dans n8n.

const articles = $input.all().map((i) => i.json);
const aLire = articles.filter((a) => a.developpement?.lien);

if (aLire.length === 0) {
  return [{ json: { lien: articles[0].lien, sentinelle: true } }];
}
return aLire.map((a) => ({ json: { lien: a.developpement.lien, sentinelle: false } }));
