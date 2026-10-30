// ─── Décodage des entités HTML ─────────────────────────────────────────────
// Code partagé, recopié à la construction là où le nœud pose le marqueur
// d'entités. Trois nœuds décodaient auparavant les entités chacun avec
// sa propre liste : aucun ne connaissait les entités accentuées nommées, et un
// paragraphe du 30/10 est parti dans le rapport en « candidat &agrave; la
// pr&eacute;sidentielle ». Les flux RSS et les balises <meta> les emploient
// pourtant couramment, Le Figaro et France Info en tête.
const ENTITES = {
  nbsp: ' ', quot: '"', apos: '’', lsquo: '‘', rsquo: '’', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„', laquo: '«', raquo: '»',
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', shy: '',
  deg: '°', euro: '€', pound: '£', yen: '¥', cent: '¢', copy: '©', reg: '®',
  trade: '™', permil: '‰', times: '×', divide: '÷', plusmn: '±', frac12: '½',
  frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', micro: 'µ', para: '¶',
  sect: '§', dagger: '†', Dagger: '‡', prime: '′', Prime: '″', minus: '−',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å',
  aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', ntilde: 'ñ',
  ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø',
  oelig: 'œ', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', yuml: 'ÿ', szlig: 'ß', thorn: 'þ', eth: 'ð',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å',
  AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë',
  Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï', Ntilde: 'Ñ',
  Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø',
  OElig: 'Œ', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü',
  Yacute: 'Ý', Yuml: 'Ÿ',
};

// « &amp;eacute; » doit donner « &eacute; » et non « é » : on décode donc
// &amp; en dernier, une fois que plus aucune entité réelle n'attend derrière.
const decoderEntites = (s) =>
  String(s ?? '')
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return _; } })
    .replace(/&#(\d+);?/g, (_, n) => { try { return String.fromCodePoint(+n); } catch (e) { return _; } })
    .replace(/&([A-Za-z][A-Za-z0-9]{1,9});/g, (brut, nom) => {
      if (Object.prototype.hasOwnProperty.call(ENTITES, nom)) return ENTITES[nom];
      const bas = nom.toLowerCase();
      if (bas === 'lt') return '<';
      if (bas === 'gt') return '>';
      if (bas === 'amp') return brut;      // traité ci-dessous
      return Object.prototype.hasOwnProperty.call(ENTITES, bas) ? ENTITES[bas] : brut;
    })
    .replace(/&amp;/gi, '&');
