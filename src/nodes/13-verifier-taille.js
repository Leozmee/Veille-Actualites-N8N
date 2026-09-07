// ─── Contrôle du poids du PDF ──────────────────────────────────────────────
// Gmail refuse au-delà de 25 Mo. Si le rapport dépasse le seuil même compressé,
// on bascule sur la version sans images produite par le nœud de composition.
//
// Deux pièges du bac à sable n8n, tous deux rencontrés :
//   · l'opérateur « in » ne fonctionne pas sur les objets exposés (proxies) —
//     il faut tester la valeur, pas la clé ;
//   · en mode de stockage « filesystem », la chaîne « data » est une simple
//     référence de 13 caractères : sa longueur ne dit rien du poids réel.
// On s'appuie donc sur fileSize, que n8n renseigne dans les deux modes.

const rapport = $('Composer le rapport HTML').first();
const item = $input.first();
const limite = (rapport.json.maxPdfMo || 20) * 1024 * 1024;

let binaire = item.binary?.data ? item.binary : null;
let origine = 'compressé';
if (!binaire) {
  let brut = null;
  for (const nom of ['Convertir en PDF (Gotenberg)', 'Convertir en PDF (PDFShift — secours)']) {
    try { const r = $(nom).first(); if (r?.binary?.data) { brut = r; break; } } catch (e) { /* moteur inactif */ }
  }
  if (!brut?.binary?.data) throw new Error('PDF absent : vérifier Gotenberg et le compresseur.');
  binaire = brut.binary;
  origine = 'non compressé (compresseur injoignable)';
}

const enOctets = (libelle) => {
  const m = String(libelle || '').match(/([\d.,]+)\s*([kMG]?B)/i);
  if (!m) return 0;
  const unites = { B: 1, KB: 1000, MB: 1000000, GB: 1000000000 };
  return Math.round(parseFloat(m[1].replace(',', '.')) * (unites[m[2].toUpperCase()] || 1));
};

let octets = enOctets(binaire.data.fileSize);
if (!octets) {
  // Repli : contenu en base64 (mode mémoire) puis lecture du buffer.
  const brut = binaire.data.data;
  if (typeof brut === 'string' && brut.length > 64) octets = Math.floor(brut.length * 0.75);
  else {
    try {
      const buf = await this.helpers.getBinaryDataBuffer(0, 'data');
      octets = buf?.length || 0;
    } catch (e) { /* helper indisponible dans ce contexte */ }
  }
}

const tropLourd = octets > limite;

return [{
  json: {
    ...rapport.json,
    origine,
    tailleOctets: octets,
    tailleMo: Math.round((octets / 1048576) * 100) / 100,
    limiteMo: limite / 1048576,
    tropLourd,
    versionAllegee: tropLourd,
  },
  binary: binaire,
}];
