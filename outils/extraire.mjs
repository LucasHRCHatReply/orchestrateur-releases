#!/usr/bin/env node
// Relit les transcriptions Claude Code de ce Mac (~/.claude/projects) et en tire, par session,
// le comportement d'orchestration : sessions lancées, agents, modèle · effort, annonces, échecs
// d'outils, corrections de l'utilisateur, poids du contexte, coût.
//
// Deux sorties :
//   perfs/<compte>/historique.jsonl   partageable : chiffres et noms d'outils seulement, aucun texte
//   .local/extraits-<compte>.jsonl    jamais commité : courts extraits des corrections, pour l'analyse locale
//
// Usage : node outils/extraire.mjs [--depuis 2026-10-20] [--compte nom] [--projets-en-clair] [--sortie fichier]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { dossierDonnees } from './donnees.mjs';

const DEPOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DONNEES = dossierDonnees(DEPOT);
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DEPUIS = arg('--depuis', '2026-10-20');
const COMPTE = arg('--compte', (() => { try { return fs.readFileSync(path.join(DONNEES, 'perfs/.compte'), 'utf8').trim(); } catch { return os.userInfo().username; } })());
const RACINE = path.join(os.homedir(), '.claude/projects');
const LIGNE_MAX = 400 * 1024;
// Un nom de dossier peut nommer un client : il part haché, sauf --projets-en-clair.
const EN_CLAIR = process.argv.includes('--projets-en-clair');
const anonyme = p => EN_CLAIR ? p : 'p-' + crypto.createHash('sha1').update(COMPTE + p).digest('hex').slice(0, 6);

// Prix Anthropic au 06/10/2026 ($/M jetons) : entrée, sortie, lecture du cache (× entrée). Source : skill claude-api,
// tableau « Current Models » et shared/prompt-caching.md. Le modèle exact prime ; la famille sert aux simulations.
export const PRIX = { haiku: [0.10, 0.50, 0.1], sonnet: [2, 10, 0.1], opus: [4, 20, 0.05], fable: [10, 50, 0.025] };
const PRIX_MODELE = [
  [/fable-5-1|mythos-5-1/, [10, 50, 0.025]], [/fable|mythos/, [10, 50, 0.1]],
  [/opus-5-5/, [4, 20, 0.05]], [/opus-4(?!-[5-9])/, [15, 75, 0.1]], [/opus/, [5, 25, 0.1]],
  [/sonnet-4/, [3, 15, 0.1]], [/sonnet/, [2, 10, 0.1]],
  [/haiku-5-5/, [0.10, 0.50, 0.1]], [/haiku/, [1, 5, 0.1]],
];
export const famille = (m = '') => Object.keys(PRIX).find(k => m.includes(k)) || 'autre';
// Coût d'un tour. `m` : l'identifiant du modèle (claude-opus-5-5) ou une famille (opus).
// Écriture du cache : ×1,25 en 5 min, ×2 en 1 h (Claude Code écrit en 1 h). Mode rapide (speed: fast) : ×2.
// Haiku 5.5 au-delà de 100 k jetons de prompt : 0,50 / 2,50 $.
export const cout = (m = '', u = {}) => {
  let p = PRIX[m] || PRIX_MODELE.find(([re]) => re.test(m))?.[1]; if (!p) return 0;
  const lu = u.cache_read_input_tokens || 0, ecrit = u.cache_creation_input_tokens || 0, entree = u.input_tokens || 0;
  if (/haiku-5-5|^haiku$/.test(m) && entree + lu + ecrit > 100000) p = [0.5, 2.5, p[2]];
  const h1 = Math.min(ecrit, u.cache_creation?.ephemeral_1h_input_tokens || 0);
  const e = (entree + (ecrit - h1) * 1.25 + h1 * 2 + lu * p[2]) * p[0] + (u.output_tokens || 0) * p[1];
  return e * (u.speed === 'fast' ? 2 : 1) / 1e6; };
