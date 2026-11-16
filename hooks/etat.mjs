#!/usr/bin/env node
// Hook d'état (SessionStart, UserPromptSubmit, PostToolUse, Stop, SubagentStart, SubagentStop, Notification) : chaque session écrit
// elle-même ce qu'elle fait, sans modèle, dans ~/.cache/orchestration/etat/<session>.jsonl. outils/suivi.mjs l'agrège.
// Ce qui s'écrit : l'événement, l'heure, le nom de l'outil et sa cible résumée en 80 caractères (fichier, commande,
// adresse) ; au Stop, les 400 premiers caractères du dernier message et le contexte du tour. Jamais la sortie d'un
// outil, jamais un secret reconnaissable (masqué). Ne décide rien, ne bloque jamais, sort toujours en 0.
// La clé de session est l'id de l'app (local_…) s'il existe, sinon l'id CLI : un hook ne connaît pas son orchestratrice ;
// suivi.mjs regroupe les familles (étiquette ORCH_ORCHESTRATION posée au lancement, ou famille lue par bureau.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DOSSIER = () => process.env.ORCH_ETAT || path.join(process.env.ORCH_CACHE || path.join(os.homedir(), '.cache', 'orchestration'), 'etat');
const PLAFOND = 512 * 1024;   // au-delà, le fichier garde ses 500 dernières lignes

// La clé d'une session est toujours son id CLI (session_id du hook, CLAUDE_CODE_SESSION_ID dans ses commandes) : un
// `claude -p` lancé depuis une session de l'app hérite de CLAUDE_CODE_HOST_SESSION_ID, CLAUDE_CODE_ENTRYPOINT et
// CLAUDE_CODE_CHILD_SESSION, y compris dans ses hooks (mesuré le 16/11/2026 : l'orchestratrice et ses filles CLI écrivaient
// dans le même fichier). L'id de l'app ne sert qu'au lien « ouvrir la session », et seulement s'il n'est pas hérité
// (CLAUDE_CODE_SESSION_ATTENDED vaut 0 dans un `claude -p` enfant).
export const idApp = (env = process.env) => env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop' && env.CLAUDE_CODE_SESSION_ATTENDED !== '0' ? (env.CLAUDE_CODE_HOST_SESSION_ID || '') : '';
export const cleDeSession = (env = process.env, sessionId = '') => String(sessionId || env.CLAUDE_CODE_SESSION_ID || '').replace(/[^\w.-]/g, '');

