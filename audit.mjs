// Audit du rapport : structure, rapprochements, fond, chiffres.
import fs from 'node:fs';
const html = fs.readFileSync('out/rapport.html','utf8');
const diag = JSON.parse(fs.readFileSync('out/diagnostic.json','utf8'));
const P=[]; const ko=(c,m)=>P.push(['✗',c,m]); const att=(c,m)=>P.push(['!',c,m]);
const deTag=s=>s.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();

const sections=[...html.matchAll(/<section class="journal">([\s\S]*?)<\/section>/g)].map(m=>m[1]);
const cartes=(html.match(/class="carte"/g)||[]).length;
const imgs=[...html.matchAll(/<img src="([^"]+)"/g)].map(m=>m[1]);
console.log(`STRUCTURE  ${sections.length} sections · ${cartes} cartes · ${(html.match(/class="breve"/g)||[]).length} brèves · ${(html.match(/class="dev"/g)||[]).length} développements · ${imgs.length} images référencées`);
for(const s of sections){
  const nom=deTag((s.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)||[])[1]||'?');
  const c=(s.match(/class="carte"/g)||[]).length, b=(s.match(/class="breve"/g)||[]).length, d=(s.match(/class="dev"/g)||[]).length, i=(s.match(/<img /g)||[]).length;
  console.log(`  ${nom.padEnd(12)} ${String(c).padStart(3)} cartes · ${String(b).padStart(3)} brèves · ${d} dév. · ${i} images`);
  if(c===0) ko('structure',`${nom} : aucune carte`);
}
// ordre : les développés doivent être en tête de chaque section
for(const s of sections){
  const nom=deTag((s.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)||[])[1]||'?');
  const arts=[...s.matchAll(/<article class="carte">([\s\S]*?)<\/article>/g)].map(m=>m[1].includes('class="dev"'));
  const dernierDev=arts.lastIndexOf(true), premierSans=arts.indexOf(false);
  if(dernierDev>-1 && premierSans>-1 && premierSans<dernierDev) ko('structure',`${nom} : un article développé se trouve après un non-développé`);
}
// doublons
const liens=[...html.matchAll(/class="lien" href="([^"]+)"/g)].map(m=>m[1]);
const dbl=liens.filter((l,i)=>liens.indexOf(l)!==i);
if(dbl.length) ko('structure',`${dbl.length} article(s) en double dans les cartes`);
if(imgs.length<cartes*0.5) att('structure',`${imgs.length} images pour ${cartes} cartes (Libération et Le Parisien en fournissent peu)`);

// FOND
const titres=[...html.matchAll(/class="carte-titre">([\s\S]*?)<\/h3>/g)].map(m=>deTag(m[1]));
const brevesT=[...html.matchAll(/class="breve-titre"[^>]*>([\s\S]*?)<\/a>/g)].map(m=>deTag(m[1]));
const direct=[...titres,...brevesT].filter(t=>/^EN DIRECT|^EN IMAGES|^\s*DIRECT/i.test(t));
if(direct.length) att('fond',`${direct.length} article(s) « EN DIRECT » (contenu mouvant)`);
const sansResume=cartes-[...html.matchAll(/class="carte-resume"/g)].length;
if(sansResume>0) att('fond',`${sansResume} carte(s) sans résumé`);
const brevesSansR=(html.match(/class="breve"/g)||[]).length-(html.match(/class="breve-resume"/g)||[]).length;
if(brevesSansR>0) att('fond',`${brevesSansR} brève(s) réduites au seul titre`);
const coupes=[...html.matchAll(/class="dev-texte">([\s\S]*?)<\/p>/g)].map(m=>deTag(m[1])).filter(t=>!/[.!?…»"']$/.test(t));
if(coupes.length) att('fond',`${coupes.length} paragraphe(s) de développement sans ponctuation finale`);

// RAPPROCHEMENTS
const D=diag.detailDeveloppements||[];
console.log(`\nRAPPROCHEMENTS  ${D.length} blocs · scores ${Math.min(...D.map(d=>d.score)).toFixed(2)}–${Math.max(...D.map(d=>d.score)).toFixed(2)}`);
const parQ={}; D.forEach(d=>parQ[d.quotidien]=(parQ[d.quotidien]||0)+1);
console.log('  ', Object.entries(parQ).map(([k,v])=>`${k} ${v}`).join(' · '));
const absents=['Le Monde','Le Figaro','Le Parisien','Libération','La Croix'].filter(q=>!parQ[q]);
if(absents.length) att('rapprochement',`aucun développement pour : ${absents.join(', ')}`);
const unPar=D.filter(d=>d.paragraphes<2);
if(unPar.length) att('rapprochement',`${unPar.length} bloc(s) à un seul paragraphe`);

// CHIFFRES
console.log(`\nCHIFFRES  ${diag.totalChiffresDetectes} détectés · ${diag.articlesAvecChiffres} articles concernés`);
const marks=[...html.matchAll(/class="chiffre chiffre--(\w+)">([\s\S]*?)<\/mark>/g)].map(m=>({t:m[1],v:deTag(m[2])}));
const parType={}; marks.forEach(m=>parType[m.t]=(parType[m.t]||0)+1);
console.log('  ', Object.entries(parType).map(([k,v])=>`${k} ${v}`).join(' · '));
const suspects=[...new Set(marks.filter(m=>/^\d{1,2}$/.test(m.v.trim())).map(m=>m.v))];
if(suspects.length) att('chiffres',`nombres nus surlignés : ${suspects.slice(0,6).join(', ')}`);

console.log('\n──────── CONSTATS ────────');
if(!P.length) console.log('  aucun problème détecté');
P.forEach(([s,c,m])=>console.log(` ${s} [${c}] ${m}`));
