// ─── Configuration de la veille ────────────────────────────────────────────
// Seul endroit à modifier pour régler la veille au quotidien.

// ─── Reprise de l'état précédent ───────────────────────────────────────────
// Le rapport précédent a laissé sa date et la liste des liens déjà envoyés
// dans /data/rapports/.etat.json. On repart de là plutôt que d'une fenêtre
// fixe : sinon une exécution retardée (Mac éteint) laisse un trou, et une
// exécution manuelle le même jour produit des doublons.
let dernierRun = null;
let dejaEnvoyes = [];
// En mode de stockage « filesystem », la propriété data est VIDE et le contenu
// vit sur disque : il faut passer par le helper, sinon l'état n'est jamais relu
// et le rapport repart chaque fois d'une fenêtre fixe.
try {
  const b = $input.first()?.binary?.data;
  if (b) {
    let brut = '';
    try {
      const buf = await this.helpers.getBinaryDataBuffer(0, 'data');
      if (buf?.length) brut = buf.toString('utf8');
    } catch (e) { /* helper indisponible */ }
    if (!brut && b.data) brut = Buffer.from(b.data, 'base64').toString('utf8');
    if (brut) {
      const etat = JSON.parse(brut);
      if (etat.dernierRun) dernierRun = etat.dernierRun;
      if (Array.isArray(etat.liens)) dejaEnvoyes = etat.liens;
    }
  }
} catch (e) { /* premier lancement, ou état illisible : fenêtre par défaut */ }

const config = {
  // Destinataire du rapport PDF
  destinataire: 'leogaallus@gmail.com, olivia.gallus@gmail.com',
  expediteur: 'leogaallus@gmail.com',

  // Fenêtre de collecte : on garde les articles des N derniers jours
  fenetreJours: 3,          // fenêtre par défaut, au tout premier lancement
  fenetreMaxJours: 8,       // plafond après une longue absence

  // Garde-fous de volume
  maxArticlesParSource: 45,   // après filtrage par date
  maxUneParSource: 8,        // articles affichés en carte dans la section du journal
  // Vivier de l'appariement : indépendant du nombre de cartes. Un article
  // développé remonte dans « L'essentiel » même s'il n'est pas en carte, donc
  // restreindre ce vivier appauvrit directement le rapport.
  maxCandidatsParSource: 18,
  maxEnrichissements: 60,     // nb max de pages téléchargées pour compléter les résumés
  maxArticlesLibres: 90,     // plafond par source libre (France Info, France 24, RFI, Euronews)

  // Blocs « Développement » : texte tiré des sources libres, rattaché aux unes
  developpements: {
    actif: true,
    modeleEmbedding: 'bge-m3',
    ollama: 'http://host.docker.internal:11434',  // Ollama tourne sur le Mac, pas dans Docker
    seuil: 0.65,              // mesuré : au-dessus de 0,65, aucun rapprochement erroné
    poidsSemantique: 0.65,    // le reste (0,35) vient du recouvrement des noms propres
    maxBlocs: 60,             // nb max de blocs « Développement » par rapport
    paragraphes: 3,           // paragraphes repris par bloc
    maxCaracteres: 1200,
  },

  // Détection des sujets couverts par plusieurs journaux (indice de Jaccard sur les titres)
  seuilSujetCommun: 0.40,

  // Contrôle qualité final. Deux passes : une déterministe (coupures, doublons,
  // longueurs) et une sémantique confiée à un modèle local, qui juge ce qu'une
  // expression régulière ne sait pas voir — parasite, incohérence, hors-sujet.
  controleQualite: {
    actif: true,
    modele: 'gemma2:9b',      // mesuré : 5/6 en 7,8 s, meilleur compromis local
    ollama: 'http://host.docker.internal:11434',
    tailleLot: 10,            // paragraphes jugés par appel
    maxLots: 8,
  },

  // Taille maximale du PDF joint. Au-delà, le rapport est régénéré sans images
  // (Gmail refuse au-delà de 25 Mo ; on garde de la marge pour l'encodage MIME).
  maxPdfMo: 20,

  // Nombre de chiffres marquants en page de garde
  maxImages: 80,             // images rapatriées et intégrées en base64
  maxBrevesParSource: 16,    // brèves affichées par journal (le reste est écarté)

  maxTempsForts: 5,          // sujets majeurs, en grand format
  maxEssentiel: 22,          // total des sujets mis en tête (temps forts inclus)
  maxEssentielSansDev: 7,    // parmi eux, combien au maximum sans développement
  maxChiffresMarquants: 12,
};

// Fenêtre réelle : depuis le dernier rapport, bornée pour éviter un pavé
// après une longue absence.
let fenetre = config.fenetreJours;
if (dernierRun) {
  const ecoule = (Date.now() - new Date(dernierRun).getTime()) / 86400000;
  if (ecoule > 0.2) fenetre = Math.min(Math.max(ecoule, 0.5), config.fenetreMaxJours);
}

return [{ json: { ...config, fenetreJours: Math.round(fenetre * 100) / 100, dernierRun, dejaEnvoyes } }];
