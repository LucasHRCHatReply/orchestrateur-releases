#!/usr/bin/env node
// Range une orchestration : les sessions de la famille (lancées par elle, ses sœurs, ses filles), leur état,
// leur poids en mémoire vive et en jetons, le tri à archiver / garder / relancer, les notes de reprise
// et le bilan après archivage. Sert `/orch ranger`. Sortie en Markdown, que Claude recopie telle quelle.
//
// Usage : node outils/ranger.mjs [liste|notes [ids…]|tout --reprise-dans [id]|bilan]
//           [--dossier chemin] [--session id] [--json] [--avec-archivees] [--maintenant ISO]
// Lit, sans rien y écrire : le magasin de sessions de l'app de bureau, ~/.claude/projects, `ps`, `git status`.
// Écrit : ~/.cache/orchestration/ranger.json (le plan et la mémoire avant), ranger-cache.json (résumé par
// transcription, clé taille:mtime), les notes de reprise.
// --avec-archivees : rejoue un essai en reprenant les sessions archivées comme ouvertes ; le plan va dans
//   ranger-essai.json et aucune note n'est écrite (sauf `notes <ids>`, qui écrit pour de vrai les ids donnés).
// --maintenant : fixe l'heure de référence (rejeu d'un cas réel).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { famille, cout, compteur } from './extraire.mjs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const drapeau = (n) => { const i = args.indexOf(n); if (i >= 0) args.splice(i, 1); return i >= 0; };
const JSON_ = drapeau('--json');
const AVEC_ARCHIVEES = drapeau('--avec-archivees');
const DOSSIER = opt('--dossier') || process.cwd();
const SESSION = opt('--session') || '';
const MAINTENANT_ARG = opt('--maintenant');
// `--reprise-dans` prend un id de session ; sans id, c'est la session courante.
let REPRISE = null;
{ const i = args.indexOf('--reprise-dans');
  if (i >= 0) { const v = args[i + 1]; if (v && /^local_/.test(v)) { REPRISE = v; args.splice(i, 2); } else { REPRISE = 'moi'; args.splice(i, 1); } } }
const [CMD = 'liste', ...IDS] = args;
const MAISON = os.homedir();
const MAGASIN = path.join(MAISON, 'Library/Application Support/Claude/claude-code-sessions');
const PROJETS = path.join(MAISON, '.claude/projects');
const CACHE = path.join(MAISON, '.cache/orchestration');
// Un essai (sessions archivées reprises comme ouvertes) n'écrit ni notes ni le vrai plan ; `notes <ids>` fait exception.
const ESSAI = AVEC_ARCHIVEES && CMD !== 'notes';
const PLAN = path.join(CACHE, ESSAI ? 'ranger-essai.json' : 'ranger.json');
const FICHIER_CACHE = path.join(CACHE, 'ranger-cache.json');
const COFFRE = process.env.ORCH_COFFRE || path.join(MAISON, 'pboard');
const MOI = SESSION || process.env.CLAUDE_CODE_HOST_SESSION_ID || '';
const MAINTENANT = MAINTENANT_ARG ? Date.parse(MAINTENANT_ARG) : Date.now();
const SEUIL_GROS = 40 * 1048576;   // au-delà : on ne lit que la fin du fichier
const FIN_GROS = 8 * 1048576;
const VERSION_CACHE = 4;   // 3 : coût au modèle exact, sortie complète (02/11/2026)

