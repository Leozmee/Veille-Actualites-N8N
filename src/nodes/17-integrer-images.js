// ─── Intégration des images en base64 ──────────────────────────────────────
// Chaque image rapatriée devient une URL « data: ». Une image absente est
// simplement retirée de l'article : mieux vaut pas de visuel qu'un cadre vide.

const articles = $('Extraire et surligner les chiffres').all().map((i) => ({ ...i.json }));
const cibles = $('Préparer les images').all().map((i) => i.json);
const recues = $input.all();

const parUrl = new Map();
for (let i = 0; i < recues.length; i++) {
  const cible = cibles[i];
  if (!cible || cible.sentinelle) continue;
  const bin = recues[i].binary?.data;
  if (!bin) continue;
  const type = String(bin.mimeType || '');
  if (!/^image\//i.test(type)) continue;
  let buf = null;
  try { buf = await this.helpers.getBinaryDataBuffer(i, 'data'); } catch (e) { /* voir repli */ }
  if (!buf && typeof bin.data === 'string' && bin.data.length > 256) buf = Buffer.from(bin.data, 'base64');
  if (!buf || buf.length < 512) continue;                 // réponse vide ou pixel de suivi
  parUrl.set(cible.origine, `data:${type};base64,${buf.toString('base64')}`);
}

let integrees = 0, retirees = 0;
for (const a of articles) {
  if (!a.image) continue;
  const d = parUrl.get(a.image);
  if (d) { a.image = d; integrees++; }
  else { a.image = ''; retirees++; }
}

return articles.map((a, i) => ({
  json: i === 0 ? { ...a, imagesIntegrees: integrees, imagesRetirees: retirees } : a,
}));
