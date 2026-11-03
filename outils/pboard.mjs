// La page unique « pboard » : les routes JSON /api/pboard/<onglet>, servies par bureau.mjs.
// Tout est en lecture seule : ni le coffre ~/pboard, ni le contexte de Sillage, ni l'index de Glose ne sont écrits.
// Onglets : aujourdhui, projets, projet (?p=slug), sessions, apps, notes (?q=mots).
// Sans dépendance npm : la lecture du coffre passe par ~/pboard/outils/lib/coffre.mjs (importé à la demande).
// Chaque route rend un objet JSON ; une donnée absente est dite dans `absence`, jamais inventée.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const DEPOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAISON = os.homedir();
const COFFRE = path.join(MAISON, 'pboard');
const SILLAGE = path.join(MAISON, 'Library/Application Support/Sillage/contexte');
const GLOSE = path.join(MAISON, 'Library/Application Support/Glose/index.sqlite');
const JOURNAL = path.join(MAISON, 'Journal');
// Le dépôt des apps (dossier « …-apps » du home, avec public/apps.json), ou ORCH_APPS_JSON.
const APPS_JSON = process.env.ORCH_APPS_JSON || (() => { try { return fs.readdirSync(MAISON).filter((n) => /-apps$/.test(n)).map((n) => path.join(MAISON, n, 'public/apps.json')).find((f) => fs.existsSync(f)) || ''; } catch { return ''; } })();
const SITE = 'https://apps.srv875929.hstgr.cloud';
const CACHE = path.join(MAISON, '.cache/orchestration');
const F_BILAN = path.join(CACHE, 'pboard-bilan.json');
const VALIDITE_BILAN = 6 * 36e5;   // le bilan sur 30 jours coûte ~25 s : recalculé au plus toutes les 6 h

export const ONGLETS = ['aujourdhui', 'projets', 'projet', 'sessions', 'apps', 'notes'];

let _coffre = null;
const coffre = async () => _coffre ??= await import(pathToFileURL(path.join(COFFRE, 'outils/lib/coffre.mjs')).href);
const lire = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const lien = (chemin) => `obsidian://open?path=${encodeURIComponent(chemin)}`;
const absent = (texte) => ({ absence: texte });