// ── Mise en forme (comme etat.mjs)
const k = (n) => n == null ? 'n/a' : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : String(n);
const $ = (n) => n == null ? 'n/a' : `${n.toFixed(2).replace('.', ',')} $`;
const mo = (n) => n >= 1024 ? `${(n / 1024).toFixed(2).replace('.', ',')} Go` : `${Math.round(n)} Mo`;
const jauge = (v, max, l = 10) => { const p = Math.min(1, (v || 0) / max); const n = Math.round(p * l); return '█'.repeat(n) + '░'.repeat(l - n); };
const age = (ms) => { const m = Math.round(Math.max(0, ms) / 60000); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} j ${Math.floor((m % 1440) / 60)} h`; };
const court = (t = '', n = 70) => { const s = String(t).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[|\n]+/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s || '—'; };
const slug = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
const sh = (cmd, a, cwd) => { try { return execFileSync(cmd, a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }); } catch { return ''; } };
const somme = (L, c) => L.reduce((a, x) => a + (x[c] || 0), 0);
const id8 = (id) => id.replace(/^local_/, '').slice(0, 8);
const encoder = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
const jourDe = () => new Date(MAINTENANT).toISOString().slice(0, 10);

// ── Git, mis en cache pour la durée du run : une question par dépôt, jamais une par session ou par commit.
const memo = new Map();
const unefois = (cle, f) => { if (!memo.has(cle)) memo.set(cle, f()); return memo.get(cle); };
const racineGit = (cwd) => unefois(`racine|${cwd}`, () => sh('git', ['rev-parse', '--show-toplevel'], cwd).trim());
const brancheDe = (d) => unefois(`branche|${d}`, () => sh('git', ['branch', '--show-current'], d).trim());
const statutGit = (racine) => unefois(`statut|${racine}`, () => sh('git', ['status', '--porcelain'], racine).split('\n').filter(Boolean).map((l) => path.join(racine, l.slice(3).replace(/^"|"$/g, ''))));

// ── Le magasin de l'app : un JSON par session (titre, dossier, archivée, dernier rapport, parent).
function magasin() {
  const S = new Map();
  const marcher = (d, n) => { if (n > 3 || !fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d)) { const p = path.join(d, f);
      if (f.startsWith('local_') && f.endsWith('.json')) { try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); if (j.sessionId) S.set(j.sessionId, j); } catch {} }
      else if (!f.includes('.') && fs.statSync(p).isDirectory()) marcher(p, n + 1); } };
  marcher(MAGASIN, 0);
  return S;
}
const archivee = (j) => j?.isArchived && !AVEC_ARCHIVEES;

// ── La mémoire vive : chaque processus `claude` porte l'id de sa session dans son environnement.
function memoire() {
  const ps = sh('ps', ['-axo', 'pid=,ppid=,rss=,comm=']).trim().split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map((m) => ({ pid: +m[1], ppid: +m[2], rss: +m[3] / 1024, comm: m[4] }));
  const enfants = (p) => ps.filter((x) => x.ppid === p).flatMap((x) => [x, ...enfants(x.pid)]);
  const parSession = {}; let total = 0; let n = 0;
  for (const p of ps.filter((x) => /\/claude$/.test(x.comm))) {
    const env = sh('ps', ['eww', '-o', 'command=', '-p', String(p.pid)]);
    const id = env.match(/CLAUDE_CODE_HOST_SESSION_ID=(\S+)/)?.[1] || `pid-${p.pid}`;
    const rss = p.rss + enfants(p.pid).reduce((a, x) => a + x.rss, 0);
    parSession[id] = (parSession[id] || 0) + rss; total += rss; n++;
  }
  return { parSession, total, n, date: new Date().toISOString() };
}

// ── La famille : on remonte les parents jusqu'à la racine, puis on prend tous ses descendants.
function famillede(S, moi) {
  const parent = (j) => j?.spawnedFrom?.sessionId;
  let racine = moi; const vus = new Set();
  while (parent(S.get(racine)) && !vus.has(racine)) { vus.add(racine); racine = parent(S.get(racine)); }
  const ancetres = new Set([...vus, racine]);
  const membres = new Set([racine]); let ajout = true;
  while (ajout) { ajout = false; for (const [id, j] of S) if (!membres.has(id) && membres.has(parent(j))) { membres.add(id); ajout = true; } }
  return { racine, membres, ancetres };
}

// ── La transcription d'une session. Repli (session courante surtout) : la plus récente du dossier de travail.
function transcription(j, repli) {
  const nom = `${j.cliSessionId}.jsonl`;
  const dossiers = [j.cwd, j.originCwd].filter(Boolean).map((c) => path.join(PROJETS, encoder(c)));
  if (j.cliSessionId) {
    for (const d of dossiers) if (fs.existsSync(path.join(d, nom))) return path.join(d, nom);
    for (const d of fs.existsSync(PROJETS) ? fs.readdirSync(PROJETS) : []) if (fs.existsSync(path.join(PROJETS, d, nom))) return path.join(PROJETS, d, nom);
  }
  if (repli) for (const d of [...dossiers, path.join(PROJETS, encoder(DOSSIER))]) {
    if (!fs.existsSync(d)) continue;
    const fs_ = fs.readdirSync(d).filter((f) => f.endsWith('.jsonl')).map((f) => ({ f: path.join(d, f), m: fs.statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.m - a.m);
    if (fs_.length) return fs_[0].f;
  }
  return null;
}

// ── Lecture d'une transcription : tout le fichier en flux, ou seulement sa fin quand il est énorme.
async function* lignes(f, gros) {
  if (gros) {
    const taille = fs.statSync(f).size, n = Math.min(FIN_GROS, taille), buf = Buffer.alloc(n), fd = fs.openSync(f, 'r');
    fs.readSync(fd, buf, 0, n, taille - n); fs.closeSync(fd);
    const L = buf.toString('utf8').split('\n'); L.shift(); yield* L; return;
  }
  yield* readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
}
const texteDe = (c) => Array.isArray(c) ? c.map((x) => x.text || '').join('\n') : String(c || '');

// ── Ce qu'une transcription dit de la session. Le résumé est sérialisable (tableaux, pas de Set) : il va au cache.
// Le relevé de Claude Code sous-compte Haiku 5.5 (médiane 0,55 du prix public sur 370 relevés, 02/11/2026) :
// sa part est remplacée par le calcul aux prix publics, le reste du relevé est gardé.
export function releveCorrige(ev) {
  let t = ev.totalCostUSD; if (t == null) return null;
  for (const [m, v] of Object.entries(ev.modelUsage || {})) if (/haiku-5-5/.test(m))
    t += cout(m, { input_tokens: v.inputTokens, output_tokens: v.outputTokens, cache_read_input_tokens: v.cacheReadInputTokens, cache_creation_input_tokens: v.cacheCreationInputTokens }) - (v.costUSD || 0);
  return t;
}

async function analyser(f, gros) {
  const r = { ctx: 0, cout: 0, jetons: 0, tours: 0, commits: [], plan: [], fichiers: [], dossiers: [], messages: [], cites: [], debut: '', fin: '', demande: '', recap: '', ask: '', modele: '',
    customTitle: '', lastUA: 0, termine: true, partiel: gros,
    surv: { mon: [], stops: [], crons: [], cronDel: [], wake: null, sched: [], schedDel: [], loop: 0 } };
  const fichiers = new Set(), dossiers = new Set(), messages = new Set(), cites = new Set(), compter = compteur();
  const bash = new Map(), att = new Map(), attendus = new Set();
  let dernier = 'assistant';
  // Le relevé de Claude Code (cost-state) compte aussi les appels absents de la transcription et les agents.
  // Il repart de zéro à chaque reprise : il ne vaut que s'il couvre toute la session (un seul processus, dès le début).
  const releves = new Set(); let releve = null, premier = 0;
  for await (const l of lignes(f, gros)) {
    if (!l || l.length > 400 * 1024) continue;
    const dim = l.includes('"type":"user"') || l.includes('"type":"assistant"');
    if (!dim && !l.includes('custom-title') && !l.includes('"type":"cost-state"')) continue;
    let ev; try { ev = JSON.parse(l); } catch { continue; }
    if (ev.type === 'custom-title') { if (ev.customTitle) r.customTitle = ev.customTitle; continue; }
    if (ev.type === 'cost-state') { releves.add(ev.startTime); releve = releveCorrige(ev); continue; }
    if (ev.timestamp && !premier) premier = Date.parse(ev.timestamp);
    const m = ev.message; if (!m || (ev.type !== 'user' && ev.type !== 'assistant')) continue;
    const ts = ev.timestamp ? Date.parse(ev.timestamp) : 0;
    if (ev.timestamp && !ev.isSidechain) { r.debut ||= ev.timestamp; r.fin = ev.timestamp; if (ts) r.lastUA = ts; }
    const cote = !!ev.isSidechain;
    if (ev.type === 'user') {
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c.type !== 'tool_result') continue;
        attendus.delete(c.tool_use_id);
        const t = texteDe(c.content);
        if (bash.has(c.tool_use_id)) for (const x of t.matchAll(/^\[([\w./-]+)(?: \(root-commit\))? ([0-9a-f]{7,})\] (.+)$/gm)) r.commits.push({ branche: x[1], sha: x[2], msg: x[3].slice(0, 140), dossier: bash.get(c.tool_use_id) });
        const a = att.get(c.tool_use_id);
        if (a && !c.is_error) {
          if (a.k === 'mon') { const id = t.match(/task (\w+)/)?.[1] || ev.toolUseResult?.taskId; if (id) r.surv.mon.push({ ...a.v, id }); }
          else if (a.k === 'bg') { const id = t.match(/ID:\s*(\w+)/)?.[1] || ev.toolUseResult?.backgroundTaskId || ev.toolUseResult?.shellId; if (id) r.surv.mon.push({ ...a.v, id }); }
          else if (a.k === 'cron') { const id = t.match(/job (\w+)/)?.[1] || ev.toolUseResult?.id; if (id) r.surv.crons.push({ ...a.v, id, durable: ev.toolUseResult?.durable ?? a.v.durable, rec: ev.toolUseResult?.recurring ?? a.v.rec }); }
          else if (a.k === 'sched') r.surv.sched.push(a.v);
        }
      }
      const t = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n') : '');
      const propre = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
      const humain = propre && !ev.isMeta && !/^\s*<(?!pasted)/.test(propre);
      if (humain) r.demande = propre;
      if (!cote) dernier = humain ? 'user' : Array.isArray(m.content) && m.content.some((x) => x.type === 'tool_result') ? 'result' : dernier;
      continue;
    }
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c.type === 'text') for (const x of (c.text || '').matchAll(/`([0-9a-f]{7,12})`|\bcommits? ([0-9a-f]{7,12})\b/g)) cites.add(x[1] || x[2]);
      if (c.type !== 'tool_use') continue; const i = c.input || {};
      if (!cote) attendus.add(c.id);
      if (c.name === 'Bash') {
        const cmd = i.command || ''; const d = (cmd.match(/(?:^|[;&|]\s*)cd\s+([^\s;&|]+)/) || [])[1] || (cmd.match(/git\s+-C\s+(\S+)/) || [])[1];
        if (d) dossiers.add(d.replace(/^~/, MAISON).replace(/^["']|["']$/g, ''));
        if (/git\b[^|;&]*\bcommit\b/.test(cmd)) { bash.set(c.id, d || ev.cwd); const msg = cmd.match(/\s-[a-zA-Z]*m\s+(?:"([^"\n]+)|'([^'\n]+))/); if (msg) messages.add((msg[1] || msg[2]).trim()); }
        if (i.run_in_background) att.set(c.id, { k: 'bg', v: { desc: i.description || cmd.slice(0, 60), ts, ms: i.timeout_ms || i.timeout || 1800000, persist: false, fond: true } });
      }
      else if (c.name === 'Monitor') att.set(c.id, { k: 'mon', v: { desc: i.description || (i.command || '').slice(0, 60), ts, ms: i.timeout_ms || 1800000, persist: i.persistent === true || i.persistent === 'true' } });
      else if (c.name === 'TaskStop' || c.name === 'KillShell') r.surv.stops.push(i.task_id || i.shell_id || i.id);
      else if (c.name === 'CronCreate') att.set(c.id, { k: 'cron', v: { desc: (i.prompt || '').slice(0, 60), ts, durable: i.durable === true, rec: i.recurring !== false } });
      else if (c.name === 'CronDelete') r.surv.cronDel.push(i.id);
      else if (c.name === 'ScheduleWakeup') r.surv.wake = { ts, delay: i.delaySeconds || 0, stop: !!i.stop, desc: (i.prompt || i.reason || '').slice(0, 60) };
      else if (c.name === 'Skill' && i.skill === 'loop') r.surv.loop = ts;
      else if (/create_scheduled_task$/.test(c.name)) att.set(c.id, { k: 'sched', v: { id: i.taskId, desc: (i.description || i.taskId || '').slice(0, 60) } });
      else if (/delete_scheduled_task$/.test(c.name)) r.surv.schedDel.push(i.taskId);
      else if (/update_plan$/.test(c.name) && Array.isArray(i.items)) { r.plan = i.items.map((x) => ({ quoi: x.content, etat: x.status })); r.ask = ''; }
      else if (/update_plan$/.test(c.name) && i.advance && r.plan.length) { const n = r.plan.findIndex((x) => x.etat === 'in_progress'); if (n >= 0) { r.plan[n].etat = 'completed'; if (r.plan[n + 1]) r.plan[n + 1].etat = 'in_progress'; } }
      else if (/wrap_up$/.test(c.name)) { r.recap = i.recap || ''; r.ask = i.ask || ''; r.plan.forEach((x) => { x.etat = 'completed'; }); } // la fin de tour coche toute la liste
      else if ((c.name === 'Edit' || c.name === 'Write') && i.file_path) fichiers.add(i.file_path);
    }
    if (!cote) dernier = 'assistant';
    if (!m.usage) continue;
    const u = m.usage; const k = compter(m.id, m.model, u); if (!k) continue;
    r.cout += k.cout; if (!k.nouveau) { r.jetons += k.sortie; continue; }
    r.tours++; r.modele = m.model || r.modele;
    r.ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    r.jetons += r.ctx + (u.output_tokens || 0);
  }
  if (!gros && releve != null && releves.size === 1 && Math.abs([...releves][0] - premier) < 120000) r.coutReleve = releve;
  // Le dernier tour est fini quand rien n'attend de résultat et que le dernier mot est celui de l'assistant.
  r.termine = attendus.size === 0 && dernier === 'assistant';
  if (gros) { r.cout = null; r.jetons = null; r.tours = null; }  // la fin du fichier ne dit pas le total : n/a, jamais 0
  r.fichiers = [...fichiers]; r.dossiers = [...dossiers]; r.messages = [...messages]; r.cites = [...cites];
  return r;
}

// ── Cache par transcription : clé taille:mtime ; une transcription inchangée n'est jamais relue.
let cacheTr = null, cacheModifie = false;
const chargerCache = () => { if (cacheTr) return; try { const c = JSON.parse(fs.readFileSync(FICHIER_CACHE, 'utf8')); cacheTr = c.v === VERSION_CACHE ? c.e : {}; } catch { cacheTr = {}; } };
function sauverCache() {
  if (!cacheModifie) return;
  try { fs.mkdirSync(CACHE, { recursive: true }); const t = `${FICHIER_CACHE}.${process.pid}`; fs.writeFileSync(t, JSON.stringify({ v: VERSION_CACHE, e: cacheTr })); fs.renameSync(t, FICHIER_CACHE); } catch {}
}
async function lireSession(f) {
  const vide = { ctx: 0, cout: 0, jetons: 0, tours: 0, commits: [], plan: [], fichiers: [], dossiers: [], messages: [], cites: [], debut: '', fin: '', demande: '', recap: '', ask: '', modele: '',
    customTitle: '', lastUA: 0, termine: true, partiel: false, surv: { mon: [], stops: [], crons: [], cronDel: [], wake: null, sched: [], schedDel: [], loop: 0 } };
  if (!f) return { ...vide, absente: true };
  chargerCache();
  const st = fs.statSync(f), cle = `${st.size}:${Math.floor(st.mtimeMs)}`;
  if (cacheTr[f]?.cle === cle) return cacheTr[f].r;
  const r = await analyser(f, st.size > SEUIL_GROS);
  cacheTr[f] = { cle, r }; cacheModifie = true;
  return r;
}

// ── Les commits d'une session, cherchés seulement au moment d'écrire sa note (jamais dans `liste`).
function completer(x) {
  const t = x._t; if (x.complet) return; x.complet = true;
  const commits = [...x.commits];
  const connu = (sha) => commits.some((c) => sha.startsWith(c.sha) || c.sha.startsWith(sha));
  // `git commit -q` n'écrit rien : on retrouve les commits dans le journal des dépôts touchés, par leur message.
  if (t.messages.length && t.debut) for (const d of t.dossiers) {
    if (!fs.existsSync(d)) continue;
    const fin = new Date(new Date(t.fin).getTime() + 120000).toISOString();
    for (const l of sh('git', ['log', '--all', `--since=${t.debut}`, `--until=${fin}`, '--format=%h%x09%D%x09%s'], d).split('\n').filter(Boolean)) {
      const [sha, refs, msg] = l.split('\t');
      if (t.messages.includes(msg) && !connu(sha)) commits.push({ branche: brancheDe(d) || refs || '?', sha, msg: msg.slice(0, 140), dossier: d });
    }
  }
  // Filet : les empreintes que la session cite elle-même (« commit 0e6adca »), vérifiées dans ses dépôts.
  for (const sha of t.cites) if (!connu(sha)) for (const d of [...t.dossiers, x.cwd].filter((y) => y && fs.existsSync(y))) {
    const l = sh('git', ['log', '-1', '--format=%h%x09%s', sha], d).trim(); if (!l) continue;
    const [h, msg] = l.split('\t'); commits.push({ branche: brancheDe(d) || '?', sha: h, msg: msg.slice(0, 140), dossier: d }); break;
  }
  const fichiers = new Set(x.fichiers);
  for (const c of commits) if (c.dossier && fs.existsSync(c.dossier)) for (const f of sh('git', ['show', '--name-only', '--format=', c.sha], c.dossier).split('\n').filter(Boolean)) fichiers.add(path.join(racineGit(c.dossier), f));
  x.commits = commits; x.fichiers = [...fichiers];
}

// ── Le travail non commité : les fichiers touchés par la session qui restent modifiés dans son dépôt.
function nonCommite(j, fichiers) {
  if (!j.cwd || !fs.existsSync(j.cwd)) return [];
  const racine = racineGit(j.cwd); if (!racine) return [];
  const f = new Set(fichiers);
  return statutGit(racine).filter((x) => f.has(x));
}

// ── Le projet du coffre : le dossier `docs/` du dépôt est un lien vers Projets/<Nom>/.
function projetCoffre(cwd) {
  return unefois(`coffre|${cwd}`, () => {
    const commun = sh('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd).trim();
    const depot = commun ? path.dirname(commun) : cwd;
    try { const p = fs.realpathSync(path.join(depot, 'docs')); if (p.startsWith(path.join(COFFRE, 'Projets') + path.sep)) return p; } catch {}
    return null;
  });
}

// ── La surveillance : ce qui, dans la transcription, tient encore la session éveillée ou la réveillera.
// Vivante : Monitor ou Bash de fond (processus vivant, pas de TaskStop, délai pas échu), CronCreate non supprimé
// (processus vivant ou durable), ScheduleWakeup non arrêté (heure + délai + 10 min de marge), tâche planifiée non supprimée.
function survivantes(s, vivant, maintenant) {
  const v = [];
  const arrete = new Set(s.stops);
  for (const m of s.mon) if (vivant && !arrete.has(m.id) && (m.persist || m.ts + m.ms > maintenant)) v.push(`${m.fond ? 'tâche de fond' : 'Monitor'} : ${m.desc}`);
  const supprime = new Set(s.cronDel);
  for (const c of s.crons) if (!supprime.has(c.id) && (vivant || c.durable) && c.ts + 7 * 864e5 > maintenant) v.push(`cron : ${c.desc}`);
  if (s.wake && !s.wake.stop && s.wake.ts + s.wake.delay * 1000 + 10 * 60000 > maintenant) v.push(`réveil programmé : ${s.wake.desc || 'ScheduleWakeup'}`);
  const retire = new Set(s.schedDel);
  for (const t of s.sched) if (!retire.has(t.id)) v.push(`tâche planifiée : ${t.desc}`);
  return v;
}
const ANNONCE = /surveill|toutes les \d+ ?min|relev[ée] toutes/i;

// ── Le tri, règle par règle. Jamais une session qui travaille ou attend une réponse.
function trier(x) {
  if (x.id === I_MOI) return ['garder', 'c’est cette session'];
  if (x.ancetre) return ['garder', 'orchestration au-dessus de celle-ci'];
  if (x.etat === 'travaille') return ['garder', 'travaille'];
  if (x.surveille.length) return ['garder', `👁 surveille : ${court(x.surveille[0], 50)}`];
  if (x.signal) return ['garder', '⚠ surveillance annoncée, aucune minuterie vivante : à vérifier'];
  if (x.question) return ['garder', `attend : ${court(x.question, 60)}`];
  if (x.nonCommite.length) return ['garder', `${x.nonCommite.length} fichier(s) non commité(s)`];
  if (x.fillesActives) return ['garder', `${x.fillesActives} fille(s) encore active(s)`];
  if ((x.reste.length || x.ask) && x.ctx > 250000) return ['relancer', `suite proposée, ${k(x.ctx)} de contexte : repartir de la note`];
  if (x.etat === 'à relire' && x.inactif < 12 * 36e5) return ['garder', 'à relire'];
  if (x.etat === 'interrompue') return ['archiver', 'interrompue : sa note dit où reprendre'];
  if (x.etat === 'dort') return ['archiver', `dort depuis ${age(x.inactif)}, notée`];
  if (x.inactif < 30 * 60000) return ['garder', 'active il y a moins de 30 min'];
  return ['archiver', x.reste.length ? `${x.reste.length} étape(s) non faite(s), notées` : x.ask ? 'finie, sa suite est notée' : 'finie'];
}
let I_MOI = '';

async function inventaire() {
  const S = magasin();
  if (!S.size) return { erreur: 'Magasin de sessions introuvable : `/orch ranger` demande l’app de bureau Claude (onglet Code).' };
  let moi = MOI && S.has(MOI) ? MOI : null;
  if (!moi && SESSION) { moi = SESSION; S.set(moi, { sessionId: moi, cwd: DOSSIER }); }   // session forcée absente du magasin
  moi ||= [...S.values()].filter((j) => j.cwd === DOSSIER && !archivee(j)).sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]?.sessionId;
  if (!moi) return { erreur: 'Aucune session de l’app trouvée pour ce dossier.' };
  I_MOI = moi;
  const F = famillede(S, moi); const M = memoire();
  const L = [];
  for (const id of F.membres) {
    const j = S.get(id); if (!j || archivee(j)) continue;
    const t = await lireSession(transcription(j, id === moi));
    const p = j.postTurnSummary || {};
    const rss = M.parSession[id] || 0, vivant = rss > 0;
    const dernierMot = t.lastUA || j.lastActivityAt || j.createdAt || 0;   // dernier événement user/assistant, pas le mtime
    const inactif = dernierMot ? Math.max(0, MAINTENANT - dernierMot) : null;
    const recent = vivant && inactif != null && inactif < 3 * 60000;
    const attend = p.status_category === 'blocked' || !!p.needs_action;
    const fini = p.status_category === 'completed' || p.status_category === 'review_ready';
    const etat = id === moi || recent ? 'travaille'
      : attend ? 'attend'
      : !vivant && !t.termine && !t.absente ? 'interrompue'
      : p.status_category === 'review_ready' ? 'à relire'
      : p.status_category === 'completed' ? 'finie'
      : !fini && inactif != null && inactif > 30 * 60000 ? 'dort' : 'au repos';
    const rapport = j.lastTurnReport || t.recap || '';
    const surveille = survivantes(t.surv, vivant, MAINTENANT);
    const signal = !surveille.length && ANNONCE.test(`${rapport}\n${p.status_detail || ''}`);
    const x = { id, titre: j.title || t.customTitle || (j.cwd ? path.basename(j.cwd) : '(sans titre)'), cwd: j.cwd, cli: j.cliSessionId, parent: j.spawnedFrom?.sessionId, etat, ancetre: F.ancetres.has(id) && id !== moi,
      inactif: inactif ?? 0, rapport, detail: p.status_detail || '',
      question: p.needs_action || (etat === 'attend' ? t.ask || p.status_detail : ''), rss, vivant, surveille, signal,
      ctx: t.ctx, cout: t.cout, coutReleve: t.coutReleve ?? null, jetons: t.jetons, tours: t.tours, modele: j.model || t.modele, commits: t.commits, reste: t.plan.filter((y) => y.etat !== 'completed'),
      plan: t.plan, fichiers: t.fichiers, demande: t.demande, recap: t.recap, ask: t.ask, creee: j.createdAt, nonCommite: nonCommite(j, t.fichiers), partiel: t.partiel, archivee: !!j.isArchived };
    Object.defineProperty(x, '_t', { value: t, enumerable: false });
    L.push(x);
  }
  for (const x of L) x.fillesActives = L.filter((y) => y.parent === x.id && ['travaille', 'attend'].includes(y.etat)).length;
  for (const x of L) [x.tri, x.raison] = trier(x);
  sauverCache();
  const archivees = AVEC_ARCHIVEES ? 0 : [...F.membres].filter((id) => S.get(id)?.isArchived).length;
  const moiX = L.find((x) => x.id === moi);
  const titreRacine = S.get(F.racine)?.title || '';
  return { L, M, racine: F.racine, moi, archivees, titreRacine, titreTableau: titreRacine || moiX?.titre || path.basename(DOSSIER) };
}

// ── La note de contexte : assez pour reprendre sans rien relire. `ecrire: false` ne donne que le chemin.
function dossierNotes(cwd) {
  const projet = cwd && projetCoffre(cwd);
  return projet ? path.join(projet, 'Journal/Sessions') : path.join(CACHE, 'notes');
}
function note(x, ecrire = true, relance = false) {
  const dossier = dossierNotes(x.cwd);
  const jour = jourDe();
  const fichier = path.join(dossier, `${jour}-reprise-${slug(x.titre)}-${x.id.slice(6, 14)}.md`);
  if (!ecrire) return fichier;
  if (relance && fs.existsSync(fichier)) return fichier;   // la note de relance s'écrit une fois ; la session la complète
  completer(x);
  fs.mkdirSync(dossier, { recursive: true });
  const branche = x.cwd ? brancheDe(x.cwd) : '';
  const fait = x.plan.filter((y) => y.etat === 'completed');
  const t = ['---', `titre: "Reprise — ${x.titre.replace(/"/g, '\'')}"`, 'type: reprise', `date: ${jour}`, `session: ${x.id}`, `cli_session: ${x.cli}`,
    `dossier: "${x.cwd}"`, `modele: ${x.modele}`, `tours: ${x.tours ?? 'n/a'}`, `contexte: ${x.ctx}`, `cout_usd: ${x.cout == null ? 'n/a' : x.cout.toFixed(2)}`, relance ? `relance: ${jour}` : `archivee: ${jour}`, '---',
    `# Reprise — ${x.titre}`, '',
    relance ? `Note écrite le ${jour} par le hook \`poids-de-session\` : la session relit ${k(x.ctx)} jetons par tour et se relance, neuve, à partir de cette note. La session d'origine la complète (décisions, chiffres, pièges) avant de passer la main ; ${x.tours ?? 'n/a'} tours, ${$(x.cout)} aux prix publics.` : `Session archivée le ${jour} par \`/orch ranger\` après ${age(MAINTENANT - (x.creee || MAINTENANT))} de vie et ${x.tours ?? 'n/a'} tours (${k(x.ctx)} jetons de contexte, ${$(x.cout)} aux prix publics). État au rangement : ${x.etat}.`, '',
    '## Ce qui est fait', '', x.rapport ? `> ${x.rapport.replace(/\n+/g, '\n> ')}` : '- (aucun rapport de fin de tour)', '',
    ...(fait.length ? ['Étapes terminées :', ...fait.map((y) => `- [x] ${y.quoi}`), ''] : []),
    `Commits (${x.commits.length}) :`, ...(x.commits.length ? x.commits.map((c) => `- \`${c.sha}\` ${c.msg} — \`${(c.dossier || '').replace(MAISON, '~')}\`, branche \`${c.branche}\``) : ['- aucun commit fait par cette session']), '',
    `Fichiers touchés (${x.fichiers.length}) :`, ...x.fichiers.slice(0, 25).map((f) => `- \`${f.replace(MAISON, '~')}\``), ...(x.fichiers.length > 25 ? [`- … et ${x.fichiers.length - 25} autres`] : []), '',
    ...(x.surveille?.length ? ['## Ce qui tourne encore sans la session', '', ...x.surveille.map((v) => `- ${v}`), ''] : []),
    '## Ce qui reste à faire', '',
    ...(x.reste.length ? x.reste.map((y) => `- [ ] ${y.quoi}`) : ['- rien d’annoncé dans le plan de la session']),
    ...(x.question ? ['', `Question restée ouverte : ${x.question}`] : x.ask ? ['', `Dernière question posée : ${x.ask}`] : []),
    ...(x.etat === 'interrompue' ? ['', 'Le dernier tour n’a pas été mené à son terme (outil sans résultat ou message sans réponse) : vérifier l’état des fichiers avant de reprendre.'] : []),
    ...(x.detail ? ['', `Dernier état noté par l’app : ${x.detail}`] : []), '',
    '## Dernière demande reçue', '', '> ' + court(x.demande, 600), '',
    '## Comment reprendre', '',
    ...(relance ? [`Prompt de la session neuve : « Lis ${fichier.replace(MAISON, '~')} et reprends là où elle s'arrête : vérifie d'abord l'état des fichiers et des commits, puis enchaîne sur « Ce qui reste à faire ». »`, ''] : []),
    relance ? `1. Dans l’app : la session « ${x.titre} » reste ouverte avec tout son contexte (\`${x.id}\`).` : `1. Dans l’app : la session « ${x.titre} » est dans les archives ; la désarchiver (\`unarchive_session\` \`${x.id}\`) la rouvre avec tout son contexte.`,
    `2. En terminal : \`cd ${(x.cwd || '').replace(MAISON, '~')} && claude --resume ${x.cli}\`${branche ? ` (branche \`${branche}\`)` : ''}.`,
    '3. Plus léger : une session neuve avec pour seul brief cette note — le contexte repart de zéro au lieu de ' + k(x.ctx) + ' jetons.', ''];
  fs.writeFileSync(fichier, t.join('\n'));
  return fichier;
}

// ── La note commune : une page pour la session qui reprend, une section par session rangée.
function noteCommune(I, cible, faites, gardees, ecrire) {
  const cx = I.L.find((x) => x.id === cible);
  const dossier = dossierNotes(cx?.cwd || I.L.find((x) => x.id === I.moi)?.cwd || DOSSIER);
  const jour = jourDe();
  const fichier = path.join(dossier, `${jour}-reprise-commune-${slug(I.titreRacine || I.titreTableau)}-${id8(cible)}.md`);
  if (!ecrire) return fichier;
  fs.mkdirSync(dossier, { recursive: true });
  const t = ['---', `titre: "Reprise commune — ${(I.titreRacine || I.titreTableau).replace(/"/g, '\'')}"`, 'type: reprise-commune', `date: ${jour}`, `session_cible: ${cible}`, `sessions: ${faites.length}`, '---',
    `# Reprise commune — ${I.titreRacine || I.titreTableau}`, '',
    `${faites.length} session(s) de la famille rangées le ${jour} par \`/orch ranger tout\`. Chacune a sa note de reprise ; cette page dit, pour chacune, ce qui attend une réponse et ce qui reste à faire. La session ${id8(cible)} reprend le tout.`, '',
    ...faites.flatMap(({ x, f }) => [`## ${x.titre} (${id8(x.id)})`, '',
      `- État au rangement : ${x.etat}, inactive depuis ${age(x.inactif)}.`,
      `- ${x.question ? 'Question en attente' : x.ask ? 'Feu vert ou question demandée' : 'Question en attente'} : ${x.question || x.ask || 'aucune'}`,
      `- Note de reprise : [[${path.basename(f, '.md')}]]`,
      `- Reste à faire : ${x.reste.length ? x.reste.slice(0, 6).map((y) => y.quoi).join(' ; ') + (x.reste.length > 6 ? ` ; … et ${x.reste.length - 6} autre(s)` : '') : 'rien d’annoncé dans le plan'}`, '']),
    ...(gardees.length ? ['## Sessions laissées ouvertes', '', ...gardees.map((g) => `- ${g.x.titre} (${id8(g.x.id)}) : ${g.raison}`), ''] : [])];
  fs.writeFileSync(fichier, t.join('\n'));
  return fichier;
}

