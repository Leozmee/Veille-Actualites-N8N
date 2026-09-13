// ─── Contrôle qualité : passe déterministe, puis préparation du jugement ───
// Ce qui se vérifie sûrement se vérifie ici : coupures de texte, longueurs
// aberrantes, résumé recopiant le titre. Le modèle local n'est sollicité que
// pour ce qu'une règle ne sait pas trancher.

const articles = $input.all().map((i) => ({ ...i.json }));
const cfg = articles[0].cfg;
const q = cfg.controleQualite || { actif: false };

const rapport = { coupures: 0, tropCourts: 0, resumesRecopies: 0, soumisAuModele: 0 };

const finiCorrectement = (t) => /[.!?…»"'\)]\s*$/.test(String(t).trim());
const normal = (t) => String(t || '').toLowerCase().replace(/[^a-zà-ÿ0-9]+/g, ' ').trim();

for (const a of articles) {
  // Un résumé qui recopie le titre n'apporte rien.
  if (a.resume && normal(a.resume) === normal(a.titre)) { a.resume = ''; a.resumeHtml = ''; rapport.resumesRecopies++; }

  const d = a.developpement;
  if (!d?.paragraphesHtml?.length) continue;
  const gardes = [];
  d.paragraphesHtml.forEach((h, i) => {
    const texte = String(h).replace(/<[^>]+>/g, '').trim();
    if (texte.length < 60) { rapport.tropCourts++; return; }
    // Une phrase tronquée en pleine course est le défaut le plus visible.
    if (!finiCorrectement(texte)) { rapport.coupures++; return; }
    gardes.push({ html: h, texte });
  });
  d.paragraphesHtml = gardes.map((g) => g.html);
  d.textesPourControle = gardes.map((g) => g.texte);
  if (!d.paragraphesHtml.length) delete a.developpement;
}

// ── Constitution des lots pour le modèle ───────────────────────────────────
const aJuger = [];
for (const a of articles) {
  (a.developpement?.textesPourControle || []).forEach((t, i) => {
    aJuger.push({ lien: a.lien, index: i, texte: t });
  });
}
rapport.soumisAuModele = aJuger.length;

const lots = [];
if (!q.actif || aJuger.length === 0) {
  lots.push({ ignorer: true, url: `${q.ollama}/api/generate`, model: q.modele, prompt: '.', rapport });
}

const consigne = `Tu contrôles la qualité d'une revue de presse. Pour chaque paragraphe, dis s'il s'agit de texte d'article publiable.

Rejette : les renvois au format d'origine (vidéo, replay, émission, « cliquez sur »), les menus et boutons de partage, les mentions d'abonnement ou de cookies, les phrases sans information.
Garde : toute phrase d'information, même courte.

Réponds UNIQUEMENT par un tableau JSON, un objet par paragraphe, dans l'ordre :
[{"i":0,"garder":true},{"i":1,"garder":false}]`;

for (let i = 0; q.actif && i < aJuger.length && lots.length < q.maxLots; i += q.tailleLot) {
  const lot = aJuger.slice(i, i + q.tailleLot);
  lots.push({
    ignorer: false,
    url: `${q.ollama}/api/generate`,
    model: q.modele,
    prompt: `${consigne}\n\n${lot.map((x, k) => `[${k}] ${x.texte}`).join('\n\n')}`,
    cles: lot.map((x) => ({ lien: x.lien, index: x.index })),
    rapport: lots.length === 0 ? rapport : undefined,
    tache: 'paragraphes',
  });
}
// ── Étiquettes des temps forts ─────────────────────────────────────────────
// Une règle ne sait pas distinguer un thème d'une citation : « Ils sont où,
// les 30 milliards ? : censure… » donnait l'étiquette « ILS SONT OÙ, LES 30
// MILLIARDS ». Le modèle, lui, sait résumer un sujet en deux ou trois mots.
const pourEtiquettes = articles
  .filter((a) => a.developpement?.paragraphesHtml?.length)
  .slice(0, 8);

if (pourEtiquettes.length) {
  const consigneEtiq = `Pour chaque titre de presse, donne le THÈME en 2 à 4 mots, en majuscules, sans ponctuation.
Le thème est le sujet traité, jamais un extrait de citation.
N'emploie QUE des mots présents dans le titre, recopiés à l'identique. N'invente aucun mot.

Exemples :
« Ils sont où, les 30 milliards d'euros d'économies ? » : la tension monte avant le budget → BUDGET 2027
"Nous devons réduire la vitesse" : le patron d'Anthropic appelle à ralentir l'IA → RÉGULATION DE L'IA
Législatives en Suède : la droite nationaliste en tête → LÉGISLATIVES SUÉDOISES

Réponds UNIQUEMENT par un tableau JSON, dans l'ordre :
[{"i":0,"theme":"BUDGET 2027"},{"i":1,"theme":"..."}]`;

  lots.push({
    ignorer: false,
    tache: 'etiquettes',
    url: `${q.ollama}/api/generate`,
    model: q.modeleEtiquettes || q.modele,
    prompt: `${consigneEtiq}\n\n${pourEtiquettes.map((a, k) => `[${k}] ${a.titre}`).join('\n')}`,
    liens: pourEtiquettes.map((a) => a.lien),
    titres: pourEtiquettes.map((a) => a.titre),
  });
}

return lots.map((l) => ({ json: l }));
