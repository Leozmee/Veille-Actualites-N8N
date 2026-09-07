// ─── Bascule vers la version sans images ───────────────────────────────────
// N'est atteint que si le PDF illustré dépasse le seuil. On repasse à Gotenberg
// le HTML allégé déjà préparé par le nœud de composition.

const rapport = $('Composer le rapport HTML').first();
const info = $input.first().json;

return [{
  json: info,
  binary: {
    'index.html': rapport.binary['index-leger.html'],
    'footer.html': rapport.binary['footer.html'],
  },
}];