// ── Un Markdown simple rendu en HTML : titres, listes, cases, gras, code, liens. Tout est échappé d'abord.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function enLigne(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[\[([^\]|#]+)(?:[#|]([^\]]*))?\]\]/g, (_, n, a) => `<span class="wiki">${a || n}</span>`)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
export function mdVersHtml(md) {
  const sortie = []; let liste = false, code = false;
  const fermer = () => { if (liste) { sortie.push('</ul>'); liste = false; } };
  const sans = md.replace(/^---\n[\s\S]*?\n---\n/, '');
  for (const l of sans.split(/\r?\n/)) {
    if (/^```/.test(l)) { fermer(); sortie.push(code ? '</pre>' : '<pre>'); code = !code; continue; }
    if (code) { sortie.push(esc(l) + '\n'); continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { fermer(); sortie.push(`<h${m[1].length + 1}>${enLigne(m[2])}</h${m[1].length + 1}>`); }
    else if ((m = /^\s*[-*]\s+\[( |x|X|\/|-)\]\s+(.*)$/.exec(l))) { if (!liste) { sortie.push('<ul class="taches">'); liste = true; } sortie.push(`<li class="${m[1] === ' ' ? 'ouv' : m[1] === '/' ? 'cours' : 'fait'}">${enLigne(m[2])}</li>`); }
    else if ((m = /^\s*[-*]\s+(.*)$/.exec(l))) { if (!liste) { sortie.push('<ul>'); liste = true; } sortie.push(`<li>${enLigne(m[1])}</li>`); }
    else if (l.trim() === '') fermer();
    else { fermer(); sortie.push(`<p>${enLigne(l)}</p>`); }
  }
  fermer(); if (code) sortie.push('</pre>');
  return sortie.join('\n');
}

// ── Aujourd'hui
const hhmm = (iso) => iso.slice(11, 16);
const minutes = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
function unionMinutes(blocs) {
  const I = blocs.map((b) => [Date.parse(b.debut), Date.parse(b.fin)]).sort((a, b) => a[0] - b[0]);
  let total = 0, fin = -Infinity;
  for (const [a, b] of I) { total += Math.max(0, b - Math.max(a, fin)); fin = Math.max(fin, b); }
  return Math.round(total / 60000);
}
function sillageDuJour(jour) {
  const f = path.join(SILLAGE, `${jour}.json`);
  const brut = lire(f);
  if (brut === null) return absent(`Pas de fichier Sillage pour le ${jour} (${f}).`);
  let d; try { d = JSON.parse(brut); } catch { return absent(`Le fichier Sillage du ${jour} n'est pas lisible.`); }
  if (d.version !== 1) return absent(`Le fichier Sillage du ${jour} est au format ${d.version}, seul le format 1 est lu.`);
  const noms = Object.fromEntries((d.projets || []).map((p) => [p.slug, p.nom]));
  const parProjet = {};
  for (const b of d.blocs || []) { const p = b.projet || 'sans projet'; (parProjet[p] ??= { slug: p, nom: noms[p] || p, minutes: 0, blocs: [] }); parProjet[p].minutes += minutes(b.debut, b.fin); parProjet[p].blocs.push({ debut: hhmm(b.debut), fin: hhmm(b.fin), sujet: b.sujet || null }); }
  return {
    fichier: f, lien: lien(f), genere: d.genere,
    reunions: (d.reunions || []).map((r) => ({ debut: hhmm(r.debut), fin: hhmm(r.fin), titre: r.titre, projet: r.projet || null, source: r.source })),
    projets: Object.values(parProjet).sort((a, b) => b.minutes - a.minutes),
    notes: d.notes || [],
    totalMinutes: unionMinutes(d.blocs || []),   // des sessions en parallèle se chevauchent : le total est l'union des blocs, pas la somme
  };
}
const noteHtml = (f) => { const t = lire(f); return t === null ? null : { fichier: f, lien: lien(f), html: mdVersHtml(t) }; };

export async function aujourdhui() {
  const C = await coffre();
  const jour = C.aujourdhui(); const hier = C.decalerJours(jour, -1);
  const page = noteHtml(path.join(COFFRE, 'Aujourd-hui.md'));
  const matin = noteHtml(path.join(JOURNAL, `${jour}-matin.md`)); const soir = noteHtml(path.join(JOURNAL, `${jour}-soir.md`));
  const bilan = C.bilanDu(hier);
  return {
    jour, hier,
    page: page || absent('~/pboard/Aujourd-hui.md est absent.'),
    sillage: sillageDuJour(jour),
    journal: { matin: matin || absent(`Pas de journal du matin pour le ${jour}.`), soir: soir || absent(`Pas de journal du soir pour le ${jour} (il s'écrit le soir).`) },
    bilanHier: bilan ? { date: hier, ligne: bilan } : absent(hier < C.MISE_EN_SERVICE ? 'Avant la mise en service du coffre.' : `Pas de bilan enregistré pour le ${hier}.`),
  };
}

// ── Projets
export async function projets() {
  const C = await coffre(); const jour = C.aujourdhui();
  const taches = C.listerTaches();
  const lignes = C.listerProjets().map((p) => {
    const ouv = taches.filter((t) => t.projet === p.slug && (t.etat === 'a-faire' || t.etat === 'en-cours'));
    const bloq = ouv.filter((t) => t.bloquee); const retard = ouv.filter((t) => t.echeance && t.echeance < jour);
    const point = C.notesDatees(p.chemins.points)[0];
    return { slug: p.slug, nom: p.nom, phase: p.fiche.phase || null, statut: p.fiche.statut || null, couleur: p.fiche.couleur || null,
      ouvertes: ouv.length, bloquees: bloq.length, enRetard: retard.length,
      dernierPoint: point ? { date: point.date, lien: lien(point.chemin) } : null, lien: lien(p.cheminFiche) };
  });
  return { jour, projets: lignes };
}
export async function projet(slug) {
  const C = await coffre(); const jour = C.aujourdhui();
  const p = C.listerProjets().find((x) => x.slug === String(slug).toLowerCase());
  if (!p) return absent(`Aucun projet « ${slug} » dans le coffre.`);
  const fiche = noteHtml(p.cheminFiche); const etat = noteHtml(p.chemins.etat);
  const taches = fs.existsSync(p.chemins.taches) ? C.parserTaches(C.lireNote(p.chemins.taches).brut, p.chemins.taches, p.slug) : [];
  const ouv = taches.filter((t) => t.etat === 'a-faire' || t.etat === 'en-cours');
  const decisions = fs.existsSync(p.chemins.decisions)
    ? C.listerFichiers(p.chemins.decisions).map((f) => ({ f, m: fs.statSync(f).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, 8)
      .map(({ f }) => ({ titre: path.basename(f, '.md').replace(/-/g, ' '), lien: lien(f) })) : [];
  return {
    slug: p.slug, nom: p.nom, phase: p.fiche.phase || null, statut: p.fiche.statut || null, jour,
    fiche: fiche || absent('Fiche absente.'), etat: etat || absent(`Pas de ${path.basename(p.chemins.etat)}.`),
    taches: ouv.map((t) => ({ texte: t.texte, etat: t.etat, bloquee: t.bloquee, echeance: t.echeance, enRetard: !!(t.echeance && t.echeance < jour) })),
    fichierTaches: fs.existsSync(p.chemins.taches) ? lien(p.chemins.taches) : null,
    decisions: decisions.length ? decisions : absent('Aucune décision écrite pour ce projet.'),
  };
}

// ── Sessions : le bilan sur 30 jours (≈ 25 s à calculer) gardé 6 h sur disque ; le bureau est intégré par la page.
let enCalcul = null;
export async function sessions({ forcer = false } = {}) {
  let cache = null; try { cache = JSON.parse(fs.readFileSync(F_BILAN, 'utf8')); } catch {}
  if (cache && !forcer && Date.now() - cache.calcule < VALIDITE_BILAN) return { bilan: cache.bilan, calcule: new Date(cache.calcule).toISOString(), cache: true };
  enCalcul ??= exec(process.execPath, [path.join(DEPOT, 'outils/etat.mjs'), 'bilan', '30', '--json'], { maxBuffer: 1e7, timeout: 120000 })
    .then(({ stdout }) => { const bilan = JSON.parse(stdout); fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(F_BILAN, JSON.stringify({ calcule: Date.now(), bilan })); return bilan; })
    .finally(() => { enCalcul = null; });
  try { const bilan = await enCalcul; return { bilan, calcule: new Date().toISOString(), cache: false }; }
  catch (e) { return cache ? { bilan: cache.bilan, calcule: new Date(cache.calcule).toISOString(), cache: true, perime: true } : absent(`Le bilan sur 30 jours n'a pas pu être calculé : ${String(e.message).slice(0, 160)}`); }
}

// ── Apps : publiées (apps.json) et installées (Info.plist des .app)
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function installees() {
  const out = {};
  for (const d of ['/Applications', path.join(MAISON, 'Applications')]) {
    let L; try { L = fs.readdirSync(d); } catch { continue; }
    for (const f of L.filter((x) => x.endsWith('.app'))) {
      try { out[norm(f.slice(0, -4))] ??= { version: execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(d, f, 'Contents/Info.plist')], { encoding: 'utf8', timeout: 3000 }).trim(), chemin: path.join(d, f) }; } catch {}
    }
  }
  return out;
}
export function apps() {
  const brut = lire(APPS_JSON);
  if (brut === null) return absent(`Pas de catalogue des apps (${APPS_JSON}).`);
  const inst = installees();
  const L = JSON.parse(brut).apps.map((a) => {
    const i = inst[norm(a.nom)] || inst[norm(a.id)] || null;
    const ordre = i ? i.version.localeCompare(a.version, undefined, { numeric: true }) : null;
    return { id: a.id, nom: a.nom, phrase: a.phrase, couleur: a.couleur, publiee: a.version, installee: i ? i.version : null, chemin: i ? i.chemin : null,
      etat: !i ? 'absente' : ordre < 0 ? 'maj' : ordre > 0 ? 'avance' : 'jour', page: `${SITE}/${a.page}` };
  });
  return { apps: L, installees: L.filter((x) => x.installee).length, aMettreAJour: L.filter((x) => x.etat === 'maj').map((x) => x.nom) };
}

// ── Notes : l'index de Glose en lecture seule, sinon rg
async function viaGlose(q) {
  if (!fs.existsSync(GLOSE)) throw new Error('Glose absent');
  // MATCH ? : sqlite3 en ligne de commande n'a pas de paramètre ; la requête est donc passée en littéral FTS5 entre guillemets.
  const mots = q.split(/\s+/).filter(Boolean).map((m) => `"${m.replace(/"/g, '""')}"`).join(' ');
  const sql = `SELECT n.chemin, n.titre FROM fts JOIN notes n ON n.id = fts.rowid WHERE fts MATCH '${mots.replace(/'/g, "''")}' ORDER BY bm25(fts) LIMIT 20`;
  const { stdout } = await exec('sqlite3', ['-readonly', '-json', GLOSE, sql], { timeout: 8000 });
  return (stdout.trim() ? JSON.parse(stdout) : []).map((r) => ({ chemin: r.chemin, titre: r.titre }));
}
// `--` : une requête qui commence par « - » est un motif, pas un drapeau de rg.
export const argsRg = (q) => ['-il', '--glob', '*.md', '--max-count', '1', '-m', '1', '--', q, COFFRE];
async function viaRg(q) {
  const { stdout } = await exec('rg', argsRg(q), { timeout: 8000, maxBuffer: 1e7 }).catch((e) => ({ stdout: e.code === 1 ? '' : (() => { throw e; })() }));
  return stdout.split('\n').filter(Boolean).slice(0, 20).map((f) => ({ chemin: f, titre: path.basename(f, '.md').replace(/-/g, ' ') }));
}
export async function notes(q) {
  q = String(q || '').trim();
  if (!q) return { requete: '', source: null, resultats: [], consigne: 'Tapez un mot pour chercher dans tout le coffre.' };
  let source = 'glose', R;
  try { R = await viaGlose(q); } catch { try { source = 'rg'; R = await viaRg(q); } catch (e) { return absent(`La recherche a échoué (Glose et rg) : ${String(e.message).slice(0, 120)}`); } }
  const abs = (c) => path.isAbsolute(c) ? c : path.join(COFFRE, c);
  return { requete: q, source, resultats: R.map((r) => ({ titre: r.titre, chemin: abs(r.chemin), lien: lien(abs(r.chemin)) })) };
}

// ── L'aiguillage : /api/pboard/<onglet>
export async function route(onglet, q = {}) {
  switch (onglet) {
    case 'aujourdhui': return aujourdhui();
    case 'projets': return projets();
    case 'projet': return projet(q.p);
    case 'sessions': return sessions({ forcer: q.forcer === '1' });
    case 'apps': return apps();
    case 'notes': return notes(q.q);
    default: return null;
  }
}