// Une réponse s'écrit en plusieurs lignes (une par bloc de contenu) sous le même message.id ; seule la dernière porte
// la sortie complète. Le compteur garde, par id, la ligne la plus longue et rend l'écart à ajouter (comme ccusage).
export function compteur() {
  const vus = new Map();
  return (id, modele, u) => {
    const avant = id && vus.get(id); const sortie = u.output_tokens || 0;
    if (avant && sortie <= avant.sortie) return null;
    const c = cout(modele, u); if (id) vus.set(id, { sortie, c });
    return { nouveau: !avant, cout: c - (avant?.c || 0), sortie: sortie - (avant?.sortie || 0) };
  };
}
// L'ancienne formule (avant le 02/11/2026), gardée pour mesurer l'écart.
export const coutAncien = (f, u) => { const p = { haiku: [0.10, 0.50, 0.1], sonnet: [2, 10, 0.05], opus: [4, 20, 0.05], fable: [10, 50, 0.05] }[f]; if (!p) return 0;
  return ((u.input_tokens || 0) * p[0] + (u.cache_creation_input_tokens || 0) * p[0] * 1.25
    + (u.cache_read_input_tokens || 0) * p[0] * p[2] + (u.output_tokens || 0) * p[1]) / 1e6; };

// Une correction : l'utilisateur dit que ce qui vient d'être fait n'est pas ce qu'il voulait.
export const CORRECTION = new RegExp([
  String.raw`(?:^|[.!?]\s+)(?:non|no|nope)\b[ ,.!]`,                                   // « Non, … » en tête de phrase (pas « oui ou non »)
  String.raw`\bpas (?:ça|ca|comme ça|ce que)\b`, String.raw`\b(?:n'est|c'est) pas (?:ça|ca|ce que|comme)\b`,
  String.raw`\bj'(?:ai|avais) (?:dit|demandé)`, String.raw`\bje (?:t'ai|te l'ai) (?:déjà )?(?:dit|demandé)`,
  String.raw`\bpourquoi (?:tu|t'as|as-tu)\b`, String.raw`\bt'as (?:pas|oublié)`, String.raw`\btu as oublié`,
  String.raw`\b(?:ne )?(?:marche|fonctionne) (?:toujours )?(?:pas|plus)\b`,                // « ça ne marche pas », « ça marche toujours pas »
  String.raw`\bc'est (?:faux|incorrect|mauvais|pas bon)\b`, String.raw`(?:^|[.!?]\s+)faux\b`,
  String.raw`\bmauvais (?:fichier|dossier|endroit|chemin|nom|r[ée]sultat)\b`,
  String.raw`\b(?:refais|recommence)\b`, String.raw`(?:^|[.!?,]\s*)arr[eê]te\b`,           // pas « comment arrêter le serveur ? »
  String.raw`\bencore une fois (?:non|pas|ça|ca|tu|je|j')`, String.raw`\btoujours pas\b`,
  String.raw`\b(?:that'?s|this is|it'?s) (?:wrong|incorrect|not (?:what|right|correct))\b`, String.raw`\bnot what i\b`,
  String.raw`\b(?:doesn'?t|does not|still not|isn'?t) work`, String.raw`\byou forgot\b`, String.raw`\bi (?:said|asked for)\b`,
].join('|'), 'i');
// Un message que l'utilisateur n'a pas tapé : le résumé d'une reprise, une notification.
export const PAS_HUMAIN = /^\s*(?:This session is being continued|Background \(from the session|Another Claude session sent a message|\[SYSTEM NOTIFICATION)/;
// Une annonce conforme : « nom — modèle · effort — raison »
const ANNONCE = /(haiku|sonnet|opus|fable)(?:[\s-]*\d(?:[.,]\d)?)?\s*[·•\/,(]\s*(?:effort\s*)?(low|medium|high|xhigh|max)\b/i;
// Le verdict sans /retour (02/11/2026) : la dernière série de tests lancée, les commits réussis, les corrections.
const TEST = /^(?:node\s+(?:--test\b|\S*\.test\.m?js)|npm (?:run )?test|pnpm (?:run )?test|yarn test|bun test|npx (?:vitest|jest|playwright test)|(?:python3? -m )?pytest|python3? -m unittest|swift test|xcodebuild\b.*\btest\b|cargo test|go test)/;
// La boucle que suggère hooks/verdict.mjs : for t in …/*.test.*js; do node "$t" …
const TEST_BOUCLE = /\bfor\s+\w+\s+in\s+[^;]*\.test\.[^;]*;\s*do\s+node\b/;
// Une commande Bash en segments (&&, ||, ;, |, retour à la ligne, do/then), chaque segment sans ses préfixes
// (variable=valeur, time, caffeinate, timeout N, parenthèse) et avec le contenu des guillemets vidé :
// « git commit -m "fix pytest" » et « grep "npm test" README.md » ne sont ni tests ni… autre chose que ce qu'ils sont.
export function segments(cmd) {
  const nu = String(cmd).replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
  return { nu, parts: nu.split(/&&|\|\||[;|\n(){]|\b(?:do|then|else)\b/).map(x => x.trim()
    .replace(/^(?:(?:\w+=\S*|time|nohup|sudo|caffeinate(?:\s+-\S+(?:\s+\d+)?)*|timeout\s+\d+\S*)\s+)+/, '')).filter(Boolean) };
}
export const estTest = cmd => { const { nu, parts } = segments(cmd); return TEST_BOUCLE.test(nu) || parts.some(x => TEST.test(x)); };
const TEST_ROUGE = /# fail [1-9]|\bnot ok \d|\b[1-9]\d* (?:failed|failing|échoués?)\b|^FAIL\b|\bTests? failed\b|\*\* TEST FAILED \*\*|AssertionError|✗|✖ /m;
// Un fichier de code (02/11/2026) : ce qu'un test peut vérifier, pas une note ni une page de doc.
export const CODE = /\.(?:m?[jt]sx?|cjs|swift|py|rb|go|rs|kt|java|c|cc|cpp|h|m|sh|astro|vue|svelte)$/;
const COMMIT = /^git(?:\s+(?:-[Cc]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+commit\b/;
export const estCommit = cmd => segments(cmd).parts.some(x => COMMIT.test(x));
export function verdict(v) {
  if (v.tests === 'rouges') return { verdict: 'echec', critere: 'derniers tests rouges' };
  const preuves = [v.tests === 'verts' && 'derniers tests verts', v.commits && `${v.commits} commit${v.commits > 1 ? 's' : ''}`].filter(Boolean);
  if (!preuves.length) return { verdict: 'n/a', critere: 'ni test ni commit' };
  return { verdict: v.corrections ? 'reussi-apres-correction' : 'reussi', critere: preuves.join(', ') + (v.corrections ? `, ${v.corrections} correction${v.corrections > 1 ? 's' : ''}` : '') };
}
const ORCH_MOT = /orchestr|prompt master|lance (?:des|une|les) sessions?|répartis|en parall[eè]le|sessions? filles?/i;

function texteUtilisateur(m) {
  const c = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content || '') }];
  return c.filter(x => x.type === 'text' && x.text && !/^\s*<(?!pasted)/.test(x.text)).map(x => x.text).join('\n');
}

export async function lire(fichier, onEv) {
  const rl = readline.createInterface({ input: fs.createReadStream(fichier), crlfDelay: Infinity });
  for await (const l of rl) { if (!l || l.length > LIGNE_MAX) continue; try { onEv(JSON.parse(l)); } catch {} }
}

// L'analyse est un automate : on lui donne les événements dans l'ordre (onEv) ; son état se sauve (etat) puis se
// reprend (reprise), ce qui laisse le hook Stop ne lire que la fin d'une transcription déjà vue.
export function creerAnalyse(depuis = DEPUIS, reprise = null) {
  const s = { debut: null, fin: null, tours: 0, cout: 0, ctxMax: 0, tours300k: 0, modeles: {}, efforts: {},
    humains: 0, corrections: 0, demandeOrch: 0, annonces: 0, textesAssistant: 0,
    sessions: [], sessionsRefusees: 0, handoffs: 0, agents: [], workflows: 0, toolsearchSession: 0,
    sendMessage: 0, minuteries: 0, notifs: 0, notesReprise: 0, skills: new Set(), erreursOutils: {}, outils: {},
    tests: 'aucun', seriesTests: 0, commits: 0, modifsCode: 0, codeSansTest: 0, dernierCode: '', cwd: '' };
  const extraits = [];
  const compter = compteur(); const appel = new Map(); const surveille = new Map();
  let projet = '';
  if (reprise) { Object.assign(s, reprise.s, { skills: new Set(reprise.s.skills) }); projet = reprise.projet || '';
    for (const [k, v] of reprise.surveille || []) surveille.set(k, v); }
  const onEv = ev => {
    if (ev.timestamp) { if (ev.timestamp < depuis && !s.debut) return; s.debut ??= ev.timestamp; s.fin = ev.timestamp; }
    if (ev.cwd && !projet) projet = path.basename(ev.cwd);
    if (ev.cwd && !ev.isSidechain) s.cwd = ev.cwd;
    if (ev.effort) s.efforts[ev.effort] = (s.efforts[ev.effort] || 0) + 1;
    const m = ev.message; if (!m) return;
    if (ev.type === 'user') {
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c.type === 'tool_result' && surveille.has(c.tool_use_id)) {
          const quoi = surveille.get(c.tool_use_id); surveille.delete(c.tool_use_id);
          const sortie = (Array.isArray(c.content) ? c.content.map(x => x.text || '').join('\n') : String(c.content || '')).slice(-20000);
          if (quoi.includes('test')) { s.seriesTests++; s.codeSansTest = 0; s.tests = c.is_error || TEST_ROUGE.test(sortie) ? 'rouges' : 'verts'; }
          if (quoi.includes('commit') && !c.is_error && !/nothing to commit|no changes added to commit|nothing added to commit|rien à valider/.test(sortie)) s.commits++;
        }
        if (c.type === 'tool_result' && c.is_error) {
          const n = appel.get(c.tool_use_id) || '?'; s.erreursOutils[n] = (s.erreursOutils[n] || 0) + 1;
          if (/start_session$/.test(n)) s.sessionsRefusees++;
        }
      }
      const t = texteUtilisateur(m);
      if (t && !ev.isMeta && !ev.isSidechain && !PAS_HUMAIN.test(t)) {
        s.humains++;
        if (ORCH_MOT.test(t)) s.demandeOrch++;
        if (CORRECTION.test(t.slice(0, 600))) { s.corrections++; extraits.push(t.slice(0, 280).replace(/\s+/g, ' ')); }
      }
      return;
    }
    if (ev.type !== 'assistant') return;
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c.type === 'text' && c.text) { s.textesAssistant++; if (ANNONCE.test(c.text)) s.annonces++; }
      if (c.type !== 'tool_use') continue;
      appel.set(c.id, c.name);
      s.outils[c.name] = (s.outils[c.name] || 0) + 1;
      const i = c.input || {};
      if (/start_session$/.test(c.name)) s.sessions.push({ initiation: i.initiation || 'n/a', contexte: i.context || 'n/a', modele: i.model || 'défaut', worktree: i.use_worktree ?? 'n/a' });
      else if (/hand_off_to_session$/.test(c.name)) s.handoffs++;
      else if (c.name === 'Agent' || c.name === 'Task') s.agents.push({ type: i.subagent_type || 'general-purpose', modele: i.model || 'hérité', effort: i.effort || 'défaut' });
      else if (c.name === 'Workflow') s.workflows++;
      else if (c.name === 'ToolSearch' && /start_session|session/.test(i.query || '')) s.toolsearchSession++;
      else if (c.name === 'SendMessage' || /send_message$/.test(c.name)) s.sendMessage++;
      else if (/CronCreate|ScheduleWakeup|Monitor/.test(c.name)) s.minuteries++;
      else if (c.name === 'Bash' && /notifier\.sh|ntfy/.test(i.command || '')) s.notifs++;
      else if ((c.name === 'Write' || c.name === 'Edit') && /reprise|passation/i.test(i.file_path || '')) s.notesReprise++;
      else if (c.name === 'Skill' && i.skill) s.skills.add(i.skill);
      if (/^(?:Edit|Write|MultiEdit)$/.test(c.name) && !ev.isSidechain && CODE.test(i.file_path || '') && !/\.test\.|\/tests?\//.test(i.file_path)) { s.modifsCode++; s.codeSansTest++; s.dernierCode = i.file_path; }
      if (c.name === 'Bash' && !ev.isSidechain) { const cmd = String(i.command || '');
        const quoi = [estTest(cmd) && 'test', estCommit(cmd) && 'commit'].filter(Boolean);
        if (quoi.length) surveille.set(c.id, quoi); }
    }
    if (!m.usage) return;
    const f = famille(m.model); const u = m.usage; const k = compter(m.id, m.model || f, u); if (!k) return;
    s.cout += k.cout; if (!k.nouveau) return;
    s.tours++; s.modeles[f] = (s.modeles[f] || 0) + 1;
    const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    s.ctxMax = Math.max(s.ctxMax, ctx); if (ctx > 300000) s.tours300k++;
  };
  // Pour la reprise : tout sauf `appel` (l'attribution des erreurs d'outils) et `extraits`, dont le hook n'a pas besoin.
  const etat = () => ({ s: { ...s, skills: [...s.skills] }, projet, surveille: [...surveille] });
  return { s, extraits, onEv, etat, projet: () => projet };
}

