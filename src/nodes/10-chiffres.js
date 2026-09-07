// ─── Extraction et mise en valeur des données chiffrées ────────────────────
// Repère dans chaque titre/résumé : pourcentages, montants, volumes, périodes.
// Produit le texte balisé en <mark> + la liste structurée des chiffres.

const ESP = '[ \\t\\u00a0\\u202f\\u2009\\u2007]';
const NUM = `\\d{1,3}(?:${ESP}\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?`;
const SIGNE = `[+\\-−–]?${ESP}*`;
const DEVISE = `€|\\$|£|¥`;
const MONNAIE_MOT = `euros?|dollars?|livres?${ESP}+sterling|francs?|yens?|centimes?`;
const ECHELLE = `milliards?|millions?|milliers`;
const UNITES = [
  'km/h','km²','km2','m²','m2','km','kg','tonnes?','litres?','hectares?','ha',
  'TWh','GWh','MWh','kWh','MW','GW','°C',
  'ans?','années?','mois','semaines?','jours?','heures?','minutes?','secondes?',
  'habitants?','personnes?','morts?','décès','blessés?','victimes?','migrants?','réfugiés?',
  'emplois?','postes?','salariés?','fonctionnaires?','chômeurs?','agents?',
  'logements?','places?','lits?','classes?','élèves?','étudiants?','enseignants?',
  'sièges?','voix','électeurs?','candidats?','députés?','sénateurs?',
  'points?','patients?','cas','entreprises?','communes?','départements?','pays','villes?',
].join('|');

// Alternation ordonnée : les motifs les plus spécifiques d'abord.
const MOTIFS = [
  `\\b(?:19|20)\\d{2}${ESP}*[-–—]${ESP}*(?:19|20)\\d{2}\\b`,                                   // 2023-2026
  `\\bde${ESP}+(?:19|20)\\d{2}${ESP}+à${ESP}+(?:19|20)\\d{2}\\b`,                              // de 2020 à 2026
  `${SIGNE}(?:${NUM})${ESP}*(?:${ECHELLE})(?:${ESP}*d(?:e|['’])${ESP}*)?(?:${MONNAIE_MOT}|${DEVISE})`, // 92 millions de dollars
  `${SIGNE}(?:${NUM})${ESP}*(?:${DEVISE})`,                                                     // 450 €
  `(?:${DEVISE})${ESP}*(?:${NUM})`,                                                             // $450
  `${SIGNE}(?:${NUM})${ESP}*(?:${MONNAIE_MOT})`,                                                // 3 000 euros
  `${SIGNE}(?:${NUM})${ESP}*(?:%|pour${ESP}?cent|points?${ESP}+de${ESP}+(?:pourcentage|base))`, // +11 %
  `${SIGNE}(?:${NUM})${ESP}*(?:${ECHELLE})`,                                                    // 2,5 millions
  `(?:${NUM})${ESP}*(?:${UNITES})`,                                                             // 12 000 logements
  `\\d{1,3}(?:${ESP}\\d{3})+`,                                                                  // 45 000
  `\\b\\d{4,}\\b`,                                                                              // 12500
].join('|');

const RE = new RegExp(`(?<![\\p{L}\\d.,])(?:${MOTIFS})(?![\\p{L}])`, 'giu');

const echapper = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const valeurNumerique = (t) => {
  const m = t.match(/\d{1,3}(?:[     ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/);
  if (!m) return null;
  let v = parseFloat(m[0].replace(/[     ]/g, '').replace(',', '.'));
  if (isNaN(v)) return null;
  if (/milliards?/i.test(t)) v *= 1e9;
  else if (/millions?/i.test(t)) v *= 1e6;
  else if (/milliers/i.test(t)) v *= 1e3;
  if (/^[\s]*[-−–]/.test(t)) v = -v;
  return v;
};

const classer = (t) => {
  if (/^\s*(?:de\s+)?(?:19|20)\d{2}\s*(?:[-–—]|à)\s*(?:19|20)\d{2}\s*$/i.test(t)) return 'periode';
  if (/%|pour\s?cent|points?\s+de\s+(?:pourcentage|base)/i.test(t)) return 'pourcentage';
  if (/[€$£¥]|euro|dollar|livre|franc|yen|centime/i.test(t)) return 'montant';
  return 'volume';
};

// Une année isolée (2026) n'est pas une donnée chiffrée : on ne la surligne pas.
const estAnneeSeule = (t) => /^\s*\d{4}\s*$/.test(t) && +t.trim() >= 1900 && +t.trim() <= 2099;

const POIDS = { montant: 50, pourcentage: 42, volume: 30, periode: 8 };

function surligner(texte) {
  const trouves = [];
  if (!texte) return { html: '', chiffres: [] };
  const brutEchappe = echapper(texte);
  const html = brutEchappe.replace(RE, (brut, position) => {
    if (estAnneeSeule(brut)) return brut;
    // « à 19 heures », « dès 8 h » : c'est un horaire, pas une donnée chiffrée
    if (new RegExp(`^\\s*\\d{1,2}${ESP}*(?:h|heures?)\\s*$`, 'i').test(brut) &&
        /(?:à|vers|dès|avant|après|jusqu[’']à|depuis)\s*$/i.test(brutEchappe.slice(Math.max(0, position - 12), position))) return brut;
    const type = classer(brut);
    const valeur = valeurNumerique(brut);
    if (type === 'volume' && valeur !== null && Math.abs(valeur) < 10 && !/[a-zà-ÿ]/i.test(brut)) return brut;
    const affiche = brut.trim();
    const score = POIDS[type] + (valeur ? Math.max(0, Math.log10(Math.abs(valeur) + 1)) * 5 : 0);
    trouves.push({ texte: affiche, type, valeur, score: Math.round(score * 10) / 10 });
    return `<mark class="chiffre chiffre--${type}">${brut}</mark>`;
  });
  return { html, chiffres: trouves };
}

// ── Application à chaque article ───────────────────────────────────────────
return $input.all().map((item) => {
  const a = item.json;
  const t = surligner(a.titre);
  const r = surligner(a.resume);

  // Les paragraphes repris d'une source libre sont surlignés eux aussi
  let dev = null;
  const chiffresDev = [];
  if (a.developpement?.paragraphes?.length) {
    const rendus = a.developpement.paragraphes.map(surligner);
    rendus.forEach((x) => chiffresDev.push(...x.chiffres));
    dev = { ...a.developpement, paragraphesHtml: rendus.map((x) => x.html) };
  }

  // Dédoublonnage des chiffres d'un même article, tri par intérêt décroissant
  const vus = new Set();
  const chiffres = [...t.chiffres, ...r.chiffres, ...chiffresDev]
    .filter((c) => {
      const k = c.texte.toLowerCase().replace(/\s+/g, ' ');
      if (vus.has(k)) return false;
      vus.add(k);
      return true;
    })
    .sort((x, y) => y.score - x.score);

  return {
    json: {
      ...a,
      titreHtml: t.html,
      resumeHtml: r.html,
      developpement: dev,
      chiffres,
      nbChiffres: chiffres.length,
      scoreChiffres: chiffres.reduce((s, c) => s + c.score, 0),
    },
  };
});
