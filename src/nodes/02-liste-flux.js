// ─── Liste des flux RSS à interroger ───────────────────────────────────────
// Un item de sortie = un flux. Le nœud HTTP suivant s'exécute une fois par item.
// Flux vérifiés le 07/09/2026 (tous en HTTP 200).

// dejaEnvoyes reste dans le nœud Configuration : recopié sur chaque article,
// il alourdirait inutilement toute la chaîne.
const { dejaEnvoyes, ...cfg } = $input.first().json;

const flux = [
  // ─── AGENDA : les 5 quotidiens. Ils définissent ce que la presse traite. ───
  // Le Monde
  { source: 'Le Monde',   domaine: 'lemonde.fr',    couleur: '#1a1a1a', rubrique: 'une', libelle: 'À la une',
    url: 'https://www.lemonde.fr/rss/une.xml' },
  { source: 'Le Monde',   domaine: 'lemonde.fr',    couleur: '#1a1a1a', rubrique: 'fil', libelle: 'En continu',
    url: 'https://www.lemonde.fr/rss/en_continu.xml' },

  // Le Figaro
  { source: 'Le Figaro',  domaine: 'lefigaro.fr',   couleur: '#00539f', rubrique: 'une', libelle: 'Actualités',
    url: 'https://www.lefigaro.fr/rss/figaro_actualites.xml' },
  { source: 'Le Figaro',  domaine: 'lefigaro.fr',   couleur: '#00539f', rubrique: 'fil', libelle: 'Flash actu',
    url: 'https://www.lefigaro.fr/rss/figaro_flash-actu.xml' },

  // Le Parisien  (flux sans date ni résumé : complétés par l'étape d'enrichissement)
  { source: 'Le Parisien', domaine: 'leparisien.fr', couleur: '#e2001a', rubrique: 'une', libelle: 'À la une',
    url: 'https://feeds.leparisien.fr/leparisien/rss/une' },
  { source: 'Le Parisien', domaine: 'leparisien.fr', couleur: '#e2001a', rubrique: 'fil', libelle: 'Fil général',
    url: 'https://feeds.leparisien.fr/leparisien/rss' },

  // Libération
  { source: 'Libération', domaine: 'liberation.fr', couleur: '#e10600', rubrique: 'une', libelle: 'Toutes les infos',
    url: 'https://www.liberation.fr/arc/outboundfeeds/rss-all/?outputType=xml' },

  // La Croix
  { source: 'La Croix',   domaine: 'la-croix.com',  couleur: '#0069b4', rubrique: 'une', libelle: 'Tous univers',
    url: 'https://www.la-croix.com/RSS/UNIVERS' },
  { source: 'La Croix',   domaine: 'la-croix.com',  couleur: '#0069b4', rubrique: 'fil', libelle: 'France',
    url: 'https://www.la-croix.com/RSS/UNIVERS_WFRA' },

  // ─── PROFONDEUR : sources libres, texte intégral accessible. ──────────────
  // Elles n'ont pas de section dans le rapport : elles alimentent les blocs
  // « Développement » rattachés aux articles à la une des quotidiens.
  { source: 'France Info', domaine: 'franceinfo.fr',  couleur: '#0a3d62', role: 'libre',
    url: 'https://www.franceinfo.fr/titres.rss' },
  { source: 'France 24',   domaine: 'france24.com',   couleur: '#0a3d62', role: 'libre',
    url: 'https://www.france24.com/fr/rss' },
  { source: 'France 24',   domaine: 'france24.com',   couleur: '#0a3d62', role: 'libre',
    url: 'https://www.france24.com/fr/france/rss' },
  { source: 'RFI',         domaine: 'rfi.fr',         couleur: '#0a3d62', role: 'libre',
    url: 'https://www.rfi.fr/fr/france/rss' },
  { source: 'RFI',         domaine: 'rfi.fr',         couleur: '#0a3d62', role: 'libre',
    url: 'https://www.rfi.fr/fr/monde/rss' },
  { source: 'Euronews',    domaine: 'euronews.com',   couleur: '#0a3d62', role: 'libre',
    url: 'https://fr.euronews.com/rss?level=theme&name=news' },
  // Rubriques supplémentaires : plus le vivier est large, plus d'articles des
  // quotidiens trouvent leur équivalent développé.
  { source: 'France Info', domaine: 'franceinfo.fr',  couleur: '#0a3d62', role: 'libre',
    url: 'https://www.franceinfo.fr/politique.rss' },
  { source: 'France Info', domaine: 'franceinfo.fr',  couleur: '#0a3d62', role: 'libre',
    url: 'https://www.franceinfo.fr/monde.rss' },
  { source: 'France Info', domaine: 'franceinfo.fr',  couleur: '#0a3d62', role: 'libre',
    url: 'https://www.franceinfo.fr/economie.rss' },
  { source: 'France Info', domaine: 'franceinfo.fr',  couleur: '#0a3d62', role: 'libre',
    url: 'https://www.franceinfo.fr/societe.rss' },
  { source: 'France 24',   domaine: 'france24.com',   couleur: '#0a3d62', role: 'libre',
    url: 'https://www.france24.com/fr/europe/rss' },
  { source: 'RFI',         domaine: 'rfi.fr',         couleur: '#0a3d62', role: 'libre',
    url: 'https://www.rfi.fr/fr/economie/rss' },
];

return flux.map((f) => ({ json: { role: 'agenda', rubrique: 'fil', libelle: '', ...f, cfg } }));
