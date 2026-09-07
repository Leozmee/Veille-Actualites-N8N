// ─── Nommage du PDF et corps de l'e-mail ───────────────────────────────────

const rapport = $('Composer le rapport HTML').first().json;
const item = $input.first();

// Le PDF renvoyé par Gotenberg s'appelle « index.pdf » : on le renomme.
const bin = item.binary?.data;
if (!bin) throw new Error('PDF absent : vérifier le nœud de conversion (Gotenberg joignable ?).');
bin.fileName = rapport.nomFichier;
bin.fileExtension = 'pdf';
bin.mimeType = 'application/pdf';

const puce = (c) => {
  const teintes = {
    pourcentage: 'background:#fef1c7;color:#8a4b06;border:1px solid #e5a72a',
    montant: 'background:#d9f7e3;color:#10633a;border:1px solid #2f9c62',
    volume: 'background:#dbe8ff;color:#17408f;border:1px solid #4272d6',
  };
  return `<span style="display:inline-block;${teintes[c.type] || teintes.volume};border-radius:20px;
    padding:3px 10px;font-size:12px;font-weight:700;margin:0 5px 6px 0;">${c.texte}</span>`;
};

const corpsHtml = `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;color:#16181d">
  <div style="background:#16181d;color:#fff;padding:26px 28px;border-radius:6px 6px 0 0">
    <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#a7adba;margin-bottom:10px">
      Veille presse · 5 titres nationaux</div>
    <div style="font-size:26px;font-weight:600">Revue de presse</div>
    <div style="font-size:15px;color:#e7e9ee;margin-top:6px">${rapport.periode}</div>
  </div>
  <div style="border:1px solid #e2e5ea;border-top:0;border-radius:0 0 6px 6px;padding:24px 28px">
    <p style="margin:0 0 8px;font-size:16px;line-height:1.55">
      Bonjour,
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6">
      Voici les actualités ${rapport.periode}, réunies depuis <strong>Le Monde</strong>,
      <strong>Le Figaro</strong>, <strong>Le Parisien</strong>, <strong>Libération</strong>
      et <strong>La Croix</strong>.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6">
      Le rapport complet est en pièce jointe : <strong>${rapport.nbArticles} articles</strong>,
      les unes comme les sujets plus courts. Les données chiffrées y sont surlignées,
      et les principaux sujets sont développés en quelques paragraphes.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">
      ${rapport.repartition.map((r) => `
      <tr>
        <td style="padding:7px 0;border-bottom:1px solid #eef0f4">${r.source}</td>
        <td style="padding:7px 0;border-bottom:1px solid #eef0f4;text-align:right;color:#5c6270">
          ${r.total} article${r.total > 1 ? 's' : ''} · ${r.une} à la une</td>
      </tr>`).join('')}
    </table>
    ${rapport.chiffresCles.length ? `
      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#5c6270;margin-bottom:10px">
        Chiffres qui ressortent</div>
      <div>${rapport.chiffresCles.slice(0, 8).map(puce).join('')}</div>` : ''}
    ${rapport.nbSujetsCommuns ? `
      <p style="margin:18px 0 0;font-size:13px;color:#5c6270">
        ${rapport.nbSujetsCommuns} sujet${rapport.nbSujetsCommuns > 1 ? 's' : ''} traité${rapport.nbSujetsCommuns > 1 ? 's' : ''}
        par plusieurs journaux — détaillé${rapport.nbSujetsCommuns > 1 ? 's' : ''} en page de garde.</p>` : ''}
    <p style="margin:22px 0 0;font-size:14px;line-height:1.6">Bonne lecture.</p>
    <p style="margin:18px 0 0;font-size:12px;color:#989eae;border-top:1px solid #eef0f4;padding-top:14px">
      Sources : flux RSS officiels des cinq quotidiens ; développements tirés de France Info,
      France 24, RFI et Euronews, avec mention de leur origine.
      Rapport généré automatiquement tous les 3 jours à 8 h.
    </p>
  </div>
</div>`;

return [{ json: { ...rapport, corpsHtml }, binary: item.binary }];
