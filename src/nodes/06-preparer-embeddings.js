// ─── Préparation de l'appel d'embeddings (Ollama) ──────────────────────────
// Un seul appel encode tous les titres à comparer : ceux des unes des
// quotidiens, puis ceux des sources libres. L'ordre est conservé pour que
// le nœud d'appariement retrouve qui est qui.

const articles = $input.all().map((i) => i.json);
const cfg = articles[0].cfg;
const d = cfg.developpements;

// Vivier de l'appariement. Il est volontairement plus large que le nombre de
// cartes affichées : un article développé remonte dans « L'essentiel » même
// s'il ne figure pas en carte dans la section de son journal.
const parSource = new Map();
for (const a of articles.filter((x) => x.role !== 'libre')) {
  if (!parSource.has(a.source)) parSource.set(a.source, []);
  parSource.get(a.source).push(a);
}
const agenda = [];
for (const liste of parSource.values()) {
  liste.sort((a, b) => new Date(b.date) - new Date(a.date));
  const n = cfg.maxCandidatsParSource || cfg.maxUneParSource;
  let une = liste.filter((a) => a.rubrique === 'une').slice(0, n);
  if (une.length === 0) une = liste.slice(0, n);
  agenda.push(...une);
}
const libres = articles.filter((a) => a.role === 'libre');

// Rien à faire : on émet un item inerte pour que la branche reste vivante.
if (!d.actif || agenda.length === 0 || libres.length === 0) {
  return [{ json: { ignorer: true, url: `${d.ollama}/api/embed`, model: d.modeleEmbedding, input: ['-'] } }];
}

return [{
  json: {
    ignorer: false,
    url: `${d.ollama}/api/embed`,
    model: d.modeleEmbedding,
    input: [...agenda.map((a) => a.titre), ...libres.map((a) => a.titre)],
    nAgenda: agenda.length,
    nLibres: libres.length,
    liensAgenda: agenda.map((a) => a.lien),
    liensLibres: libres.map((a) => a.lien),
  },
}];