// ── Sorties
const out = [];
const lien = (f) => `[${path.basename(f)}](${f.replace(/ /g, '%20')})`;
const ecrirePlan = (P) => { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(PLAN, JSON.stringify(P, null, 1)); };
const resume = (x) => ({ id: x.id, titre: x.titre, rss: x.rss, jetons: x.jetons, cout: x.cout, ctx: x.ctx });
const ORDRE = { travaille: 0, attend: 1, interrompue: 2, 'à relire': 3, 'au repos': 4, dort: 5, finie: 6 };

if (CMD === 'liste') {
  const I = await inventaire();
  if (I.erreur) { console.log(I.erreur); process.exit(0); }
  const { L, M } = I;
  L.sort((a, b) => ORDRE[a.etat] - ORDRE[b.etat] || b.rss - a.rss);
  const A = L.filter((x) => x.tri === 'archiver' || x.tri === 'relancer'), G = L.filter((x) => x.tri === 'garder'), R = L.filter((x) => x.tri === 'relancer');
  const rssA = somme(A, 'rss'), vivantes = L.filter((x) => x.rss).length;
  const ouvertes = L.filter((x) => x.rss && x.tri === 'garder');
  const dorment = L.filter((x) => x.etat === 'dort');
  ecrirePlan({ date: M.date, moi: I.moi, avant: { total: M.total, n: M.n, parSession: M.parSession }, archiver: A.map(resume) });
  if (JSON_) { fs.writeSync(1, JSON.stringify({ L, M, moi: I.moi, titreTableau: I.titreTableau }, null, 1) + '\n'); process.exit(0); }
  const pic = { travaille: '🟢 travaille', attend: '🟠 attend', interrompue: '🔴 interrompue', 'à relire': '🔵 à relire', 'au repos': '⚪ au repos', dort: '💤 dort', finie: '✅ finie' };
  const triPic = { archiver: '🗄 archiver', garder: '📌 garder', relancer: '🔁 relancer' };
  const partiels = L.filter((x) => x.cout == null).length;
  const aRendre = A.filter((x) => x.rss).length
    ? `**${mo(rssA)}** de mémoire vive (${A.filter((x) => x.rss).length} processus) · ${k(somme(A, 'ctx'))} jetons de contexte qui ne seront plus relus`
    : `**0 Mo** : leur mémoire est déjà rendue (processus fermés) · ${k(somme(A, 'ctx'))} jetons de contexte qui ne seront plus relus`;
  out.push(`## 🧹 Ranger l’orchestration — ${court(I.titreTableau, 60)}`, '',
    '| | |', '|---|---|',
    `| **Sessions de la famille** | **${L.length}** ouvertes — ${['travaille', 'attend', 'interrompue', 'à relire', 'finie', 'au repos', 'dort'].map((e) => [e, L.filter((x) => x.etat === e).length]).filter(([, n]) => n).map(([e, n]) => `${n} ${e}`).join(' · ')}${I.archivees ? ` · ${I.archivees} déjà archivée(s)` : ''} |`,
    `| **Mémoire vive, tout Claude Code** | \`${jauge(M.total, os.totalmem() / 1048576, 14)}\` **${mo(M.total)}** sur ${mo(os.totalmem() / 1048576)} — ${M.n} processus \`claude\` sur ce Mac, ${vivantes} de cette famille |`,
    `| **Jetons relus par la famille** | ${k(somme(L, 'jetons'))} · ${$(somme(L, 'cout'))} aux prix publics${partiels ? ` (au moins : ${partiels} transcription(s) énorme(s), total n/a)` : ''} |`,
    `| **Proposé** | 🗄 ${A.length} à archiver · 📌 ${G.length} à garder · 🔁 ${R.length} à relancer |`,
    `| **À rendre en archivant** | ${aRendre} |`,
    `| **Encore ouvertes (gardées)** | ${ouvertes.length ? `${mo(somme(ouvertes, 'rss'))} tenus par ${ouvertes.length} session(s) de la famille` : 'aucune session gardée n’a de processus ouvert'} |`,
    `| **Si les sessions qui dorment s’archivent** | ${dorment.length ? `${dorment.length} session(s) · ${dorment.filter((x) => x.rss).length ? mo(somme(dorment, 'rss')) + ' rendus' : 'mémoire déjà rendue (processus fermés)'}` : 'aucune ne dort'} |`, '',
    '| Session | État | Inactive | Mémoire | Contexte | Coût | Commité | Question | Dernier rapport | Tri |', '|---|---|---|---|---|---|---|---|---|---|',
    ...L.map((x) => `| ${court(x.titre, 42)} | ${pic[x.etat]} | ${x.etat === 'travaille' ? '—' : age(x.inactif)} | ${x.rss ? `\`${jauge(x.rss, 400, 5)}\` ${mo(x.rss)}` : '· fermée'} | \`${jauge(x.ctx, 500000, 5)}\` ${k(x.ctx)} | ${$(x.cout)} | ${x.nonCommite.length ? `✗ ${x.nonCommite.length}` : '✓'} | ${x.question ? '✗ oui' : '✓'} | ${court(x.rapport || x.detail, 55)} | ${triPic[x.tri]} — ${x.raison} |`), '',
    A.length ? `**À archiver (${A.length}, dont ${R.length} à relancer ensuite depuis leur note)** : ${A.map((x) => `${court(x.titre, 40)} \`${x.id.slice(6, 14)}\``).join(' · ')}` : '**Rien à archiver** : toutes les sessions travaillent, attendent, surveillent ou viennent de finir.', '',
    'Avant chaque archivage, une note de reprise est écrite (fait + commits, reste à faire, comment reprendre) ' +
    'dans le coffre du projet quand il y en a un, sinon dans `~/.cache/orchestration/notes/`.',
    `Ids à archiver : ${A.map((x) => x.id).join(' ') || '—'}`,
    `Question à poser (mot pour mot, rien d’autre) : ${A.length ? `Archiver ces ${A.length} sessions ? Une note de reprise est écrite pour chacune avant.` : 'aucune, il n’y a rien à archiver.'}`);
} else if (CMD === 'relance') {
  // Note de relance d'une session trop lourde, même en plein travail ; ne touche pas au plan de rangement.
  const id = IDS[0] || MOI; const I = await inventaire(); if (I.erreur) { console.log(I.erreur); process.exit(0); }
  const x = I.L.find((y) => y.id === id);
  if (!x) { console.log(`\`${id}\` introuvable dans la famille`); process.exit(0); }
  console.log(note(x, true, true)); process.exit(0);
} else if (CMD === 'notes') {
  if (AVEC_ARCHIVEES && !IDS.length) { console.log('`--avec-archivees` demande les ids des sessions à noter : rien n’est écrit sans eux.'); process.exit(0); }
  const P = fs.existsSync(PLAN) ? JSON.parse(fs.readFileSync(PLAN, 'utf8')) : { archiver: [] };
  const voulu = IDS.length ? IDS : P.archiver.map((x) => x.id);
  const I = await inventaire(); if (I.erreur) { console.log(I.erreur); process.exit(0); }
  const ecrites = [];
  for (const id of voulu) {
    const x = I.L.find((y) => y.id === id);
    if (!x) { out.push(`- ✗ \`${id}\` : hors de la famille ou déjà archivée`); continue; }
    if (x.etat === 'travaille' || (x.etat === 'attend' && !AVEC_ARCHIVEES)) { out.push(`- ✗ ${x.titre} : ${x.etat}, pas d’archivage`); continue; }
    if (x.surveille.length && !x.archivee) { out.push(`- ✗ ${x.titre} : 👁 surveille, pas d’archivage`); continue; }  // déjà archivée : la note signale ce qui tourne encore
    const f = note(x); ecrites.push({ id, titre: x.titre, note: f }); out.push(`- ✓ ${x.titre} → ${lien(f)}`);
  }
  if (!AVEC_ARCHIVEES) {   // les notes de sessions déjà archivées ne touchent pas au plan de rangement
    P.notes = ecrites; P.archiver = P.archiver.filter((x) => ecrites.some((e) => e.id === x.id));
    for (const e of ecrites) if (!P.archiver.some((x) => x.id === e.id)) P.archiver.push(resume(I.L.find((y) => y.id === e.id)));
    ecrirePlan(P);
  }
  out.unshift(`### Notes de reprise écrites : ${ecrites.length}`, '');
  out.push('', `Prêtes à archiver : ${ecrites.map((e) => e.id).join(' ') || '—'}`);
} else if (CMD === 'tout') {
  // Le mode « tout archiver, reprendre dans la session active » : une note par session de la famille, une note commune.
  const I = await inventaire(); if (I.erreur) { console.log(I.erreur); process.exit(0); }
  const cible = !REPRISE || REPRISE === 'moi' ? I.moi : REPRISE;
  const faites = [], gardees = [];
  for (const x of I.L) {
    if (x.id === I.moi || x.id === cible) continue;
    const tourne = x.etat === 'travaille' ? 'travaille (processus vivant, activité de moins de 3 min)' : x.surveille.length ? `👁 surveille : ${court(x.surveille[0], 50)}` : '';
    if (tourne) { gardees.push({ x, raison: tourne }); continue; }
    faites.push({ x, f: note(x, !ESSAI) });
  }
  const fc = faites.length ? noteCommune(I, cible, faites, gardees, !ESSAI) : '—';   // rien à ranger : pas de note commune vide
  const verbe = ESSAI ? 'écrirait' : 'écrite';
  ecrirePlan({ date: I.M.date, moi: I.moi, avant: { total: I.M.total, n: I.M.n, parSession: I.M.parSession }, archiver: faites.map(({ x }) => resume(x)),
    notes: faites.map(({ x, f }) => ({ id: x.id, titre: x.titre, note: f })), commune: fc, cible });
  out.push(`### Notes de reprise ${ESSAI ? '(essai : rien n’est écrit)' : 'écrites'} : ${faites.length}`, '',
    ...faites.map(({ x, f }) => `- ${ESSAI ? '·' : '✓'} ${court(x.titre, 60)} (${x.etat}) → ${ESSAI ? f : lien(f)}${ESSAI ? ` (${verbe})` : ''}`), '',
    `Note commune : ${fc}`, `Envoyer à : ${cible}`,
    `Prêtes à archiver : ${faites.map(({ x }) => x.id).join(' ') || '—'}`,
    `Gardées (tournent) : ${gardees.map((g) => `${court(g.x.titre, 50)} (${g.raison})`).join(' · ') || '—'}`);
} else if (CMD === 'bilan') {
  if (!fs.existsSync(PLAN)) { console.log('Pas de rangement en cours : lancer `/orch ranger` d’abord.'); process.exit(0); }
  const P = JSON.parse(fs.readFileSync(PLAN, 'utf8')); const S = magasin(); let M = memoire();
  // Un processus archivé met quelques secondes à s'arrêter : on attend jusqu'à 15 s qu'ils soient tous partis.
  for (let i = 0; i < 15 && P.archiver.some((x) => S.get(x.id)?.isArchived && M.parSession[x.id]); i++) { await new Promise((r) => setTimeout(r, 1000)); M = memoire(); }
  const faits = P.archiver.filter((x) => S.get(x.id)?.isArchived);
  const fermes = faits.filter((x) => P.avant.parSession[x.id] && !M.parSession[x.id]);
  const rendu = fermes.reduce((a, x) => a + P.avant.parSession[x.id], 0);
  const notes = (P.notes || []).filter((n) => faits.some((x) => x.id === n.id));
  out.push('## ✨ Orchestration rangée', '',
    '| | Avant | Après | |', '|---|---|---|---|',
    `| **Sessions archivées** | | | **${faits.length}** sur ${P.archiver.length} prévue(s) |`,
    `| **Processus \`claude\` vivants** | ${P.avant.n} | ${M.n} | ${fermes.length} fermé(s) par l’archivage |`,
    `| **Mémoire vive, tout Claude Code** | ${mo(P.avant.total)} | ${mo(M.total)} | ${rendu ? `\`${jauge(rendu, P.avant.total, 14)}\` **${mo(rendu)} rendus**` : 'rien à rendre : leurs processus étaient déjà fermés'} |`,
    `| **Contexte qui ne sera plus relu** | | | **${k(faits.reduce((a, x) => a + x.ctx, 0))} jetons** |`,
    `| **Ce qu’avaient coûté ces sessions** | | | ${k(somme(faits, 'jetons'))} jetons · ${$(somme(faits, 'cout'))} |`, '',
    `Mesure : RSS par \`ps\` des processus \`claude\` (et de leurs enfants), le ${new Date(P.date).toLocaleString('fr-FR')} puis le ${new Date(M.date).toLocaleString('fr-FR')}. ` +
    'La différence du total compte aussi les sessions qui ont grossi ou démarré entre-temps ; « rendus » ne compte que les processus des sessions archivées.', '',
    `**Notes de reprise (${notes.length})**`, '', ...notes.map((n) => `- ${court(n.titre, 60)} → ${lien(n.note)}`),
    ...(P.commune ? ['', `Note commune : ${lien(P.commune)}`] : []));
  P.apres = { total: M.total, n: M.n, date: M.date, rendu, fermes: fermes.length, archivees: faits.length };
  ecrirePlan(P);
} else if (CMD === 'surveillance') {
  // Outil de test : la surveillance vivante d'une transcription donnée (`--vivant` : un processus de la session tourne).
  const r = await analyser(IDS[0], false);
  console.log(JSON.stringify({ vivantes: survivantes(r.surv, args.includes('--vivant'), MAINTENANT), termine: r.termine, lastUA: r.lastUA }));
} else out.push('Commandes : `liste` (défaut), `notes [ids…]`, `tout --reprise-dans [id]`, `bilan`.');
console.log(out.join('\n'));
