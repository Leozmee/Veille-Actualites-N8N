// ─── Composition du rapport HTML (converti en PDF à l'étape suivante) ──────

const articles = $input.all().map((i) => i.json);
const cfg = articles[0].cfg;
const ORDRE = ['Le Monde', 'Le Figaro', 'Le Parisien', 'Libération', 'La Croix'];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const jourLong = (d) => `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
const jourCourt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
const heure = (d) => `${String(d.getHours()).padStart(2,'0')}h${String(d.getMinutes()).padStart(2,'0')}`;

const dates = articles.map((a) => new Date(a.date)).sort((a, b) => a - b);
const debut = dates[0], fin = dates[dates.length - 1];
const periode = debut.toDateString() === fin.toDateString()
  ? `du ${jourLong(fin)}`
  : `du ${debut.getDate()} ${debut.getMonth() === fin.getMonth() ? '' : MOIS[debut.getMonth()] + ' '}au ${jourLong(fin)}`;

// ── Sujets couverts par plusieurs journaux ─────────────────────────────────
const VIDES = new Set(['dans','pour','avec','plus','sans','sous','leur','leurs','cette','cet','les','des','une','aux','que','qui','quoi','mais','donc','elle','elles','ils','son','sea','ses','est','sont','être','avoir','fait','faire','après','avant','entre','vers','chez','contre','tout','tous','toute','toutes','comme','encore','déjà','très','bien','peut','veut','face','selon','direct','notre','votre','nouvelle','nouveau','ans']);
const jetons = (t) => new Set(
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
   .replace(/[^a-z0-9]+/g, ' ').split(' ')
   .filter((m) => m.length >= 4 && !VIDES.has(m))
);
const jaccard = (a, b) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
};
const avecJetons = articles.map((a) => ({ a, j: jetons(a.titre) }));
const utilises = new Set();
const sujets = [];
for (let i = 0; i < avecJetons.length; i++) {
  if (utilises.has(i)) continue;
  const groupe = [i];
  for (let k = i + 1; k < avecJetons.length; k++) {
    if (utilises.has(k)) continue;
    if (avecJetons[k].a.source === avecJetons[i].a.source) continue;
    if (jaccard(avecJetons[i].j, avecJetons[k].j) >= cfg.seuilSujetCommun) { groupe.push(k); utilises.add(k); }
  }
  if (groupe.length > 1) { groupe.forEach((g) => utilises.add(g)); sujets.push(groupe.map((g) => avecJetons[g].a)); }
}
sujets.sort((x, y) => y.length - x.length);

// ── Chiffres marquants (toutes sources confondues) ─────────────────────────
const vus = new Set();
const chiffresCles = articles
  .flatMap((a) => (a.chiffres || []).map((c) => ({ ...c, article: a })))
  .sort((x, y) => y.score - x.score)
  .filter((c) => {
    const k = c.texte.toLowerCase().replace(/\s+/g, ' ');
    if (vus.has(k) || c.type === 'periode') return false;
    vus.add(k); return true;
  })
  .slice(0, cfg.maxChiffresMarquants);

// ── Importance d'un article ────────────────────────────────────────────────
// Trois signaux, par ordre de poids : un développement rédigé à partir d'une
// source libre, une couverture par plusieurs quotidiens, et la densité de
// données chiffrées.
const dansSujet = new Map();
sujets.forEach((groupe, i) => groupe.forEach((a) => dansSujet.set(a.lien, { rang: i, taille: groupe.length })));

const importance = (a) => {
  let n = 0;
  if (a.developpement?.paragraphesHtml?.length) n += 100 + (a.developpement.score || 0) * 20;
  const g = dansSujet.get(a.lien);
  if (g) n += 40 * (g.taille - 1);
  n += Math.min(a.scoreChiffres || 0, 60) / 2;
  if (a.rubrique === 'une') n += 15;
  if (/^\s*(?:EN DIRECT|EN IMAGES|DIRECT)\b/i.test(a.titre)) n -= 30;
  return n;
};

// Entrent dans « L'essentiel » les sujets développés et ceux traités par
// plusieurs titres : ce sont les seuls dont l'importance est établie par un
// fait, pas par une heuristique.
const aDev = (a) => (a.developpement?.paragraphesHtml?.length ? 1 : 0);

// Un même événement traité par cinq quotidiens ne doit occuper qu'une entrée :
// on retient le meilleur article et on signale les autres titres.
const candidats = articles
  .filter((a) => aDev(a) || dansSujet.has(a.lien))
  .sort((x, y) => aDev(y) - aDev(x) || importance(y) - importance(x));

// Deux titres qui partagent au moins deux noms propres marquants parlent du
// même événement, même s'ils n'ont presque aucun mot commun par ailleurs
// (« cordon sanitaire » et « onde de choc » autour de « Saxe-Anhalt »).
const MOTS_COURANTS = new Set(['France','Paris','Europe','Allemagne','Etats','Unis','Monde','Figaro','Croix','Parisien','Direct','Info']);
const nomsPropres = (t) => {
  const sortie = new Set();
  for (const brut of String(t).match(/[A-ZÀ-Ý][\wÀ-ÿ'’-]{3,}/g) || []) {
    const m = brut.replace(/[’']s?$/, '');
    if (MOTS_COURANTS.has(m)) continue;
    const norm = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    sortie.add(norm(m));
    // « Saxe-Anhalt » vaut aussi « saxe » et « anhalt » : sans cela un nom
    // composé ne pèse qu'une unité et deux titres sur le même lieu ne se
    // rapprochent pas.
    if (m.includes('-')) m.split('-').filter((x) => x.length >= 4).forEach((x) => sortie.add(norm(x)));
  }
  return sortie;
};
const communs = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };

const essentiel = [];
const jetonsGardes = [];
let sansDev = 0;
for (const a of candidats) {
  if (essentiel.length >= cfg.maxEssentiel) break;
  // Les sujets sans développement ne doivent pas noyer les autres.
  if (!aDev(a) && sansDev >= cfg.maxEssentielSansDev) continue;
  const ja = jetons(a.titre);
  const groupe = dansSujet.get(a.lien);
  const na = nomsPropres(a.titre);
  let i = jetonsGardes.findIndex((g) =>
    (groupe && g.groupe && g.groupe.rang === groupe.rang)
    || jaccard(ja, g.jetons) >= 0.30
    || communs(na, g.noms) >= 2);
  if (i >= 0) {
    // Même sujet : on garde l'angle de ce journal plutôt qu'un simple nom.
    const d = essentiel[i];
    if (d.source !== a.source && !d.angles.some((x) => x.source === a.source)) {
      d.angles.push({
        source: a.source, couleur: a.couleur, lien: a.lien,
        titreHtml: a.titreHtml, resumeHtml: a.resumeHtml,
      });
    }
    continue;
  }
  essentiel.push({ ...a, angles: [] });
  if (!aDev(a)) sansDev++;
  jetonsGardes.push({ jetons: ja, groupe, noms: na });
}
const nbDeveloppes = essentiel.filter(aDev).length;

// Deux niveaux : les sujets majeurs (développés, souvent repris par plusieurs
// titres) passent en grand format ; les autres suivent en format compact.
const tempsForts = essentiel.filter(aDev).slice(0, cfg.maxTempsForts);
const cleForts = new Set(tempsForts.map((a) => a.lien));
const reste = essentiel.filter((a) => !cleForts.has(a.lien));
// On exclut des sections journal l'article retenu ET ses doublons de sujet.
const dansEssentiel = new Set();
essentiel.forEach((e) => {
  dansEssentiel.add(e.lien);
  const je = jetons(e.titre);
  const ge = dansSujet.get(e.lien);
  for (const a of candidats) {
    const ga = dansSujet.get(a.lien);
    if ((ge && ga && ge.rang === ga.rang)
        || jaccard(je, jetons(a.titre)) >= 0.30
        || communs(nomsPropres(e.titre), nomsPropres(a.titre)) >= 2) dansEssentiel.add(a.lien);
  }
});

// ── Regroupement par journal ───────────────────────────────────────────────
const parSource = new Map();
for (const a of articles) {
  if (!parSource.has(a.source)) parSource.set(a.source, []);
  parSource.get(a.source).push(a);
}
const journaux = ORDRE.filter((s) => parSource.has(s)).map((s) => {
  const liste = parSource.get(s).sort((a, b) => new Date(b.date) - new Date(a.date));
  // Un journal dont le flux « une » n'est pas exploitable (Le Parisien ne publie
  // que des archives) mettrait sinon zéro article en avant : on prend les plus récents.
  // Les articles déjà traités dans « L'essentiel » ne sont pas repris ici.
  const restants = liste.filter((a) => !dansEssentiel.has(a.lien));
  let une = restants.filter((a) => a.rubrique === 'une').slice(0, cfg.maxUneParSource);
  if (une.length === 0) une = restants.slice(0, cfg.maxUneParSource);
  // Les articles développés d'abord, puis les autres : le lecteur trouve la
  // matière en haut de section, les sujets secondaires en dessous puis en bref.
  // Les directs (« EN DIRECT… ») sont des pages mouvantes, souvent périmées à
  // la lecture : ils restent présents mais passent après les articles fermés.
  const estDirect = (a) => /^\s*(?:EN DIRECT|EN IMAGES|DIRECT)\b/i.test(a.titre);
  une.sort((a, b) => {
    const da = a.developpement?.paragraphesHtml?.length ? 1 : 0;
    const db = b.developpement?.paragraphesHtml?.length ? 1 : 0;
    if (da !== db) return db - da;
    const la = estDirect(a) ? 1 : 0, lb = estDirect(b) ? 1 : 0;
    if (la !== lb) return la - lb;
    return new Date(b.date) - new Date(a.date);
  });
  const cleUne = new Set(une.map((a) => a.lien));
  return {
    source: s, couleur: liste[0].couleur, total: liste.length, une,
    breves: restants.filter((a) => !cleUne.has(a.lien)).slice(0, cfg.maxBrevesParSource),
    dansEssentiel: liste.filter((a) => dansEssentiel.has(a.lien)).length,
  };
});

// ── Réduction des images à la source ───────────────────────────────────────
// Les CDN des journaux acceptent une taille dans l'URL : on demande une version
// légère, sinon le PDF atteint des dizaines de Mo (images en pleine résolution).
const reduireImage = (url) => {
  if (!url) return '';
  if (String(url).startsWith('data:')) return url;   // déjà intégrée
  try {
    const u = String(url);
    if (/img\.lemde\.fr/.test(u))      return u.replace(/\/\d{3,4}\/\d{3,4}\/(\d{1,3})\/(\d)\//, '/644/322/$1/$2/');
    if (/i\.f1g\.fr/.test(u))          return u.replace(/\/media\/cms\/[^/]+\//, '/media/cms/704x396_crop/');
    if (/i\.la-croix\.com/.test(u))    return u.replace(/^(https?:\/\/i\.la-croix\.com)\/[^/]+\//, '$1/620x412/');
    return u;  // Le Parisien signe ses URL de redimensionnement : on n'y touche pas
  } catch (e) { return String(url); }
};

// Coupe au dernier mot entier : « …la tension monte à l'appr... » devenait
// illisible, la troncature brutale cassant le mot en cours.
const couper = (t, max) => {
  let p = String(t || '').trim().replace(/\s+/g, ' ');
  // Un guillemet ouvrant retiré laissait son fermant orphelin au milieu du texte.
  if (/^[«"“]/.test(p)) p = p.replace(/^[«"“]\s*/, '').replace(/\s*[»"”]\s*(?=[:,;]|$)/, ' ');
  p = p.replace(/\s+/g, ' ').trim();
  if (p.length <= max) return p;
  const bout = p.slice(0, max);
  const esp = bout.lastIndexOf(' ');
  return (esp > max * 0.5 ? bout.slice(0, esp) : bout).replace(/[,;:–—-]$/, '') + '…';
};

// Étiquette courte d'un sujet : ce qui précède les deux-points fait
// généralement office de thème dans la titraille de presse.
const etiquette = (titre) => {
  let t = String(titre || '').replace(/^(?:EN DIRECT|EN IMAGES|DIRECT|INFO [A-ZÀ-Ý ]+)[,:\s-]+/i, '').trim();

  // Un titre ouvrant sur une citation ne dit pas son thème avant les
  // deux-points : « Nous devons réduire la vitesse » : le patron d'Anthropic…
  const citation = t.match(/^[«"“][^»"”]{3,}[»"”]\s*[:,]\s*(.+)$/);
  if (citation) t = citation[1].trim();
  t = t.replace(/^[«"“”\s]+/, '');

  const avantDeuxPoints = (t.match(/^([^:«»]{4,40})\s*:/) || [])[1];

  // Les noms propres et les millésimes désignent le sujet mieux qu'un début
  // de phrase : « Pour sa quatrième campagne, Marine Le Pen se repose… »
  // donne MARINE LE PEN, là où la découpe mécanique donnait POUR SA QUATRIÈME.
  const COURANTS = new Set(['Le','La','Les','Un','Une','Des','Du','De','Ce','Il','Elle','En','Au','Aux','Pour','Dans','Sur','Avec','Après','Avant','Comment','Pourquoi','Que','Qui','Mais','Et','Ou','Plus','Tout','Tous','Selon','Face','Entre','Chez','Sans','Vers','Depuis','Quand','Son','Sa','Ses','Leur','Nos','Notre','Cette']);
  const propres = [];
  // Le mot enchaîné peut être court (« Marine Le Pen ») : une seule lettre suffit.
  for (const m of t.matchAll(/[A-ZÀ-Ý][\wÀ-ÿ'’-]{2,}(?:\s+[A-ZÀ-Ý][\wÀ-ÿ'’-]+)*|\b(?:19|20)\d{2}\b/g)) {
    // Les mots courants ne sont retirés qu'en TÊTE de bloc : « Marine Le Pen »
    // deviendrait sinon « Marine Pen ».
    const mots = m[0].split(/\s+/);
    while (mots.length && COURANTS.has(mots[0])) mots.shift();
    while (mots.length && COURANTS.has(mots[mots.length - 1])) mots.pop();
    const bloc = mots.join(' ');
    // Le premier mot d'un titre est capitalisé par convention, pas parce qu'il
    // s'agit d'un nom propre : « Réaffirmer la souveraineté… » donnait
    // RÉAFFIRMER. On écarte un mot isolé en tête qui a une forme verbale.
    const enTete = m.index === 0;
    const verbal = /(?:er|ir|re|ant|ait|ent|ez|ons)$/i.test(bloc) && !/\s/.test(bloc);
    if (bloc.length >= 3 && !(enTete && verbal)) propres.push(bloc);
  }

  const aDuFond = (x) => x && /[A-ZÀ-Ý0-9]/.test(x.slice(1)) === false
    ? propres.some((n) => x.includes(n)) : true;

  // On garde la découpe avant deux-points si elle porte un nom propre ou un
  // nombre ; sinon on préfère les noms propres du titre.
  if (avantDeuxPoints && /[A-ZÀ-Ý][\wÀ-ÿ]|\d/.test(avantDeuxPoints.slice(1))) {
    return couper(avantDeuxPoints.trim(), 26).replace(/…$/, '').toUpperCase();
  }
  if (propres.length) {
    // On n'assemble que des noms ENTIERS : couper à 26 caractères donnait
    // « MARK CARNEY EMMANUEL », le second nom tranché en plein milieu.
    const retenus = [];
    for (const n of propres) {
      const essai = [...retenus, n].join(' ');
      if (essai.length > 26) break;
      retenus.push(n);
    }
    // Un sigle isolé ne fait pas un thème : « TER » seul n'apprend rien.
    // Sous six caractères, la découpe avant deux-points est plus parlante.
    const assemble = retenus.join(' ');
    if (assemble.length >= 6) return assemble.toUpperCase();
    if (avantDeuxPoints) return couper(avantDeuxPoints.trim(), 26).replace(/…$/, '').toUpperCase();
    if (assemble) return assemble.toUpperCase();
    return couper(propres[0], 26).replace(/…$/, '').toUpperCase();
  }
  if (avantDeuxPoints) return couper(avantDeuxPoints.trim(), 24).replace(/…$/, '').toUpperCase();
  return couper(t, 24).replace(/…$/, '').replace(/\s+\S{1,3}$/, '').toUpperCase();
};

// Ce qu'on retient du sujet : le chiffre marquant s'il existe, sinon la
// suite du titre.
const accroche = (a) => {
  const c = (a.chiffres || []).find((x) => x.type !== 'periode');
  if (c) return c.texte;
  const apres = String(a.titre).split(/\s*:\s*/).slice(1).join(' : ');
  return couper(apres || a.titre, 46);
};

// ── Fragments HTML ─────────────────────────────────────────────────────────
const puces = (a) => (a.chiffres || []).slice(0, 4)
  .map((c) => `<span class="puce puce--${c.type}">${esc(c.texte)}</span>`).join('');

// Le bloc porte le titre de l'article source, jamais celui de l'article du
// quotidien : un rapprochement erroné se voit alors immédiatement, au lieu
// d'attribuer un texte au mauvais sujet.
const blocDeveloppement = (a) => {
  const d = a.developpement;
  if (!d?.paragraphesHtml?.length) return '';
  return `
    <div class="dev">
      <div class="dev-chapeau">Développement · ${esc(d.source)}</div>
      <div class="dev-titre">${esc(d.titre)}</div>
      ${d.paragraphesHtml.map((p) => `<p class="dev-texte">${p}</p>`).join('')}
    </div>`;
};

// Un même événement vu par plusieurs rédactions : on juxtapose leurs titres et
// leurs chapôs tels quels. Ce sont leurs angles, dans leurs mots, attribuables.
// Réservé aux temps forts : dans « L'essentiel », format compact, ce bloc
// alourdissait la lecture sans être attendu.
const blocAngles = (a) => {
  if (!a.angles?.length) return '';
  return `
    <div class="angles">
      <div class="angles-titre">Le même sujet vu par ${a.angles.length} autre${a.angles.length > 1 ? 's' : ''} titre${a.angles.length > 1 ? 's' : ''}</div>
      ${a.angles.map((x) => `
        <div class="angle">
          <span class="tag" style="background:${x.couleur}">${esc(x.source)}</span>
          <div class="angle-corps">
            <div class="angle-titre">${x.titreHtml}</div>
            ${x.resumeHtml ? `<div class="angle-resume">${x.resumeHtml}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
};

const carteFort = (a) => `
  <article class="fort">
    ${a.image ? `<div class="fort-img"><img src="${esc(reduireImage(a.image))}" alt=""></div>` : ''}
    <div class="fort-meta">
      <span class="repere">Temps fort</span>
      <span class="badge" style="background:${a.couleur}">${esc(a.source)}</span>
      ${esc(a.categorie || '')}${a.categorie ? ' · ' : ''}${jourCourt(new Date(a.date))} ${heure(new Date(a.date))}
      ${a.angles?.length ? ` · repris par ${a.angles.length} autre${a.angles.length > 1 ? 's' : ''} titre${a.angles.length > 1 ? 's' : ''}` : ''}
    </div>
    <h3 class="fort-titre"><a href="${esc(a.lien)}">${a.titreHtml}</a></h3>
    ${a.resumeHtml ? `<p class="fort-resume">${a.resumeHtml}</p>` : ''}
    ${a.chiffres && a.chiffres.length ? `<div class="puces">${puces(a)}</div>` : ''}
    ${blocDeveloppement(a)}
    ${blocAngles(a)}
  </article>`;

// « L'essentiel » est présenté en texte seul. Une photo n'était disponible que
// pour une partie des articles, et cette irrégularité cassait l'unité de la
// section tout en la faisant ressembler aux cartes par journal, qui ont elles
// une vignette. Trois formes distinctes valent mieux qu'un continuum flou :
// grande image pour les temps forts, texte seul ici, vignette par journal.
const carteEssentiel = (a) => `
  <article class="carte carte--essentiel carte--texte">
    <div class="carte-txt">
      <div class="carte-meta">
        <span class="repere">L’essentiel</span>
        <span class="badge" style="background:${a.couleur}">${esc(a.source)}</span>
        ${esc(a.categorie || '')}${a.categorie ? ' · ' : ''}${jourCourt(new Date(a.date))} ${heure(new Date(a.date))}
      </div>
      <h3 class="carte-titre"><a href="${esc(a.lien)}">${a.titreHtml}</a></h3>
      ${a.resumeHtml ? `<p class="carte-resume">${a.resumeHtml}</p>` : ''}
      ${a.chiffres && a.chiffres.length ? `<div class="puces">${puces(a)}</div>` : ''}
      ${blocDeveloppement(a)}
    </div>
  </article>`;

const carteUne = (a) => `
  <article class="carte">
    ${a.image ? `<div class="carte-img"><img src="${esc(reduireImage(a.image))}" alt=""></div>` : ''}
    <div class="carte-txt">
      <div class="carte-meta">${[esc(a.categorie || a.fluxLibelle || ''), `${jourCourt(new Date(a.date))} ${heure(new Date(a.date))}`].filter(Boolean).join(' · ')}</div>
      <h3 class="carte-titre"><a href="${esc(a.lien)}">${a.titreHtml}</a></h3>
      ${a.resumeHtml ? `<p class="carte-resume">${a.resumeHtml}</p>` : ''}
      ${a.chiffres && a.chiffres.length ? `<div class="puces">${puces(a)}</div>` : ''}
      ${blocDeveloppement(a)}
    </div>
  </article>`;

const ligneBreve = (a) => `
  <li class="breve">
    <span class="breve-date">${jourCourt(new Date(a.date))}</span>
    <span class="breve-corps">
      <a class="breve-titre" href="${esc(a.lien)}">${a.titreHtml}</a>
      ${a.resumeHtml ? `<span class="breve-resume">${a.resumeHtml}</span>` : ''}
    </span>
  </li>`;

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Revue de presse</title><style>
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font:10.5pt/1.5 Georgia,"Times New Roman","DejaVu Serif",serif;color:#16181d;background:#fff}
h1,h2,h3,.ui{font-family:"Helvetica Neue",Helvetica,Arial,"DejaVu Sans",sans-serif}
a{color:inherit;text-decoration:none}

/* Surlignage des données chiffrées */
.chiffre{padding:.06em .3em;border-radius:3px;font-weight:700;white-space:nowrap;border-bottom:2px solid}
.chiffre--pourcentage{background:#fef1c7;color:#8a4b06;border-color:#f0b429}
.chiffre--montant{background:#d9f7e3;color:#10633a;border-color:#34a86b}
.chiffre--volume{background:#dbe8ff;color:#17408f;border-color:#4f80e8}
.chiffre--periode{background:#ece8fb;color:#54329c;border-color:#8b6ee0}

.puces{margin:.5em 0 .35em;display:flex;flex-wrap:wrap;gap:4px}
.puce{font-family:"Helvetica Neue",Arial,sans-serif;font-size:7.6pt;font-weight:700;letter-spacing:.01em;
      padding:2.5px 7px;border-radius:20px;border:1px solid;white-space:nowrap}
.puce--pourcentage{background:#fef1c7;color:#8a4b06;border-color:#e5a72a}
.puce--montant{background:#d9f7e3;color:#10633a;border-color:#2f9c62}
.puce--volume{background:#dbe8ff;color:#17408f;border-color:#4272d6}
.puce--periode{background:#ece8fb;color:#54329c;border-color:#7f61d8}

/* ── Couverture ── */
.couverture{break-after:page;padding-bottom:6mm}
.bandeau{background:#16181d;color:#fff;padding:16mm 10mm 11mm;margin:0 0 8mm}
.surtitre{font-family:"Helvetica Neue",Arial,sans-serif;font-size:8.5pt;letter-spacing:.22em;
          text-transform:uppercase;color:#a7adba;margin-bottom:6mm}
.bandeau h1{font-family:Georgia,"DejaVu Serif",serif;font-size:33pt;line-height:1.06;margin:0 0 5mm;font-weight:400}
.bandeau .periode{font-size:12pt;color:#e7e9ee;margin:0}
.bandeau .sous{font-family:"Helvetica Neue",Arial,sans-serif;font-size:9pt;color:#8f96a4;margin-top:4mm}

.compteurs{display:flex;gap:0;border-top:1.5px solid #16181d;border-bottom:1.5px solid #16181d;margin-bottom:8mm}
.compteur{flex:1;padding:4mm 3mm;border-right:1px solid #d9dce2;text-align:center}
.compteur:last-child{border-right:0}
.compteur .n{font-family:"Helvetica Neue",Arial,sans-serif;font-size:20pt;font-weight:800;line-height:1}
.compteur .s{font-family:"Helvetica Neue",Arial,sans-serif;font-size:7.8pt;text-transform:uppercase;
             letter-spacing:.07em;color:#5c6270;margin-top:2mm}
.compteur .bar{height:3px;margin:3mm auto 0;width:60%}

.section-titre{font-size:8.6pt;font-family:"Helvetica Neue",Arial,sans-serif;letter-spacing:.16em;
               text-transform:uppercase;color:#5c6270;border-bottom:1px solid #c9cdd6;
               padding-bottom:2.5mm;margin:0 0 5mm}
.zone{padding:0 10mm}

.grille-chiffres{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;margin-bottom:8mm}
.bloc-chiffre{border:1px solid #dfe2e8;border-left-width:4px;border-radius:3px;padding:3.5mm 4mm;break-inside:avoid}
.bloc-chiffre.t-pourcentage{border-left-color:#e5a72a}
.bloc-chiffre.t-montant{border-left-color:#2f9c62}
.bloc-chiffre.t-volume{border-left-color:#4272d6}
.bloc-chiffre .v{font-family:"Helvetica Neue",Arial,sans-serif;font-size:14pt;font-weight:800;line-height:1.15;margin-bottom:2mm}
.bloc-chiffre .c{font-size:8.4pt;line-height:1.4;color:#3d434f}
.bloc-chiffre .j{font-family:"Helvetica Neue",Arial,sans-serif;font-size:7.2pt;text-transform:uppercase;
                 letter-spacing:.08em;color:#7a8090;margin-top:2mm}

.accroches{list-style:none;padding:0;margin:0 0 8mm;counter-reset:none}
.accroches li{display:flex;gap:4mm;align-items:baseline;padding:2.5mm 0;border-bottom:1px solid #eef0f4}
.accroches li:last-child{border-bottom:0}
.acc-num{font-family:"Helvetica Neue",Arial,sans-serif;font-size:12pt;font-weight:800;color:#c2c7d0;
         flex:0 0 9mm;line-height:1}
.acc-corps{flex:1;min-width:0}
.acc-theme{display:block;font-family:"Helvetica Neue",Arial,sans-serif;font-size:8.4pt;font-weight:800;
           letter-spacing:.08em;text-transform:uppercase;color:#16181d;margin-bottom:.8mm}
.acc-detail{display:block;font-family:Georgia,serif;font-size:10pt;color:#3d434f;line-height:1.35}
.sujet{border-left:3px solid #16181d;padding:2mm 0 2mm 4mm;margin-bottom:4.5mm;break-inside:avoid}
.sujet h4{font-family:Georgia,serif;font-weight:400;font-size:11pt;margin:0 0 2mm;line-height:1.3}
.sujet .titres{font-family:"Helvetica Neue",Arial,sans-serif;font-size:8pt;color:#5c6270}
.tag{display:inline-block;font-size:7.4pt;font-weight:700;padding:1.5px 6px;border-radius:2px;
     color:#fff;margin-right:4px;text-transform:uppercase;letter-spacing:.05em}

.legende{display:flex;gap:5mm;flex-wrap:wrap;font-family:"Helvetica Neue",Arial,sans-serif;
         font-size:8pt;color:#5c6270;border-top:1px solid #dfe2e8;padding-top:3.5mm}

/* ── Sections par journal ── */
.journal{break-before:page;padding:0 10mm}
.journal-entete{display:flex;align-items:baseline;gap:4mm;border-bottom:2.5px solid;padding-bottom:3mm;margin-bottom:6mm}
.journal-entete h2{font-family:Georgia,"DejaVu Serif",serif;font-size:23pt;font-weight:400;margin:0}
.journal-entete .n{font-family:"Helvetica Neue",Arial,sans-serif;font-size:8.5pt;color:#6b7280;margin-left:auto}

.fort{padding-bottom:7mm;margin-bottom:7mm;border-bottom:2px solid #16181d;break-inside:avoid}
.fort:last-child{border-bottom:0;margin-bottom:0}
.fort-img img{width:100%;height:52mm;object-fit:cover;border-radius:3px;display:block;background:#eef0f4;margin-bottom:3.5mm}
.fort-meta{font-family:"Helvetica Neue",Arial,sans-serif;font-size:7.6pt;text-transform:uppercase;
           letter-spacing:.07em;color:#8a90a0;margin-bottom:2.5mm}
.fort-titre{font-family:Georgia,"DejaVu Serif",serif;font-size:17pt;font-weight:700;line-height:1.2;margin:0 0 3mm}
.fort-resume{margin:0 0 2mm;font-size:11pt;line-height:1.55;color:#2b303a}
.sommaire{display:flex;gap:0;margin:0 0 7mm;
          font-family:"Helvetica Neue",Arial,sans-serif;font-size:9pt;line-height:1.45;color:#4a505c}
.sommaire div{flex:1;border-right:1px solid #dfe2e8;padding:0 5mm}
.sommaire div:first-child{padding-left:0}
.sommaire div:last-child{border-right:0;padding-right:0}
.som-num{display:inline-block;width:6mm;height:6mm;line-height:6mm;text-align:center;border-radius:50%;
         background:#16181d;color:#fff;font-size:8pt;font-weight:800;margin-bottom:2.5mm}
.sommaire b{display:block;color:#16181d;font-family:Georgia,"DejaVu Serif",serif;font-size:13pt;
            font-weight:700;margin-bottom:1.5mm;letter-spacing:-.01em}
.angles{margin:3mm 0 1mm;padding:3mm 0 0;border-top:1px solid #dfe2e8;break-inside:avoid}
.angles-titre{font-family:"Helvetica Neue",Arial,sans-serif;font-size:7pt;text-transform:uppercase;
              letter-spacing:.12em;color:#8a90a0;font-weight:700;margin-bottom:2.5mm}
.angle{display:flex;gap:3mm;margin-bottom:2.5mm;align-items:flex-start}
.angle:last-child{margin-bottom:0}
.angle .tag{flex:0 0 auto;margin-top:.4mm}
.angle-corps{flex:1;min-width:0}
.angle-titre{font-family:Georgia,serif;font-size:9.2pt;font-weight:700;line-height:1.3;margin-bottom:.8mm}
.angle-resume{font-size:8.4pt;line-height:1.45;color:#4a505c}
.aussi{font-family:"Helvetica Neue",Arial,sans-serif;font-size:7.6pt;color:#6b7280;margin:2mm 0 1mm}
.aussi .tag{margin-left:3px}
.repere{display:inline-block;border:1px solid #c2c7d0;color:#6b7280;font-size:6.6pt;font-weight:700;
        letter-spacing:.1em;text-transform:uppercase;padding:1px 5px;border-radius:2px;margin-right:5px}
.carte-titre a,.fort-titre a{color:inherit;text-decoration:none}
.badge{display:inline-block;color:#fff;font-size:7pt;font-weight:700;letter-spacing:.05em;
       padding:1.5px 6px;border-radius:2px;margin-right:5px;text-transform:uppercase}
.carte--essentiel{border-bottom:1px solid #d9dce2;padding-bottom:6mm;margin-bottom:6mm}
.carte--texte{display:block}
.carte--texte .carte-titre{font-size:13pt}
.carte--texte .carte-resume{font-size:10pt}
.essentiel{padding:0 10mm;break-after:page}
.essentiel-entete{border-bottom:2.5px solid #16181d;padding-bottom:3mm;margin-bottom:6mm;
                  display:flex;align-items:baseline;gap:4mm}
.essentiel-entete h2{font-family:Georgia,"DejaVu Serif",serif;font-size:23pt;font-weight:400;margin:0}
.essentiel-entete .n{font-family:"Helvetica Neue",Arial,sans-serif;font-size:8.5pt;color:#6b7280;margin-left:auto}
.carte{display:flex;gap:5mm;padding-bottom:5mm;margin-bottom:5mm;border-bottom:1px solid #e7e9ee;break-inside:avoid}
.carte-img{flex:0 0 42mm}
.carte-img img{width:42mm;height:28mm;object-fit:cover;border-radius:2px;display:block;background:#eef0f4}
.carte-txt{flex:1;min-width:0}
.carte-meta{font-family:"Helvetica Neue",Arial,sans-serif;font-size:7.4pt;text-transform:uppercase;
            letter-spacing:.08em;color:#8a90a0;margin-bottom:1.8mm}
.carte-titre{font-family:Georgia,serif;font-size:12.5pt;font-weight:700;line-height:1.28;margin:0 0 2mm}
.carte-resume{margin:0;font-size:9.6pt;line-height:1.5;color:#333844}
.dev{margin:3mm 0 2mm;padding:3mm 4mm;background:#f6f7f9;border-left:3px solid #0a3d62;border-radius:0 3px 3px 0;break-inside:avoid}
.dev-chapeau{font-family:"Helvetica Neue",Arial,sans-serif;font-size:7pt;text-transform:uppercase;
             letter-spacing:.12em;color:#0a3d62;font-weight:700;margin-bottom:1.5mm}
.dev-titre{font-family:Georgia,serif;font-size:9.6pt;font-weight:700;line-height:1.3;margin:0 0 2mm;color:#16181d}
.dev-texte{margin:0 0 1.8mm;font-size:8.9pt;line-height:1.5;color:#333844}
.dev-texte:last-of-type{margin-bottom:0}
.lien{display:block;font-family:"Helvetica Neue",Arial,sans-serif;font-size:7pt;color:#989eae;margin-top:2mm;word-break:break-all}

.breves{list-style:none;padding:0;margin:0;column-count:2;column-gap:7mm}
.breve{display:flex;gap:2.5mm;font-size:9pt;line-height:1.45;padding:2mm 0;
       border-bottom:1px dotted #d9dce2;break-inside:avoid}
.breve-date{font-family:"Helvetica Neue",Arial,sans-serif;font-size:7.4pt;font-weight:700;color:#989eae;
            padding-top:.6mm;flex:0 0 9mm}
.breve-corps{flex:1;min-width:0}
.breve-titre{font-weight:700;display:block;margin-bottom:.8mm}
.breve-resume{color:#525863;font-size:8.4pt;line-height:1.42;display:block}
.sous-titre{font-family:"Helvetica Neue",Arial,sans-serif;font-size:8.4pt;text-transform:uppercase;
            letter-spacing:.14em;color:#5c6270;margin:7mm 0 4mm;break-after:avoid}
</style></head><body>

<section class="couverture">
  <div class="bandeau">
    <div class="surtitre">Veille presse quotidienne · 5 titres nationaux</div>
    <h1>Revue de presse</h1>
    <p class="periode">${periode}</p>
    <div class="sous">${articles.length} articles collectés · ${journaux.length} journaux · généré le ${jourLong(new Date())}</div>
  </div>

  <div class="zone">
    <div class="compteurs">
      ${journaux.map((j) => `<div class="compteur"><div class="n">${j.total}</div><div class="s">${esc(j.source)}</div><div class="bar" style="background:${j.couleur}"></div></div>`).join('')}
    </div>

    ${chiffresCles.length ? `
    <h3 class="section-titre">Les chiffres qui ressortent</h3>
    <div class="grille-chiffres">
      ${chiffresCles.map((c) => `
        <div class="bloc-chiffre t-${c.type}">
          <div class="v">${esc(c.texte)}</div>
          <div class="c">${esc(couper(c.article.titre, 104))}</div>
          <div class="j">${esc(c.article.source)}</div>
        </div>`).join('')}
    </div>` : ''}

    ${tempsForts.length ? `
    <h3 class="section-titre">Les ${tempsForts.length} temps forts du jour</h3>
    <ol class="accroches">
      ${tempsForts.map((a, i) => `
        <li>
          <span class="acc-num">${String(i + 1).padStart(2, '0')}</span>
          <span class="acc-corps">
            <span class="acc-theme">${esc(a.etiquetteIA || etiquette(a.titre))}</span>
            <span class="acc-detail">${esc(accroche(a))}</span>
          </span>
        </li>`).join('')}
    </ol>` : ''}

    <h3 class="section-titre">Au sommaire</h3>
    <div class="sommaire">
      <div>
        <span class="som-num">1</span>
        <b>Les temps forts</b>
        <span>${tempsForts.length} sujet${tempsForts.length > 1 ? 's' : ''} majeur${tempsForts.length > 1 ? 's' : ''}, développés à partir de sources libres et confrontés entre titres</span>
      </div>
      <div>
        <span class="som-num">2</span>
        <b>L’essentiel</b>
        <span>${reste.length} sujet${reste.length > 1 ? 's' : ''} suivis, dont ${reste.filter(aDev).length} développé${reste.filter(aDev).length > 1 ? 's' : ''}</span>
      </div>
      <div>
        <span class="som-num">3</span>
        <b>Par journal</b>
        <span>${journaux.length} sections : les articles mis en avant, puis l’ensemble des brèves</span>
      </div>
    </div>

  </div>
</section>

${tempsForts.length ? `
<section class="essentiel">
  <div class="essentiel-entete">
    <h2>Les temps forts</h2>
    <span class="n">${tempsForts.length} sujet${tempsForts.length > 1 ? 's' : ''} majeur${tempsForts.length > 1 ? 's' : ''}, développé${tempsForts.length > 1 ? 's' : ''} et confrontés</span>
  </div>
  ${tempsForts.map(carteFort).join('')}
</section>` : ''}

${reste.length ? `
<section class="essentiel">
  <div class="essentiel-entete">
    <h2>L’essentiel</h2>
    <span class="n">${reste.filter(aDev).length} autre${reste.filter(aDev).length > 1 ? 's' : ''} sujet${reste.filter(aDev).length > 1 ? 's' : ''} développé${reste.filter(aDev).length > 1 ? 's' : ''}${reste.length > reste.filter(aDev).length ? ` · ${reste.length - reste.filter(aDev).length} suivi${reste.length - reste.filter(aDev).length > 1 ? 's' : ''} multi-titres` : ''}</span>
  </div>
  ${reste.map(carteEssentiel).join('')}
</section>` : ''}

${journaux.map((j) => `
<section class="journal">
  <div class="journal-entete" style="border-color:${j.couleur}">
    <h2 style="color:${j.couleur}">${esc(j.source)}</h2>
    <span class="n">${j.total} article${j.total > 1 ? 's' : ''}${j.dansEssentiel ? ` · ${j.dansEssentiel} dans L’essentiel` : ''}</span>
  </div>
  ${j.une.length ? `<div class="sous-titre">Les articles mis en avant</div>${j.une.map(carteUne).join('')}` : ''}
  ${j.breves.length ? `<div class="sous-titre">Tous les autres articles du journal — ${j.breves.length} sujets</div><ul class="breves">${j.breves.map(ligneBreve).join('')}</ul>` : ''}
</section>`).join('')}

</body></html>`;

const pied = `<html><head><style>
body{font:7pt "Helvetica Neue",Arial,sans-serif;color:#989eae;width:100%;margin:0;padding:0 12mm}
.l{display:flex;justify-content:space-between;border-top:1px solid #dfe2e8;padding-top:2mm}
</style></head><body><div class="l">
<span>Revue de presse ${esc(periode)}</span>
<span>Le Monde · Le Figaro · Le Parisien · Libération · La Croix</span>
<span class="pageNumber"></span>/<span class="totalPages"></span>
</div></body></html>`;

// Version de repli : même rapport, sans les visuels. Les images pèsent
// l'essentiel du PDF (le texte seul fait ~200 Ko), c'est donc le seul levier
// qui garantisse de repasser sous la limite d'envoi.
const htmlLeger = html
  .replace(/<div class="carte-img">[\s\S]*?<\/div>/g, '')
  .replace(/\.carte-txt\{flex:1;min-width:0\}/, '.carte-txt{flex:1;min-width:0}\n.carte{gap:0}');

const stamp = new Date().toISOString().slice(0, 10);
const enBinaire = async (contenu, nom, type) => {
  try { return await this.helpers.prepareBinaryData(Buffer.from(contenu, 'utf8'), nom, type); }
  catch (e) {
    return { data: Buffer.from(contenu, 'utf8').toString('base64'), mimeType: type, fileName: nom, fileExtension: nom.split('.').pop() };
  }
};

return [{
  json: {
    nomFichier: `revue-de-presse-${stamp}.pdf`,
    sujet: `Revue de presse — les actualités ${periode}`,
    destinataire: cfg.destinataire,
    expediteur: cfg.expediteur,
    periode,
    nbArticles: articles.length,
    nbSujetsCommuns: sujets.length,
    maxPdfMo: cfg.maxPdfMo,
    repartition: journaux.map((j) => ({ source: j.source, total: j.total, une: j.une.length })),
    chiffresCles: chiffresCles.map((c) => ({ texte: c.texte, type: c.type, source: c.article.source })),
  },
  binary: {
    'index.html': await enBinaire(html, 'index.html', 'text/html'),
    'footer.html': await enBinaire(pied, 'footer.html', 'text/html'),
    'index-leger.html': await enBinaire(htmlLeger, 'index.html', 'text/html'),
  },
}];