// Masque ce qui ressemble à un secret avant toute écriture.
export function masquer(t = '') {
  return String(t)
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 •••')
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '$1-•••')
    .replace(/\b(gh[pousr]|glpat|xox[abp])[-_][A-Za-z0-9_-]{8,}/g, '$1-•••')
    .replace(/\b(api[_-]?key|token|secret|password|passwd|mot[_-]?de[_-]?passe|authorization)(["']?\s*[:=]\s*|\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1$2•••')
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 •••')
    .replace(/https?:\/\/[^\s/:@]+:[^\s/@]+@/g, 'https://•••@');
}
const court = (t = '', n = 80) => { const s = masquer(String(t).replace(/\s+/g, ' ').trim()); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// La cible d'un appel d'outil, en une ligne : jamais son contenu.
export function cible(nom = '', e = {}) {
  const i = e || {};
  const maison = os.homedir();
  const chemin = (p) => String(p || '').replace(maison, '~');
  if (i.file_path || i.notebook_path) return court(chemin(i.file_path || i.notebook_path));
  if (i.command) return court(i.command);
  if (i.url) return court(i.url);
  if (i.pattern) return court(`${i.pattern}${i.path ? ' dans ' + chemin(i.path) : ''}`);
  if (i.description) return court(i.description);
  if (i.title) return court(i.title);
  if (i.query) return court(i.query);
  if (i.to) return court('→ ' + i.to);
  return '';
}

// « Critère de fin : … » ou « C'est fini quand : … » dans un brief.
export function critereDe(t = '') {
  const m = /(?:crit[eè]re de fin|c['’]est fini quand)\s*[:：]?\s*\n?\s*(?:[-*]\s*)?([^\n]{3,})/i.exec(String(t));
  return m ? court(m[1], 200) : '';
}

// Le dernier message de l'assistant et le contexte du dernier appel, lus à la fin de la transcription (200 Ko au plus).
export function finDeTranscription(f) {
  try {
    const st = fs.statSync(f); const n = Math.min(st.size, 200 * 1024);
    const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, st.size - n); fs.closeSync(fd);
    const lignes = b.toString('utf8').split('\n').reverse();
    let texte = '', contexte = null, modele = '';
    for (const l of lignes) {
      if (!l.includes('"assistant"')) continue;
      let j; try { j = JSON.parse(l); } catch { continue; }
      const m = j.message; if (j.type !== 'assistant' || !m) continue;
      if (contexte === null && m.usage) { const u = m.usage; contexte = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); modele = m.model || ''; }
      if (!texte && Array.isArray(m.content)) texte = m.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ');
      if (texte && contexte !== null) break;
    }
    return { texte, contexte, modele };
  } catch { return { texte: '', contexte: null, modele: '' }; }
}

// L'événement à écrire pour une entrée de hook, ou null.
export function ligneDe(e, env = process.env, maintenant = new Date()) {
  const ev = e.hook_event_name;
  const base = { t: maintenant.toISOString(), ev };
  if (env.ORCH_ORCHESTRATION) base.orch = court(env.ORCH_ORCHESTRATION, 80);
  if (ev === 'SessionStart') return { ...base, cli: e.session_id || '', app: idApp(env),
    fille: env.CLAUDE_CODE_CHILD_SESSION === '1', modele: e.model || env.ANTHROPIC_MODEL || '', effort: env.CLAUDE_EFFORT || '',
    dossier: String(e.cwd || '').replace(os.homedir(), '~'), source: e.source || '' };
  if (ev === 'UserPromptSubmit') { const c = critereDe(e.prompt); return { ...base, ...(c ? { critere: c } : {}) }; }
  if (ev === 'PostToolUse' || ev === 'PostToolUseFailure') {
    const l = { ...base, outil: e.tool_name || '', cible: cible(e.tool_name, e.tool_input), ...(ev === 'PostToolUseFailure' ? { echec: true } : {}) };
    if (e.agent_id) l.agent = court(e.agent_id, 60);   // l'appel vient d'un sous-agent de cette session (mesuré le 16/11 : agent_id présent)
    const r = e.tool_response;   // outil Agent : agentId, description, resolvedModel, isAsync
    if (/^(Agent|Task)$/.test(e.tool_name || '') && r && typeof r === 'object' && r.agentId) l.agentLance = { id: court(r.agentId, 60), description: court(r.description || e.tool_input?.description || '', 80), modele: r.resolvedModel || e.tool_input?.model || '', async: !!r.isAsync };
    return l;
  }
  if (ev === 'SubagentStart') return { ...base, agent: court(e.agent_id || '', 60), type: court(e.agent_type || '', 40) };
  if (ev === 'Stop') {
    const f = finDeTranscription(e.transcript_path || '');
    const texte = e.last_assistant_message || f.texte;
    // background_tasks : une fin de tour avec une tâche de fond en cours n'est pas une fin (mesuré le 16/11 : une fille Haiku
    // lance `sleep` en arrière-plan et rend la main en attendant sa notification). session_crons : les minuteries de la session.
    const fond = (Array.isArray(e.background_tasks) ? e.background_tasks : []).filter((b) => b && b.status === 'running').length;
    const crons = Array.isArray(e.session_crons) ? e.session_crons.length : 0;
    return { ...base, message: court(texte, 400), contexte: f.contexte, ...(f.modele ? { modele: f.modele } : {}), ...(fond ? { enFond: fond } : {}), ...(crons ? { minuteries: crons } : {}) };
  }
  if (ev === 'SubagentStop') return { ...base, agent: court(e.agent_id || '', 60), type: court(e.agent_type || '', 40), message: court(e.last_assistant_message || '', 400) };
  if (ev === 'Notification') return { ...base, type: String(e.notification_type || ''), message: court(e.message || '', 200) };
  return null;
}

export function ecrire(e, env = process.env) {
  const cle = cleDeSession(env, e.session_id);
  if (!cle) return null;
  const l = ligneDe(e, env); if (!l) return null;
  fs.mkdirSync(DOSSIER(), { recursive: true });
  const f = path.join(DOSSIER(), cle + '.jsonl');
  fs.appendFileSync(f, JSON.stringify(l) + '\n');
  try { if (fs.statSync(f).size > PLAFOND) { const L = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    const t = f + '.' + process.pid; fs.writeFileSync(t, L.slice(0, 1).concat(L.slice(-500)).join('\n') + '\n'); fs.renameSync(t, f); } } catch {}
  return f;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { const brut = fs.readFileSync(0, 'utf8'); ecrire(JSON.parse(brut || '{}')); } catch {}
  process.exit(0);
}
