// ─── Application du jugement du modèle ─────────────────────────────────────
// Les paragraphes rejetés sont retirés. Un développement vidé de sa substance
// est supprimé : mieux vaut pas de développement qu'un bloc incohérent.
// Modèle injoignable ou réponse illisible → seule la passe déterministe
// s'applique, le rapport est produit quand même.

const articles = $('Intégrer les images').all().map((i) => ({ ...i.json }));
const prepares = $('Préparer le contrôle qualité').all().map((i) => i.json);
const reponses = $input.all();

const rapport = prepares.find((p) => p.rapport)?.rapport
  || { coupures: 0, tropCourts: 0, resumesRecopies: 0, soumisAuModele: 0 };
rapport.rejetesParModele = 0;
rapport.modeleConsulte = false;

const aRetirer = new Set();
const etiquettes = new Map();

reponses.forEach((rep, i) => {
  const prep = prepares[i];
  if (!prep || prep.ignorer) return;

  // Lot d'étiquettes : thème court de chaque temps fort.
  if (prep.tache === 'etiquettes') {
    const brut = rep.json?.response;
    if (typeof brut !== 'string') return;
    const m = brut.match(/\[[\s\S]*\]/);
    if (!m) return;
    try {
      JSON.parse(m[0]).forEach((v) => {
        const lien = prep.liens?.[v.i];
        const theme = String(v.theme || '').trim().replace(/[.«»"']/g, '');
        if (lien && theme && theme.length <= 40) etiquettes.set(lien, theme.toUpperCase());
      });
      rapport.etiquettesGenerees = etiquettes.size;
    } catch (e) { /* réponse illisible : étiquette heuristique conservée */ }
    return;
  }

  if (!prep.cles) return;
  const brut = rep.json?.response;
  if (typeof brut !== 'string') return;
  const m = brut.match(/\[[\s\S]*\]/);
  if (!m) return;
  let verdicts;
  try { verdicts = JSON.parse(m[0]); } catch (e) { return; }
  if (!Array.isArray(verdicts)) return;
  rapport.modeleConsulte = true;
  verdicts.forEach((v) => {
    const cle = prep.cles[v.i];
    if (!cle) return;
    if (v.garder === false) { aRetirer.add(cle.lien + '#' + cle.index); rapport.rejetesParModele++; }
  });
});

let devSupprimes = 0;
for (const a of articles) {
  const d = a.developpement;
  if (!d?.paragraphesHtml?.length) continue;
  const gardes = d.paragraphesHtml.filter((_, i) => !aRetirer.has(a.lien + '#' + i));
  if (gardes.length === 0) { delete a.developpement; devSupprimes++; continue; }
  d.paragraphesHtml = gardes;
  delete d.textesPourControle;
}

for (const a of articles) {
  const e = etiquettes.get(a.lien);
  if (e) a.etiquetteIA = e;
}
rapport.developpementsSupprimes = devSupprimes;
rapport.developpementsRestants = articles.filter((a) => a.developpement?.paragraphesHtml?.length).length;

return articles.map((a, i) => ({ json: i === 0 ? { ...a, controleQualite: rapport } : a }));
