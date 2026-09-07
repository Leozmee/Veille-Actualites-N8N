// ─── Sélection des articles à compléter ────────────────────────────────────
// Certains flux (Le Parisien) ne renvoient que titre + lien.
// On prépare ici la liste des pages à consulter pour récupérer les balises <meta>.
// Aucune page n'est téléchargée si tous les flux sont déjà complets : on émet
// alors un item sentinelle pour que la branche reste active dans n8n.

const articles = $input.all().map((i) => i.json);
const cfg = articles[0].cfg;

const aCompleter = articles
  .filter((a) => a.besoinEnrichissement)
  .slice(0, cfg.maxEnrichissements);

if (aCompleter.length === 0) {
  return [{ json: { lien: articles[0].lien, sentinelle: true } }];
}

return aCompleter.map((a) => ({ json: { lien: a.lien, sentinelle: false } }));
