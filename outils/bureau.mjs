#!/usr/bin/env node
// Le bureau de l'orchestration : ce qu'orchestre une session, ses sous-sessions et ses agents, sur une page locale.
// Sert `/sessiondesk`. Tout ce qui se compte se compte ici, sans modèle : la famille de sessions vient de
// `ranger.mjs liste --json` (magasin de l'app, transcriptions, `ps`), les agents de `subagents/agent-*.meta.json`
// et de leur transcription. Seul le récit « voir plus » passe par Haiku 5.5 en effort faible, sur un extrait court,
// mis en cache par empreinte de l'extrait : un état inchangé ne coûte plus rien.
//
// Usage : node outils/bureau.mjs ouvrir [--dossier chemin] [--session id] [--sans-ouvrir]
//         node outils/bureau.mjs donnees [--session id | --cli uuid] [--dossier chemin]
//         node outils/bureau.mjs environnements
//         node outils/bureau.mjs serveur
// Écrit : ~/.cache/orchestration/bureau-cache.json (agents, clé taille:mtime), bureau-resumes.json (récits),
//         bureau.log. Variables : ORCH_BUREAU_PORT, ORCH_CLAUDE (commande claude, pour les tests).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as pboard from './pboard.mjs';
import { famille, cout, compteur, PRIX } from './extraire.mjs';

const DEPOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAISON = os.homedir();
const MAGASIN = path.join(MAISON, 'Library/Application Support/Claude/claude-code-sessions');
const PROJETS = path.join(MAISON, '.claude/projects');
const CACHE = path.join(MAISON, '.cache/orchestration');
const F_AGENTS = path.join(CACHE, 'bureau-cache.json');
const F_RESUMES = path.join(CACHE, 'bureau-resumes.json');
const PORT = Number(process.env.ORCH_BUREAU_PORT || 4517);
// Protection contre le DNS rebinding (03/11/2026) : une page web dont le nom bascule sur 127.0.0.1 pouvait lire le coffre
// (/api/pboard) et déclencher des appels claude. Seuls ces trois hôtes, avec le port du serveur, sont servis.
export const hoteAutorise = (host, port = PORT) => [`127.0.0.1:${port}`, `localhost:${port}`, `pboard.localhost:${port}`].includes(String(host || '').toLowerCase());
const CLAUDE = process.env.ORCH_CLAUDE || 'claude';
const VERSION_CACHE = 3;   // 3 : coût au modèle exact, sortie complète (02/11/2026)
// L'empreinte du code servi : un serveur resté sur une ancienne version est remplacé à l'ouverture suivante.
const CODE = ['bureau.mjs', 'bureau.html', 'pboard.mjs', 'pboard.html'].map((f) => Math.floor(fs.statSync(path.join(DEPOT, 'outils', f)).mtimeMs)).join(':');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const drapeau = (n) => { const i = args.indexOf(n); if (i >= 0) args.splice(i, 1); return i >= 0; };