export async function analyserSession(fichier, depuis = DEPUIS) {
  const A = creerAnalyse(depuis); const { s, extraits } = A;
  await lire(fichier, A.onEv); const projet = A.projet();
  // Les agents ont leurs propres transcriptions : on ajoute leur coût et leur modèle réel.
  const dossier = path.join(fichier.replace(/\.jsonl$/, ''), 'subagents');
  const agentsReels = {}; let coutAgents = 0;
  if (fs.existsSync(dossier)) for (const f of fs.readdirSync(dossier)) if (f.endsWith('.jsonl')) {
    const c = compteur();
    await lire(path.join(dossier, f), ev => { const m = ev.message; if (ev.type !== 'assistant' || !m?.usage) return;
      const k = c(m.id, m.model || famille(m.model), m.usage); if (!k) return; coutAgents += k.cout;
      if (k.nouveau) { const fa = famille(m.model); agentsReels[fa] = (agentsReels[fa] || 0) + 1; } });
  }
  return { s, extraits, projet, agentsReels, coutAgents };
}

// Lancé directement (et non importé par etat.mjs ou accueil.mjs) : extraction complète.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
const fichiers = [];
for (const d of fs.readdirSync(RACINE)) {
  const p = path.join(RACINE, d); if (!fs.statSync(p).isDirectory()) continue;
  for (const f of fs.readdirSync(p)) if (f.endsWith('.jsonl')) {
    const fp = path.join(p, f); if (fs.statSync(fp).mtime.toISOString().slice(0, 10) >= DEPUIS) fichiers.push(fp);
  }
}
const sortie = arg('--sortie', path.join(DONNEES, 'perfs', COMPTE, 'historique.jsonl'));
const local = path.join(DONNEES, '.local', `extraits-${COMPTE}.jsonl`);
fs.mkdirSync(path.dirname(sortie), { recursive: true }); fs.mkdirSync(path.dirname(local), { recursive: true });
const out = fs.createWriteStream(sortie); const loc = fs.createWriteStream(local);
let n = 0;
for (const f of fichiers) {
  // Toute la transcription, pas seulement la part après --depuis : une session à cheval sur la date de coupe garde sa fiche
  // complète (03/11/2026 : repartagée en fiche partielle, elle écrasait la complète). On filtre sur sa dernière activité.
  const { s, extraits, projet, agentsReels, coutAgents } = await analyserSession(f, '0000');
  if (s.fin && s.fin.slice(0, 10) < DEPUIS) continue;
  n++; if (n % 100 === 0) process.stderr.write(`${n}/${fichiers.length}\n`);
  if (!s.debut || !s.tours) continue;
  const id = path.basename(f, '.jsonl').slice(0, 8);
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] || 'n/a';
  const fiche = { v: 2, compte: COMPTE, session: id, projet: anonyme(projet), debut: s.debut, fin: s.fin,
    duree_min: Math.round((new Date(s.fin) - new Date(s.debut)) / 60000),
    modele: top(s.modeles), effort: top(s.efforts), tours: s.tours,
    cout: +(s.cout + coutAgents).toFixed(2), cout_agents: +coutAgents.toFixed(2),
    contexte_max: s.ctxMax, tours_au_dela_300k: s.tours300k,
    messages_humains: s.humains, corrections: s.corrections, demandes_orchestration: s.demandeOrch,
    textes: s.textesAssistant, annonces_modele_effort: s.annonces,
    sessions_lancees: s.sessions, sessions_refusees: s.sessionsRefusees, handoffs: s.handoffs,
    toolsearch_session: s.toolsearchSession, agents: s.agents, agents_reels: agentsReels,
    workflows: s.workflows, messages_aux_sessions: s.sendMessage, minuteries: s.minuteries,
    notifications: s.notifs, notes_reprise: s.notesReprise, skills: [...s.skills],
    erreurs_outils: s.erreursOutils, series_tests: s.seriesTests, tests_fin: s.tests, commits: s.commits,
    modifs_code: s.modifsCode, code_sans_test_a_la_fin: s.codeSansTest,
    ...verdict(s),
    outils: Object.fromEntries(Object.entries(s.outils).sort((a, b) => b[1] - a[1]).slice(0, 15)) };
  out.write(JSON.stringify(fiche) + '\n');
  for (const e of extraits) loc.write(JSON.stringify({ session: id, projet, extrait: e }) + '\n');
}
out.end(); loc.end();
console.log(`${fichiers.length} transcriptions lues → ${sortie}`);
}