const encoder = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
const lireJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const ecrireJSON = (f, v) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = `${f}.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); } catch {} };
const projetDe = (cwd = '') => path.basename(cwd.replace(/\/\.claude\/worktrees\/.*$/, '')) || '—';
const projetTerminal = (d) => d.replace(encoder(MAISON), '').replace(/^-/, '') || '~';
const court = (t = '', n = 400) => { const s = String(t).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const texteDe = (c) => Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text || '').join('\n') : String(c || '');

// ── Le magasin de l'app (comme ranger.mjs) : un JSON par session.
export function magasin() {
  const S = new Map();
  const marcher = (d, n) => { if (n > 3 || !fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d)) { const p = path.join(d, f);
      if (f.startsWith('local_') && f.endsWith('.json')) { const j = lireJSON(p); if (j?.sessionId) S.set(j.sessionId, j); }
      else if (!f.includes('.') && fs.statSync(p).isDirectory()) marcher(p, n + 1); } };
  marcher(MAGASIN, 0);
  return S;
}

// ── Où vit la transcription d'une session CLI : <projets>/<dossier encodé>/<uuid>.jsonl, sinon on cherche.
const ouTranscription = new Map();
function dossierProjet(cli, cwds = []) {
  if (!cli) return null;
  if (ouTranscription.has(cli)) return ouTranscription.get(cli);
  let r = null;
  for (const c of cwds.filter(Boolean)) { const d = path.join(PROJETS, encoder(c)); if (fs.existsSync(path.join(d, `${cli}.jsonl`)) || fs.existsSync(path.join(d, cli))) { r = d; break; } }
  if (!r && fs.existsSync(PROJETS)) for (const d of fs.readdirSync(PROJETS)) { const p = path.join(PROJETS, d); if (fs.existsSync(path.join(p, `${cli}.jsonl`))) { r = p; break; } }
  ouTranscription.set(cli, r);
  return r;
}
const dossierAgents = (cli, cwds) => { const d = dossierProjet(cli, cwds); return d ? path.join(d, cli, 'subagents') : null; };
const fichiersAgents = (dir) => dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^agent-.+\.jsonl$/.test(f)) : [];

// ── Un agent : sa fiche (.meta.json) et sa transcription. Résumé sérialisable, en cache par taille:mtime.
let cacheA = null, cacheModifie = false;
function chargerCacheA() { if (cacheA) return; const c = lireJSON(F_AGENTS, {}); cacheA = c.v === VERSION_CACHE ? c.e : {}; }
function sauverCacheA() { if (cacheModifie) ecrireJSON(F_AGENTS, { v: VERSION_CACHE, e: cacheA }); cacheModifie = false; }

export function lireAgent(fichier) {
  chargerCacheA();
  const st = fs.statSync(fichier), cle = `${st.size}:${Math.floor(st.mtimeMs)}`;
  const meta = lireJSON(fichier.replace(/\.jsonl$/, '.meta.json'), {});
  if (cacheA[fichier]?.cle === cle && cacheA[fichier].finished === meta.finished) return { ...cacheA[fichier].r, mtime: st.mtimeMs };
  const r = { id: path.basename(fichier, '.jsonl').replace(/^agent-/, ''), description: meta.description || '', type: meta.agentType || '',
    modele: meta.model || '', effort: meta.effort || '', fond: meta.requestShape === 'background', fini: meta.finished,
    cout: 0, ctx: 0, jetons: 0, tours: 0, outils: 0, debut: '', fin: '', consigne: '', dernier: '', modeleReel: '', arret: '' };
  const compter = compteur();
  for (const l of fs.readFileSync(fichier, 'utf8').split('\n')) {
    if (!l || l.length > 400 * 1024) continue;
    let ev; try { ev = JSON.parse(l); } catch { continue; }
    const m = ev.message; if (!m) continue;
    if (ev.timestamp) { r.debut ||= ev.timestamp; r.fin = ev.timestamp; }
    if (ev.type === 'user') { if (!r.consigne) { const t = typeof m.content === 'string' ? m.content : texteDe(m.content); if (t) r.consigne = court(t, 900); } continue; }
    if (ev.type !== 'assistant') continue;
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c.type === 'tool_use') { r.outils++; if (c.name === 'SubagentHandback' && c.input?.message) r.dernier = c.input.message; }   // le rendu passe par cet outil
      if (c.type === 'text' && c.text?.trim()) r.dernier = c.text;
    }
    if (m.stop_reason) r.arret = m.stop_reason;
    if (!m.usage) continue;
    const u = m.usage; const k = compter(m.id, m.model, u); if (!k) continue;
    r.cout += k.cout; if (!k.nouveau) { r.jetons += k.sortie; continue; }
    r.tours++; r.modeleReel = m.model || r.modeleReel;
    r.ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    r.jetons += r.ctx + (u.output_tokens || 0);
  }
  r.dernier = r.dernier.slice(-2400);
  if (r.fini === undefined) r.fini = r.arret === 'end_turn';
  cacheA[fichier] = { cle, finished: meta.finished, r }; cacheModifie = true;
  return { ...r, mtime: st.mtimeMs };
}

// État d'un agent : fini, ou travaille (sa session vit et il a écrit il y a moins de 5 min), sinon interrompu.
function etatAgent(a, vivant, maintenant) {
  if (a.fini) return 'finie';
  if (vivant && maintenant - a.mtime < 5 * 60000) return 'travaille';
  return 'interrompue';
}
// Bloquée ou interrompue depuis plus de 2 jours, processus fermé : elle ne réclame plus d'action, elle est en suspens.
const SUSPENS = 48 * 36e5;
const suspens = (etat, vivant, inactif) => (etat === 'attend' || etat === 'interrompue') && !vivant && inactif > SUSPENS;
function agentsDe(cli, cwds, vivant, maintenant, proprietaire) {
  const dir = dossierAgents(cli, cwds);
  return fichiersAgents(dir).map((f) => { const a = lireAgent(path.join(dir, f));
    const { consigne, dernier, mtime, ...reste } = a;
    return { ...reste, genre: 'agent', cle: `a:${a.id}`, proprietaire, etat: (() => { const e = etatAgent(a, vivant, maintenant); return suspens(e, vivant, maintenant - a.mtime) ? 'en suspens' : e; })(), titre: a.description || a.type || 'agent', modele: a.modeleReel || a.modele, _consigne: consigne, _dernier: dernier };
  }).sort((a, b) => (a.debut || '').localeCompare(b.debut || ''));
}

// ── La famille de sessions : on réutilise ranger.mjs (même tri, mêmes états, même cache).
function famillePar(session, dossier) {
  const a = [path.join(DEPOT, 'outils/ranger.mjs'), 'liste', '--json', '--avec-archivees', '--dossier', dossier || MAISON];
  if (session) a.push('--session', session);
  try { return JSON.parse(execFileSync(process.execPath, a, { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] })); }
  catch { return null; }
}

// État d'une session qui n'est pas celle qui regarde (ranger marque toujours « travaille » la session donnée).
function etatAutre(x, j, maintenant) {
  const p = j?.postTurnSummary || {};
  if (x.vivant && x.inactif < 3 * 60000) return 'travaille';
  if (p.status_category === 'blocked' || p.needs_action) return 'attend';
  if (p.status_category === 'completed') return 'finie';
  if (p.status_category === 'review_ready') return 'à relire';
  return x.inactif > 30 * 60000 ? 'dort' : 'au repos';
}

// ── Les générations d'une orchestration. Une orchestratrice trop lourde se relance dans une session neuve :
// c'est la même orchestration, génération suivante. Liens déterministes, lus dans le magasin et le premier message :
//  1. une fille dont le titre porte une marque de relance (« (reprise) », « (4) », « reprise du … ») et ressemble
//     à celui de sa mère ;
//  2. une fille dont le brief dit la passation (« passe la main », note `reprise-orchestration-…`, note commune) et
//     dont le titre ressemble à celui de sa mère, ou qui est, comme elle, une orchestration ;
//  3. une session sans mère dont le brief reprend une orchestration : la dernière orchestration du même dossier,
//     finie avant elle, dans les 72 h, et pas déjà reprise.
// Une fille de travail relancée (même titre + marque ou brief de reprise) est la suite de sa devancière.
const VIDES = new Set(['du', 'de', 'la', 'le', 'les', 'des', 'et', 'au', 'aux', 'en', 'pour', 'sur', 'un', 'une', 'puis', 'avec']);
const normTitre = (t = '') => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\((?:reprise|suite|relance)[^)]*\)|\(\d+\)|\breprise du [^:,]*|\breprise\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const mots = (t) => new Set(normTitre(t).split(' ').filter((m) => m.length > 1 && !VIDES.has(m)));
export const proche = (a, b) => { const A = mots(a), B = mots(b); if (!A.size || !B.size) return 0; let n = 0; for (const m of A) if (B.has(m)) n++; return n / (A.size + B.size - n); };
const MARQUE = /\((?:reprise|suite|relance)[^)]*\)|\(\d+\)\s*$|\breprise du\b/i;
const PASSE = /passe la main|previous orchestration|orchestration pr[ée]c[ée]dente|ancienne (?:session d[’']orchestration|orchestration|orchestratrice)|repren\w* (?:l[’']|la |cette )?orchestration|reprise-orchestration|reprise-commune|hand.?off/i;
const REPRISE = /note de reprise|reprise|repren|relanc/i;
const ORCH = /orchestr/i;

// Le premier message humain d'une transcription (le brief), mis en cache : il ne change jamais.
function brief(j) {
  if (!j?.cliSessionId) return '';
  chargerCacheA();
  const cle = `brief:${j.cliSessionId}`; if (cacheA[cle] != null) return cacheA[cle];
  const d = dossierProjet(j.cliSessionId, [j.cwd, j.originCwd]); const f = d && path.join(d, `${j.cliSessionId}.jsonl`);
  let t = '';
  if (f && fs.existsSync(f)) {
    const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(Math.min(256 * 1024, fs.statSync(f).size)); fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd);
    for (const l of b.toString('utf8').split('\n')) { let ev; try { ev = JSON.parse(l); } catch { continue; }
      if (ev.type !== 'user' || ev.isMeta) continue;
      const c = ev.message?.content; const p = (typeof c === 'string' ? c : texteDe(c)).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
      if (p && !p.startsWith('<')) { t = p.slice(0, 2500); break; } }
  }
  cacheA[cle] = t; cacheModifie = true;
  return t;
}
export function estRelance(enfant, mere, texte) {
  const p = proche(enfant.title, mere.title);
  if (MARQUE.test(enfant.title || '') && p >= 0.4) return 'titre';
  if (PASSE.test(texte) && (p >= 0.4 || (ORCH.test(enfant.title || '') && ORCH.test(mere.title || '')))) return 'passation';
  return null;
}
// Le graphe des générations sur tout le magasin : suivant[id] = génération suivante, precedent[id] = la précédente.
export function generations(S) {
  const suivant = new Map(), precedent = new Map(), raison = new Map();
  const lier = (a, b, r) => { if (suivant.has(a) || precedent.has(b)) return; suivant.set(a, b); precedent.set(b, a); raison.set(b, r); };
  const parCreation = [...S.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  for (const j of parCreation) {
    const m = S.get(j.spawnedFrom?.sessionId); if (!m) continue;
    const pre = MARQUE.test(j.title || '') || proche(j.title, m.title) >= 0.4 || (ORCH.test(j.title || '') && ORCH.test(m.title || ''));
    if (!pre) continue;   // le brief n'est lu que pour les candidates
    const r = estRelance(j, m, brief(j)); if (r) lier(m.sessionId, j.sessionId, r);
  }
  for (const j of parCreation) {
    if (j.spawnedFrom?.sessionId || precedent.has(j.sessionId) || !ORCH.test(j.title || '')) continue;
    const t = brief(j); if (!/repren\w* (?:l[’']|la )?orchestration|passe la main|note de reprise/i.test(t)) continue;
    const avant = parCreation.filter((x) => x.sessionId !== j.sessionId && x.cwd === j.cwd && ORCH.test(x.title || '') && !suivant.has(x.sessionId)
      && (x.lastActivityAt || 0) <= (j.createdAt || 0) + 60000 && (j.createdAt || 0) - (x.lastActivityAt || 0) < 72 * 36e5);
    const x = avant.sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))[0];
    if (x) lier(x.sessionId, j.sessionId, 'même dossier');
  }
  return { suivant, precedent, raison };
}
const chaineDe = (id, G) => { let a = id; const vus = new Set([a]); while (G.precedent.has(a) && !vus.has(G.precedent.get(a))) { a = G.precedent.get(a); vus.add(a); }
  const L = [a]; while (G.suivant.has(L.at(-1)) && !L.includes(G.suivant.get(L.at(-1)))) L.push(G.suivant.get(L.at(-1))); return L; };

// ── Les données d'un environnement : toute la lignée de l'orchestration (générations 1 à n), leurs filles et
// les agents de chacune. Le chef est la dernière génération.
export function donnees({ session, cli, dossier, moi } = {}) {
  const maintenant = Date.now();
  if (cli && !session) return donneesCli(cli, maintenant);
  const S = magasin();
  const courante = moi || process.env.CLAUDE_CODE_HOST_SESSION_ID || '';
  // La session de départ : celle donnée, sinon la courante, sinon la plus récente du dossier (comme ranger.mjs).
  let depart = session || (S.has(courante) ? courante : null);
  depart ||= [...S.values()].filter((j) => j.cwd === (dossier || process.cwd()) && !j.isArchived).sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))[0]?.sessionId;
  if (!depart) return { erreur: 'Aucune session de l’app trouvée pour ce dossier : `/sessiondesk` lit le magasin de l’app de bureau Claude (onglet Code).' };
  const G = generations(S);
  const chaine = S.has(depart) ? chaineDe(depart, G) : [depart];
  // ranger.mjs, une fois par famille touchée par la lignée (en général une seule).
  const racineDe = (id) => { let a = id; const v = new Set(); while (S.get(a)?.spawnedFrom?.sessionId && S.has(S.get(a).spawnedFrom.sessionId) && !v.has(a)) { v.add(a); a = S.get(a).spawnedFrom.sessionId; } return a; };
  const familles = [...new Set(chaine.map(racineDe))];
  const L = new Map(); let rMoi = null;
  for (const r of familles) {
    const membre = chaine.find((c) => racineDe(c) === r);
    const R = famillePar(racineDe(courante) === r && S.has(courante) ? courante : membre, dossier);
    if (!R?.L) continue; rMoi ||= R.moi;
    for (const x of R.L) if (!L.has(x.id)) L.set(x.id, { ...x, _rangerMoi: R.moi });
  }
  if (!L.size) return { erreur: 'Aucune session de l’app trouvée pour ce dossier.' };
  const fiche = (x, generation, profondeur, role) => {
    const j = S.get(x.id) || {};
    let etat = x.id === courante ? 'travaille' : x.archivee ? 'rangée' : x.id === x._rangerMoi ? etatAutre(x, j, maintenant) : x.etat;
    if (suspens(etat, x.vivant, x.inactif)) etat = 'en suspens';
    const p = j.postTurnSummary || {};
    return { genre: 'session', role, cle: `s:${x.id}`, id: x.id, titre: x.titre, etat, archivee: x.archivee, generation, profondeur,
      parent: x.parent, modele: x.modele || j.model || '', effort: j.effort || '', cout: x.cout, coutReleve: x.coutReleve ?? null, ctx: x.ctx, jetons: x.jetons, tours: x.tours,
      debut: x.creee ? new Date(x.creee).toISOString() : '', fin: new Date(maintenant - (x.inactif || 0)).toISOString(), rss: x.rss,
      plan: x.plan || [], commits: (x.commits || []).map((c) => c.msg), nonCommite: (x.nonCommite || []).length,
      question: x.question || (etat === 'attend' ? p.needs_action || p.status_detail || x.ask || '' : ''),
      projet: projetDe(x.cwd), cwd: x.cwd, cli: x.cli, vivant: x.vivant, surveille: x.surveille || [], lien: G.raison.get(x.id) || '',
      _demande: court(x.demande || brief(j), 900), _rapport: court(x.rapport || x.recap, 900), _ask: x.ask || '' };
  };
  // Chaque génération : le chef k et ses descendantes, sans descendre dans la génération k+1.
  const enfants = new Map(); for (const x of L.values()) if (x.parent) enfants.set(x.parent, [...(enfants.get(x.parent) || []), x]);
  const lignee = [], sessions = [];
  chaine.forEach((g, i) => {
    const x = L.get(g); if (!x) return;
    lignee.push(fiche(x, i + 1, 0, 'chef'));
    const pile = (enfants.get(g) || []).map((y) => [y, 1]);
    while (pile.length) { const [y, d] = pile.shift(); if (chaine.includes(y.id)) continue;
      sessions.push(fiche(y, i + 1, d, 'fille')); for (const z of enfants.get(y.id) || []) pile.push([z, d + 1]); }
  });
  // Une fille relancée (même titre, marque ou brief de reprise) est la suite de sa devancière : un seul poste.
  const triees = [...sessions].sort((a, b) => (a.debut || '').localeCompare(b.debut || ''));
  for (const w of triees) {
    const t = w.titre;
    if (!MARQUE.test(t) && !REPRISE.test(w._demande.slice(0, 600))) continue;
    const avant = triees.filter((v) => v !== w && !v.suite && (v.debut || '') < (w.debut || '') && v.generation <= w.generation && proche(v.titre, t) >= 0.6);
    const v = avant.sort((a, b) => proche(b.titre, t) - proche(a.titre, t) || (b.debut || '').localeCompare(a.debut || ''))[0];
    if (v) { v.suite = w.id; w.devanciere = v.id; }
  }
  for (const w of sessions) { let n = 1, v = w; while (v.devanciere) { n++; v = sessions.find((y) => y.id === v.devanciere); if (!v) break; } w.relances = n - 1; }
  const tous = [...lignee, ...sessions];
  const agents = tous.flatMap((s) => agentsDe(s.cli, [s.cwd, S.get(s.id)?.originCwd], s.vivant || s.id === courante, maintenant, s.id)
    .map((a) => ({ ...a, generation: s.generation })));
  // Le relevé de Claude Code, quand il couvre la session, prime sur le calcul (il voit les appels hors transcription) ;
  // il inclut les agents de la session, comptés à part ici.
  for (const s of tous) {
    s.coutSource = 'calcul';
    if (s.coutReleve == null) continue;
    const ag = agents.filter((a) => a.proprietaire === s.id).reduce((t, a) => t + (a.cout || 0), 0);
    s.coutCalcule = s.cout; s.cout = Math.max(s.cout || 0, s.coutReleve - ag); s.coutSource = 'relevé';
  }
  sauverCacheA();
  const chef = lignee.at(-1);
  const mere = S.get(S.get(lignee[0].id)?.spawnedFrom?.sessionId);
  const parent = mere && !chaine.includes(mere.sessionId) ? { id: mere.sessionId, titre: mere.title || '' } : null;
  return assembler({ chef, lignee, sessions, agents, parent, courante, maintenant });
}

// Une transcription du terminal (sans fiche dans l'app) qui a lancé des agents.
function donneesCli(cli, maintenant) {
  const d = dossierProjet(cli); if (!d) return { erreur: 'Transcription introuvable.' };
  const f = path.join(d, `${cli}.jsonl`);
  let titre = '', demande = '', debut = '', fin = '', modele = '', coutT = 0, ctx = 0; const compter = compteur();
  if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!l || l.length > 400 * 1024) continue; let ev; try { ev = JSON.parse(l); } catch { continue; }
    if (ev.type === 'custom-title' && ev.customTitle) titre = ev.customTitle;
    if (ev.timestamp && !ev.isSidechain) { debut ||= ev.timestamp; fin = ev.timestamp; }
    const m = ev.message; if (!m) continue;
    if (ev.type === 'user' && !demande && !ev.isMeta) { const t = court(typeof m.content === 'string' ? m.content : texteDe(m.content), 900); if (t && !t.startsWith('<')) demande = t; }
    const k = ev.type === 'assistant' && m.usage && compter(m.id, m.model, m.usage);
    if (k) { coutT += k.cout; } if (k?.nouveau) { modele = m.model || modele; const u = m.usage; ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); }
  }
  const vivant = fs.existsSync(f) && maintenant - fs.statSync(f).mtimeMs < 3 * 60000;
  const chef = { genre: 'session', cle: `c:${cli}`, id: cli, titre: titre || court(demande, 70) || 'session du terminal', etat: vivant ? 'travaille' : 'au repos', profondeur: 0,
    modele, effort: '', cout: coutT, ctx, debut, fin, plan: [], commits: [], projet: projetTerminal(path.basename(d)), cli, vivant, _demande: demande, _rapport: '' };
  const agents = agentsDe(cli, [], vivant, maintenant, cli);
  sauverCacheA();
  chef.role = 'chef'; chef.generation = 1;
  return assembler({ chef, lignee: [chef], sessions: [], agents: agents.map((a) => ({ ...a, generation: 1 })), parent: null, courante: null, maintenant, terminal: true });
}

const ETATS = ['travaille', 'attend', 'interrompue', 'à relire', 'au repos', 'dort', 'en suspens', 'finie', 'rangée'];
// Trois familles d'état pour lire d'un coup d'œil : en cours, bloqué (attend une décision, ou interrompu), fini.
export const GROUPE = { travaille: 'actif', attend: 'bloque', interrompue: 'bloque', 'à relire': 'fini', finie: 'fini', rangée: 'fini', 'au repos': 'repos', dort: 'repos', 'en suspens': 'repos' };
function assembler({ chef, lignee = [chef], sessions, agents, parent, courante, maintenant, terminal = false }) {
  const compte = (L) => Object.fromEntries(ETATS.map((e) => [e, L.filter((x) => x.etat === e).length]).filter(([, n]) => n));
  const somme = (L, c) => L.reduce((a, x) => a + (x[c] || 0), 0);
  const parModele = (L) => L.reduce((o, x) => { const f = famille(x.modele); o[f] = (o[f] || 0) + 1; return o; }, {});
  const tous = [...lignee, ...sessions];
  const vivantes = sessions.filter((s) => !s.suite);   // une fille relancée compte une fois, sous sa dernière forme
  const groupes = (L) => L.reduce((o, x) => { const g = GROUPE[x.etat] || 'repos'; o[g] = (o[g] || 0) + 1; return o; }, {});
  return {
    date: new Date(maintenant).toISOString(), courante, terminal, parent,
    chef: { ...chef }, lignee, sessions, agents,
    totaux: { generations: lignee.length, sessions: sessions.length, taches: vivantes.length, relancees: sessions.length - vivantes.length, agents: agents.length,
      etatsSessions: compte(vivantes), etatsAgents: compte(agents), groupesSessions: groupes(vivantes), groupesAgents: groupes(agents),
      travaillent: [...vivantes, ...agents].filter((x) => x.etat === 'travaille').length,
      bloquent: [...vivantes, ...agents].filter((x) => GROUPE[x.etat] === 'bloque').length,
      cout: somme(tous, 'cout') + somme(agents, 'cout'), coutAgents: somme(agents, 'cout'), coutPartiel: tous.some((s) => s.cout == null),
      modelesSessions: parModele(vivantes), modelesAgents: parModele(agents) },
    phrase: phraseCalculee(chef, vivantes, agents, lignee.length),
  };
}

// La phrase de tête, calculée : ce que la lignée a lancé et pour quoi. Haiku peut la réécrire (voir `phrase`).
function phraseCalculee(chef, filles, agents, generations = 1) {
  const n = (k, s, p) => `${k} ${k > 1 ? p : s}`;
  const titres = filles.filter((s) => s.profondeur === 1).slice(-3).map((s) => `« ${court(s.titre, 48)} »`);
  if (!filles.length && !agents.length) return 'Cette session n’a encore lancé ni session ni agent.';
  const premieres = filles.filter((s) => s.profondeur === 1).length;
  const liste = titres.length ? ` — ${titres.join(', ')}${premieres > titres.length ? ` et ${premieres - titres.length} autre(s)` : ''}` : '';
  return `Orchestre ${[filles.length && n(filles.length, 'session', 'sessions'), agents.length && n(agents.length, 'agent', 'agents')].filter(Boolean).join(' et ')}${generations > 1 ? ` sur ${generations} générations` : ''}${liste}.`;
}

// ── Les environnements de ce Mac : chaque orchestration (lignée de générations) qui a lancé des sessions ou des
// agents, et chaque transcription du terminal qui a lancé des agents. Rangés du plus récent au plus ancien.
export function environnements({ jours = 45 } = {}) {
  const S = magasin(); const depuis = Date.now() - jours * 864e5; const G = generations(S);
  const enfants = new Map();
  for (const j of S.values()) { const p = j.spawnedFrom?.sessionId; if (p) enfants.set(p, [...(enfants.get(p) || []), j.sessionId]); }
  const nAgents = (j) => fichiersAgents(dossierAgents(j.cliSessionId, [j.cwd, j.originCwd])).length;
  const connus = new Set([...S.values()].map((j) => j.cliSessionId).filter(Boolean)); const E = []; const vus = new Set();
  for (const j of S.values()) {
    if (vus.has(j.sessionId)) continue;
    const chaine = chaineDe(j.sessionId, G);
    const tete = S.get(chaine[0]); const p = tete?.spawnedFrom?.sessionId;
    if (p && S.has(p) && !G.precedent.has(chaine[0])) { if (!G.suivant.has(j.sessionId) && chaine.length === 1) continue; }   // une fille simple n'ouvre pas d'environnement
    chaine.forEach((c) => vus.add(c));
    // Les membres : chaque génération et ses descendantes, sans compter deux fois la génération suivante.
    const membres = new Set(); for (const g of chaine) { const pile = [g]; while (pile.length) { const x = pile.pop(); if (membres.has(x)) continue; membres.add(x); pile.push(...(enfants.get(x) || [])); } }
    const M = [...membres].map((id) => S.get(id)).filter(Boolean);
    const agents = M.reduce((a, m) => a + nAgents(m), 0);
    if (M.length === chaine.length && !agents) continue;
    const derniere = Math.max(...M.map((m) => m.lastActivityAt || m.createdAt || 0));
    if (derniere < depuis) continue;
    const chef = S.get(chaine.at(-1));
    E.push({ id: chef.sessionId, genre: 'app', titre: chef.title || projetDe(chef.cwd), projet: projetDe(chef.cwd || chef.originCwd),
      generations: chaine.length, sessions: M.length - chaine.length, agents, derniere, archivee: !!chef.isArchived });
  }
  // Le terminal : <projets>/<dossier>/<uuid>/subagents sans fiche dans l'app.
  if (fs.existsSync(PROJETS)) for (const d of fs.readdirSync(PROJETS)) {
    const p = path.join(PROJETS, d); if (!fs.statSync(p).isDirectory()) continue;
    for (const u of fs.readdirSync(p)) {
      if (connus.has(u) || !/^[0-9a-f-]{36}$/.test(u)) continue;
      const n = fichiersAgents(path.join(p, u, 'subagents')).length; if (!n) continue;
      const f = path.join(p, `${u}.jsonl`); const m = fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0;
      if (m < depuis) continue;
      ouTranscription.set(u, p);
      E.push({ id: u, genre: 'terminal', titre: titreTerminal(f) || `terminal ${u.slice(0, 8)}`, projet: projetTerminal(d), generations: 1, sessions: 0, agents: n, derniere: m });
    }
  }
  sauverCacheA();
  return E.sort((a, b) => b.derniere - a.derniere);
}

function titreTerminal(f) {
  if (!fs.existsSync(f)) return '';
  let t = ''; const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(Math.min(256 * 1024, fs.statSync(f).size)); fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd);
  for (const l of b.toString('utf8').split('\n')) { let ev; try { ev = JSON.parse(l); } catch { continue; }
    if (ev.type === 'custom-title' && ev.customTitle) return ev.customTitle;
    if (!t && ev.type === 'user' && !ev.isMeta) { const c = court(typeof ev.message?.content === 'string' ? ev.message.content : texteDe(ev.message?.content), 60); if (c && !c.startsWith('<')) t = c; } }
  return t;
}

// ── Le récit « voir plus » : Haiku 5.5 · low sur un extrait court ; cache par empreinte de l'extrait.
export function extrait(x) {
  if (x.genre === 'agent') return [`Agent « ${x.titre} » (${x.type || 'agent'}), état : ${x.etat}.`,
    `Consigne reçue (début) : ${court(x._consigne, 700)}`, `Dernier message rendu (fin) : ${court(x._dernier, 1600)}`].join('\n');
  return [`Session « ${x.titre} », état : ${x.etat}${x.archivee ? ' (rangée)' : ''}.`,
    x._demande && `Demande reçue : ${court(x._demande, 700)}`,
    x._rapport && `Dernier rapport : ${court(x._rapport, 900)}`,
    x._ask && `Question laissée : ${court(x._ask, 200)}`,
    x.question && `En attente de : ${court(x.question, 200)}`,
    x.plan?.length && `Plan : ${x.plan.map((p) => `${p.etat === 'completed' ? '[fait]' : p.etat === 'in_progress' ? '[en cours]' : '[à faire]'} ${p.quoi}`).join(' ; ')}`,
    x.commits?.length && `Commits : ${x.commits.slice(0, 6).join(' ; ')}`,
    x.nonCommite && `${x.nonCommite} fichier(s) modifié(s) non commité(s).`].filter(Boolean).join('\n');
}
const CONSIGNE = 'Tu racontes à quelqu’un qui n’est pas développeur ce qu’une session ou un agent de travail a fait, à partir de l’extrait donné. '
  + 'Réponds uniquement par un objet JSON {"fait":"…","rendu":"…","reste":"…"} : une ou deux phrases courtes chacune, en français courant, ton direct et impersonnel, '
  + 'termes techniques gardés mais simples. « fait » = ce qui a été fait ; « rendu » = ce qui a été livré ou répondu (fichier, commit, chiffre) ; '
  + '« reste » = ce qui reste à faire ou la question en attente, sinon « Rien. ». N’invente rien : ce que l’extrait ne dit pas, écris « non dit ».';

// Un appel à Haiku 5.5 · low, sans outils, sans serveurs MCP, sans réglages ni hooks, prompt système réduit (≈ 12 k jetons relus).
async function haiku(texte, systeme) {
  const t0 = Date.now();
  let sortie;
  try {
    ({ stdout: sortie } = await promisify(execFile)(CLAUDE, ['-p', texte, '--model', 'claude-haiku-5-5', '--effort', 'low', '--output-format', 'json', '--tools', '', '--strict-mcp-config',
      '--no-session-persistence', '--setting-sources', '', '--system-prompt', systeme], { encoding: 'utf8', timeout: 90000, cwd: CACHE, maxBuffer: 1 << 24 }));
  } catch (e) { return { erreur: `Haiku n’a pas répondu (${court(e.message, 120)}).` }; }
  let j; try { j = JSON.parse(sortie); } catch { return { erreur: 'Réponse de Haiku illisible.' }; }
  const u = j.usage || {};
  // Coût aux prix du dépôt (extraire.mjs), et celui que rapporte la CLI, pour comparer.
  return { brut: String(j.result || ''), ms: Date.now() - t0, date: new Date().toISOString(),
    jetons: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0),
    cout: cout('claude-haiku-5-5', u), coutCli: j.total_cost_usd ?? null, caracteres: texte.length };
}
async function enCache(cle, f, forcer) {
  const R = lireJSON(F_RESUMES, {});
  if (!forcer && R[cle]) return { ...R[cle], cache: true };
  const r = await f(); if (r.erreur) return r;
  const R2 = lireJSON(F_RESUMES, {}); R2[cle] = r; ecrireJSON(F_RESUMES, R2);
  return { ...r, cache: false };
}
const empreinte = (t) => crypto.createHash('sha1').update(t).digest('hex').slice(0, 16);

export async function recit(x, { forcer = false } = {}) {
  const ex = extrait(x);
  return enCache(empreinte(`${x.cle}\n${ex}`), async () => {
    const h = await haiku(ex, CONSIGNE); if (h.erreur) return h;
    const { brut, ...m } = h;
    let t; try { t = JSON.parse(brut.slice(brut.indexOf('{'), brut.lastIndexOf('}') + 1)); } catch { t = { fait: court(brut, 600), rendu: 'non dit', reste: 'non dit' }; }
    return { fait: t.fait || 'non dit', rendu: t.rendu || 'non dit', reste: t.reste || 'non dit', ...m };
  }, forcer);
}

// La phrase de tête réécrite par Haiku, une fois par famille (clé : chef + ids des filles et agents).
const CONSIGNE_PHRASE = 'Écris une seule phrase de 25 mots au plus, en français courant, qui dit ce que cette session orchestre : le chantier et ce qu’elle fait faire. '
  + 'Commence par « Orchestre ». Ton direct et impersonnel. N’invente rien. Réponds par la phrase seule.';
export async function phrase(D, { forcer = false } = {}) {
  const ex = [`Session « ${D.chef.titre} ».`,
    D.lignee.length > 1 && `Générations successives : ${D.lignee.map((g) => g.titre).join(' → ')}.`,
    `Sessions lancées : ${D.sessions.filter((s) => !s.suite).slice(-25).map((s) => s.titre).join(' ; ') || 'aucune'}.`,
    `Agents : ${D.agents.slice(-25).map((a) => a.titre).join(' ; ') || 'aucun'}.`].filter(Boolean).join('\n');
  const cle = empreinte(`p:${D.lignee.map((g) => g.id).join('>')}:${[...D.sessions.map((s) => s.id), ...D.agents.map((a) => a.id)].join(',')}`);
  return enCache(cle, async () => { const h = await haiku(ex, CONSIGNE_PHRASE); if (h.erreur) return h; const { brut, ...m } = h; return { texte: court(brut.replace(/^["«\s]+|["»\s]+$/g, ''), 260), ...m }; }, forcer);
}

// ── L'empreinte d'un environnement : tailles et dates des fichiers qui le font (magasin de l'app, transcriptions,
// dossiers d'agents), sans rien lire. Inchangée, la page reçoit le dernier calcul : un rafraîchissement coûte un stat.
const st = (f) => { try { const s = fs.statSync(f); return `${s.size}:${Math.floor(s.mtimeMs)}`; } catch { return '-'; } };
export function empreinteEnv(D) {
  const h = crypto.createHash('sha1');
  const marcher = (d, n) => { if (n > 3) return; let L; try { L = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of L) { const p = path.join(d, e.name); if (e.isDirectory()) marcher(p, n + 1); else if (e.name.startsWith('local_')) h.update(p + st(p)); } };
  marcher(MAGASIN, 0);   // une génération ou une fille nouvelle ajoute un fichier ici
  for (const s of [...(D.lignee || []), ...(D.sessions || [])]) {
    const d = s.cli && dossierProjet(s.cli, [s.cwd]); if (!d) continue;
    h.update(st(path.join(d, `${s.cli}.jsonl`)));
    const a = path.join(d, s.cli, 'subagents'); h.update(st(a)); for (const f of fichiersAgents(a)) h.update(f + st(path.join(a, f)));
  }
  h.update(String(Math.floor(Date.now() / 60000)));   // les états « depuis 3 min » bougent seuls : au plus une minute de cache
  return h.digest('hex');
}

// Ce que la page reçoit : les champs « _ » (extraits bruts) restent côté serveur.
const publier = (D) => JSON.parse(JSON.stringify(D, (k, v) => k.startsWith('_') ? undefined : v));

// ── Le serveur local : la page, les données d'un environnement, la liste des environnements, les récits.
function serveur() {
  const page = path.join(DEPOT, 'outils/bureau.html');
  const pagePboard = path.join(DEPOT, 'outils/pboard.html');
  const memo = new Map();   // dernier calcul par environnement, pour retrouver l'extrait d'un « voir plus »
  let derniere = Date.now();
  setInterval(() => { if (Date.now() - derniere > 3 * 36e5) process.exit(0); }, 60000).unref();
  const envoyer = (res, code, corps, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof corps === 'string' ? corps : JSON.stringify(corps)); };
  http.createServer(async (req, res) => {
    derniere = Date.now();
    const u = new URL(req.url, 'http://x'); const q = Object.fromEntries(u.searchParams);
    if (!hoteAutorise(req.headers.host)) return envoyer(res, 403, { erreur: 'hôte refusé' });
    try {
      // La page unique pboard : l'hôte pboard.localhost, ou le chemin /pboard. Le bureau reste sur localhost:4517/ (et /bureau, pour l'iframe).
      const chezPboard = (req.headers.host || '').toLowerCase() === `pboard.localhost:${PORT}`;
      if (u.pathname === '/pboard' || (chezPboard && u.pathname === '/')) return envoyer(res, 200, fs.readFileSync(pagePboard, 'utf8'), 'text/html; charset=utf-8');
      if (u.pathname.startsWith('/api/pboard/')) {
        const r = await pboard.route(u.pathname.slice(12), q);
        return r === null ? envoyer(res, 404, { erreur: 'onglet inconnu' }) : envoyer(res, 200, r);
      }
      if (u.pathname === '/' || u.pathname === '/bureau') return envoyer(res, 200, fs.readFileSync(page, 'utf8'), 'text/html; charset=utf-8');
      if (u.pathname === '/api/ping') return envoyer(res, 200, { ok: true, depot: DEPOT, pid: process.pid, code: CODE });
      if (u.pathname === '/api/envs') return envoyer(res, 200, environnements());
      const env = q.c ? `c:${q.c}` : `s:${q.s || ''}`;
      if (u.pathname === '/api/env') {
        const t0 = Date.now(); const avant = memo.get(env);
        if (avant && !avant.D.erreur && empreinteEnv(avant.D) === avant.sig) return envoyer(res, 200, { ...avant.P, calcul: { ms: Date.now() - t0, cache: true } });
        const D = donnees({ session: q.s, cli: q.c, moi: q.moi, dossier: q.d }); const P = publier(D);
        memo.set(env, { D, P, sig: D.erreur ? '' : empreinteEnv(D) });
        return envoyer(res, 200, { ...P, calcul: { ms: Date.now() - t0, cache: false } });
      }
      let D = memo.get(env)?.D; if (!D) { D = donnees({ session: q.s, cli: q.c, moi: q.moi, dossier: q.d }); memo.set(env, { D, P: publier(D), sig: '' }); }
      if (u.pathname === '/api/phrase') return envoyer(res, 200, D.erreur ? D : await phrase(D));
      if (u.pathname === '/api/recit') {   // « refaire » appelle Haiku : POST seulement
        const x = [...(D.lignee || []), ...(D.sessions || []), ...(D.agents || [])].find((y) => y.cle === q.k);
        return x ? envoyer(res, 200, await recit(x, { forcer: req.method === 'POST' && q.forcer === '1' })) : envoyer(res, 404, { erreur: 'Introuvable dans cet environnement.' });
      }
      envoyer(res, 404, { erreur: 'inconnu' });
    } catch (e) { envoyer(res, 500, { erreur: court(e.message, 200) }); }
  }).listen(PORT, '127.0.0.1');
}

// ── `ouvrir` : calcule l'état (sortie texte pour le tour du modèle), lance le serveur s'il ne répond pas, ouvre la page.
async function ping() { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/ping`, { signal: AbortSignal.timeout(800) }); return await r.json(); } catch { return null; } }
const repond = async () => { const p = await ping(); return p?.depot === DEPOT && p.code === CODE; };
async function ouvrir(dossier, session, sansOuvrir) {
  const t0 = Date.now();
  const D = donnees({ session, dossier });
  if (D.erreur) { console.log(D.erreur); return; }
  if (!(await repond())) {
    const vieux = await ping(); if (vieux?.pid) { try { process.kill(vieux.pid); } catch {} await new Promise((r) => setTimeout(r, 300)); }
    fs.mkdirSync(CACHE, { recursive: true });
    const log = fs.openSync(path.join(CACHE, 'bureau.log'), 'a');
    spawn(process.execPath, [fileURLToPath(import.meta.url), 'serveur'], { detached: true, stdio: ['ignore', log, log] }).unref();
    for (let i = 0; i < 30 && !(await repond()); i++) await new Promise((r) => setTimeout(r, 100));
  }
  const url = `http://127.0.0.1:${PORT}/?s=${encodeURIComponent(D.chef.id)}&moi=${encodeURIComponent(D.courante || '')}&d=${encodeURIComponent(dossier)}`;
  if (!sansOuvrir && !process.env.ORCH_SANS_OUVRIR) try { execFileSync('open', [url]); } catch {}
  const T = D.totaux; const e = (o) => Object.entries(o).map(([k, n]) => `${n} ${k}`).join(' · ');
  const $ = (n) => `${n.toFixed(2).replace('.', ',')} $`;
  console.log([`## 🪑 Bureau ouvert — ${D.chef.titre}`, '', D.phrase, '',
    '| | |', '|---|---|',
    ...(T.generations > 1 ? [`| **Générations** | ${T.generations} — ${D.lignee.map((g) => g.titre).join(' → ')} |`] : []),
    `| **Sessions** | ${T.sessions}${T.relancees ? ` lancées, ${T.taches} tâches (${T.relancees} relances)` : ''}${T.taches ? ` — ${e(T.etatsSessions)}` : ''} |`,
    `| **Agents** | ${T.agents}${T.agents ? ` — ${e(T.etatsAgents)}` : ''} |`,
    `| **Coût** | ${$(T.cout)}${T.coutPartiel ? ' (au moins)' : ''}, dont agents ${$(T.coutAgents)} |`,
    `| **Page** | ${url} |`, '',
    `Calculé en ${((Date.now() - t0) / 1000).toFixed(1).replace('.', ',')} s, sans modèle. Les récits « voir plus » passent par Haiku 5.5 · low, en cache.`].join('\n'));
}

const [CMD = 'ouvrir'] = args.filter((a) => !a.startsWith('--'));
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const dossier = opt('--dossier') || process.cwd(); const session = opt('--session'); const cliId = opt('--cli'); const sansOuvrir = drapeau('--sans-ouvrir');
  if (CMD === 'serveur') serveur();
  else if (CMD === 'donnees') console.log(JSON.stringify(publier(donnees({ session, cli: cliId, dossier })), null, 1));
  else if (CMD === 'environnements') console.log(JSON.stringify(environnements(), null, 1));
  else await ouvrir(dossier, session, sansOuvrir);
}
export { PRIX };
