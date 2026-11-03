#!/usr/bin/env node
// L'état de l'orchestration en cours, lu dans la transcription de la session courante.
// Sert les commandes du skill /orch. Sortie en Markdown, que Claude recopie telle quelle.
//
// Usage : node outils/etat.mjs [tableau|sessions|agents|poids|cout|regles|bilan [jours]|conseil] [--session id] [--dossier chemin]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { analyserSession, lire, famille, cout } from './extraire.mjs';

const SONNET = 'claude-sonnet-5-5';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const JSON_ = args.includes('--json') && args.splice(args.indexOf('--json'), 1);
const ID = opt('--session'); const DOSSIER = opt('--dossier') || process.cwd();
const [CMD = 'tableau', PARAM] = args;
const RACINE = path.join(os.homedir(), '.claude/projects');

// ── Trouver la transcription de la session courante : la plus récente du dossier de travail.
const enc = (d) => d.replace(/[^A-Za-z0-9]/g, '-');
function transcriptionCourante() {
  const dirs = fs.existsSync(RACINE) ? fs.readdirSync(RACINE).map((d) => path.join(RACINE, d)) : [];
  const cand = [];
  for (const d of dirs) {
    if (!ID && path.basename(d) !== enc(DOSSIER)) continue;
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith('.jsonl') && (!ID || f.startsWith(ID))) cand.push(path.join(d, f));
  }
  return cand.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

// ── Mise en forme
const k = (n) => n >= 1000 ? `${Math.round(n / 1000)} k` : String(n);
const $ = (n) => `${n.toFixed(2).replace('.', ',')} $`;
const jauge = (v, max, l = 20) => { const p = Math.min(1, v / max); const n = Math.round(p * l); return '█'.repeat(n) + '░'.repeat(l - n); };
const nom = (m = '') => ({ haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' })[famille(m)] || (m === 'défaut' ? 'défaut ⚠︎' : m || 'défaut ⚠︎');
const duree = (min) => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
const heure = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const compter = (l, f) => l.reduce((o, x) => { const c = f(x); o[c] = (o[c] || 0) + 1; return o; }, {});
const enLigne = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n} ${c}`).join(' · ') || '—';

// ── Le détail des lancements (titres, ids, refus) : une lecture de plus, légère.
async function lancements(fichier) {
  const appels = new Map(); const sessions = []; const agents = []; const minuteries = []; let ctx = 0; let dernier = null; const usages = new Map(); let sansId = 0; const enCours = new Set(); let pic = 0;   // pic : agents lancés et pas encore rendus, au plus haut
    // usages : une entrée par réponse (la ligne la plus longue), pour re-chiffrer au tarif d'un autre modèle
  await lire(fichier, (ev) => {
    const m = ev.message; if (!m) return;
    if (ev.type === 'assistant') {
      if (m.usage) { ctx = (m.usage.input_tokens || 0) + (m.usage.cache_read_input_tokens || 0) + (m.usage.cache_creation_input_tokens || 0); dernier = m.model;
        const id = m.id || `?${sansId++}`, av = usages.get(id); if (!av || (m.usage.output_tokens || 0) > (av.u.output_tokens || 0)) usages.set(id, { modele: m.model || '', u: m.usage }); }
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c.type !== 'tool_use') continue; const i = c.input || {};
        if (/start_session$/.test(c.name)) { const s = { titre: i.title || i.proposal_id || '(sans titre)', modele: i.model || 'défaut', initiation: i.initiation || '', worktree: i.use_worktree, heure: ev.timestamp, etat: 'en attente de réponse' }; sessions.push(s); appels.set(c.id, s); }
        else if (c.name === 'Agent' || c.name === 'Task') { const a = { description: i.description || '', modele: i.model || 'hérité', fond: !!i.run_in_background, heure: ev.timestamp, etat: 'lancé' }; agents.push(a); appels.set(c.id, a); enCours.add(c.id); pic = Math.max(pic, enCours.size);
          if (a.fond) a.idTache = c.id; }
        else if (/CronCreate|ScheduleWakeup/.test(c.name)) minuteries.push({ quoi: c.name, heure: ev.timestamp });
      }
    } else if (ev.type === 'user') {
      const brut = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content : []).map((x) => (x.type === 'text' ? x.text : '') || '').join('\n');
      if (brut.includes('<tool-use-id>')) for (const [, id] of brut.matchAll(/<tool-use-id>([^<]+)<\/tool-use-id>/g)) enCours.delete(id);   // fin d'un agent en fond
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c.type !== 'tool_result' || !appels.has(c.tool_use_id)) continue;
        const o = appels.get(c.tool_use_id); if (!o.fond) enCours.delete(c.tool_use_id);
        const t = (Array.isArray(c.content) ? c.content.map((x) => x.text || '').join(' ') : String(c.content || '')).slice(0, 2000);
        if (c.is_error) { o.etat = 'refusé'; o.raison = t.replace(/\s+/g, ' ').slice(0, 90); }
        else if ('titre' in o) { const id = t.match(/local_[A-Za-z0-9_-]+/); o.etat = /proposal|proposition|card/i.test(t) && !id ? 'carte proposée' : 'lancée'; o.id = id?.[0]; }
        else o.etat = 'rendu';
      }
    }
  });
  return { sessions, agents, minuteries, ctx, dernier, usages: [...usages.values()], picAgents: pic };
}

// Le rapport réel Sonnet / modèle courant, sur l'usage de la conversation (cache compris), aux prix de extraire.mjs.
// Pas de facteur fixe : le cache lu coûte autant sur Opus 5.5 que sur Sonnet 5.5, donc une session dominée par le cache
// gagne bien moins que la moitié.
export function comparaisonSonnet(L, coutConversation) {
  const reel = L.usages.reduce((x, { modele, u }) => x + cout(modele, u), 0);
  const sonnet = L.usages.reduce((x, { u }) => x + cout(SONNET, u), 0);
  const entete = `Modèle de cette conversation : ${nom(L.dernier || '')}.`;
  if (!reel) return `${entete} Pas d'usage chiffrable dans la transcription.`;
  const jetons = L.usages.reduce((o, { u }) => { o.cache += u.cache_read_input_tokens || 0; o.total += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); return o; }, { cache: 0, total: 0 });
  const part = jetons.total ? `${Math.round(100 * jetons.cache / jetons.total)} % des jetons lus viennent du cache` : '';
  const rapport = reel / sonnet;
  if (Math.abs(rapport - 1) < 0.02) return `${entete} Au tarif de Sonnet 5.5 le même usage (jetons d'entrée, de sortie et de cache réels) coûterait la même chose : ${$(sonnet)}${part ? ` (${part})` : ''}.`;
  return `${entete} Le même usage (jetons d'entrée, de sortie et de cache réels) au tarif de Sonnet 5.5 : ${$(sonnet)} au lieu de ${$(reel)}, soit ${(rapport > 1 ? rapport : 1 / rapport).toFixed(2).replace('.', ',')} fois ${rapport > 1 ? 'moins' : 'plus'}${part ? ` (${part})` : ''}. Calcul sur la conversation, agents exclus${Math.abs(reel - coutConversation) > 0.01 * Math.max(reel, 1) ? ` ; écart de ${$(Math.abs(reel - coutConversation))} avec le coût ci-dessus (mode rapide, lignes en double)` : ''}.`;
}

// ── Les règles du skill, vérifiées sur la session (✓ tenue, ✗ manquée, · sans objet)
function regles(s, L) {
  const lancees = L.sessions.filter((x) => x.etat !== 'refusé');
  const out = [];
  const r = (ok, texte, aide) => out.push(`${ok === null ? '·' : ok ? '✓' : '✗'} ${texte}${ok === false && aide ? ` — ${aide}` : ''}`);
  const orch = s.demandeOrch > 0 || L.sessions.length > 0;
  r(orch ? L.sessions.length > 0 || s.toolsearchSession > 0 : null, 'des sessions lancées quand on en demande', 'charger start_session par ToolSearch (§ 1)');
  r(L.sessions.length ? L.sessions.every((x) => x.modele !== 'défaut') : null, 'un modèle explicite pour chaque session', `${L.sessions.filter((x) => x.modele === 'défaut').length} sans modèle (§ 3)`);
  r(orch ? s.annonces > 0 : null, 'l’annonce modèle · effort faite', 'tableau Session · Modèle · effort · Pourquoi · Critère (§ 3)');
  const longue = s.debut && (new Date(s.fin) - new Date(s.debut)) / 60000 > 15;
  r(orch && longue ? L.minuteries.length > 0 : null, 'un point armé par minuterie', '/point 5 (§ 5)');
  r(L.ctx > 200000 ? s.notesReprise > 0 : null, 'une note de reprise au-delà de 200 k', 'écrire la note, relancer (§ 6)');
  r(L.agents.length ? L.picAgents <= 20 : null, '20 agents en cours au plus', `${L.picAgents} en même temps au pic : vagues de 20 (§ 2 c)`);
  r(L.sessions.length ? L.sessions.filter((x) => x.etat === 'refusé').length === 0 : null, 'aucun lancement refusé', 'voir le tableau des refus (§ 2 a)');
  const tenues = out.filter((l) => l.startsWith('✓')).length, jugees = out.filter((l) => !l.startsWith('·')).length;
  return { lignes: out, score: jugees ? `${tenues}/${jugees}` : 'n/a' };
}

function poids(ctx) {
  const reste = ctx > 100000 ? Math.floor(3300000 / (ctx - 100000)) : null;
  const verdict = ctx >= 500000 ? '🔴 relancer tout de suite avec une note de reprise'
    : ctx >= 300000 ? '🟠 relancer à la fin de cette étape'
    : ctx >= 200000 ? '🟡 préparer la note de reprise' : '🟢 léger';
  return [`\`${jauge(ctx, 500000)}\` **${k(ctx)}** / 500 k jetons de contexte — ${verdict}`,
    `Seuils : 200 k avertir · 300 k relancer · 500 k tout de suite. ${reste ? `Relancer devient rentable si l’étape demande encore plus de **${reste} tours** (3,3 M ÷ (contexte − 100 k)).` : 'Sous 100 k, chaque tour coûte peu : continuer.'}`];
}

// ── Bilan sur plusieurs jours, toutes sessions de ce Mac
async function bilan(jours) {
  const depuis = new Date(Date.now() - jours * 864e5).toISOString().slice(0, 10);
  const fichiers = [];
  for (const d of fs.existsSync(RACINE) ? fs.readdirSync(RACINE) : []) {
    const p = path.join(RACINE, d); if (!fs.statSync(p).isDirectory()) continue;
    for (const f of fs.readdirSync(p)) if (f.endsWith('.jsonl') && fs.statSync(path.join(p, f)).mtime.toISOString().slice(0, 10) >= depuis) fichiers.push(path.join(p, f));
  }
  const L = [];
  for (const f of fichiers) { const r = await analyserSession(f, depuis); if (r.s.tours) L.push(r); }
  const tot = L.reduce((a, r) => a + r.s.cout + r.coutAgents, 0);
  const parModele = {};
  for (const r of L) { const m = Object.entries(r.s.modeles).sort((a, b) => b[1] - a[1])[0]?.[0] || 'autre'; parModele[m] ??= { n: 0, c: 0 }; parModele[m].n++; parModele[m].c += r.s.cout + r.coutAgents; }
  const lourdes = L.filter((r) => r.s.ctxMax > 300000);
  const coutLourdes = lourdes.reduce((a, r) => a + r.s.cout + r.coutAgents, 0);
  const orch = L.filter((r) => r.s.demandeOrch > 0);
  const lanc = L.flatMap((r) => r.s.sessions);
  return { depuis, n: L.length, fichiers: fichiers.length, tot, parModele, lourdes: lourdes.length, relancees: lourdes.filter((r) => r.s.notesReprise > 0).length,
    partLourdes: tot ? coutLourdes / tot : 0, orch: orch.length, orchSansSession: orch.filter((r) => !r.s.sessions.length).length,
    lancees: lanc.length, sansModele: lanc.filter((x) => x.modele === 'défaut').length, refus: L.reduce((a, r) => a + r.s.sessionsRefusees, 0),
    agents: L.reduce((a, r) => a + r.s.agents.length, 0), annonces: orch.filter((r) => r.s.annonces > 0).length };
}

const CONSEIL = `| Ce que fait la session | Modèle · effort | Mesure (206 essais du 20/10/2026) |
|---|---|---|
| Lire, chercher, trier, compter, extraire en JSON | **Haiku · medium** | extraction 1,00 · à \`low\` 0,50 · 1/15 du prix de Sonnet |
| Question courte, commande à rappeler | **Haiku · low** | 6/6 à tous les niveaux, 0,001 $ |
| Code, script, bug localisé, rédaction libre | **Sonnet · low → medium** | script 1,00 · \`high\` n’apporte rien (0,92) |
| Captures, comparaison d’images | **Sonnet · low** | 10/10 écarts · Haiku 7 à 9/10 |
| Décider, concevoir, arbitrer, orchestrer | **Opus · medium** | n’a battu Sonnet sur aucune tâche mesurée, 2 × le prix |
| Bloqué après 2 tentatives | **Opus · high** puis xhigh | sur accord · jamais \`max\` |

Monter le **modèle** avant l’effort : sur 11 tâches, un effort plus haut n’a jamais corrigé un échec de modèle.`;

// ── Commandes
const f = ['bilan', 'conseil'].includes(CMD) ? null : transcriptionCourante();
if (!f && !['bilan', 'conseil'].includes(CMD)) { console.log('Aucune transcription trouvée pour ce dossier. Passer `--session <id>` ou `--dossier <chemin>`.'); process.exit(0); }
const out = [];
if (CMD === 'conseil') out.push('### Quel modèle, quel effort', '', CONSEIL);
else if (CMD === 'bilan') {
  const j = Number(PARAM) || 30; const b = await bilan(j);
  if (JSON_) { console.log(JSON.stringify(b)); process.exit(0); }
  const pct = (a, n) => n ? `${Math.round((100 * a) / n)} %` : 'n/a';
  out.push(`### Bilan des ${j} derniers jours — ${b.n} sessions sur ce Mac, ${$(b.tot)} aux prix publics`, '',
    '| Modèle principal | Sessions | Coût | Part du coût |', '|---|---|---|---|',
    ...Object.entries(b.parModele).sort((a, c) => c[1].c - a[1].c).map(([m, v]) => `| ${nom(m)} | ${v.n} | ${$(v.c)} | \`${jauge(v.c, b.tot, 12)}\` ${pct(v.c, b.tot)} |`), '',
    '| Ce que mesure le skill | Chez vous | Mesuré à la v1 |', '|---|---|---|',
    `| Demandes d’orchestration sans aucune session | ${b.orchSansSession} / ${b.orch} | 25 / 45 |`,
    `| Lancements sans modèle explicite | ${pct(b.sansModele, b.lancees)} (${b.lancees} lancements) | 26 % |`,
    `| Lancements refusés | ${pct(b.refus, b.lancees + b.refus)} | 14 % |`,
    `| Orchestrations avec annonce modèle · effort | ${pct(b.annonces, b.orch)} | 24 % |`,
    `| Sessions au-delà de 300 k jetons | ${b.lourdes}, dont ${b.relancees} relancées avec une note | 59, dont 20 |`,
    `| Part du coût dépensée au-delà de 300 k | ${pct(b.partLourdes, 1)} | 76 % |`,
    `| Agents lancés | ${b.agents} | — |`, '', `Source : ${b.fichiers} transcriptions de \`~/.claude/projects\` modifiées depuis le ${b.depuis}.`);
} else {
  const { s, coutAgents, projet } = await analyserSession(f, '2000-01-01');
  const L = await lancements(f);
  const R = regles(s, L);
  const debut = s.debut ? `depuis ${heure(s.debut)} (${duree(Math.round((new Date(s.fin) - new Date(s.debut)) / 60000))})` : '';
  const tSessions = ['| Session | Modèle | Lancée | État | Id |', '|---|---|---|---|---|',
    ...L.sessions.map((x) => `| ${x.titre} | ${nom(x.modele)} | ${heure(x.heure)} | ${x.etat === 'refusé' ? `❌ refusé : ${x.raison}` : x.etat} | ${x.id ? `\`${x.id}\`` : '—'} |`)];
  const tAgents = ['| Agent | Modèle | Lancé | En fond | État |', '|---|---|---|---|---|',
    ...L.agents.slice(-25).map((x) => `| ${x.description} | ${nom(x.modele)} | ${heure(x.heure)} | ${x.fond ? 'oui' : 'non'} | ${x.etat} |`)];
  if (CMD === 'sessions') out.push(`### Sessions lancées par cette orchestration : ${L.sessions.filter((x) => x.etat !== 'refusé').length}`, '', L.sessions.length ? tSessions.join('\n') : 'Aucune.', '', 'L’état ci-dessus est celui du lancement ; l’état en direct se lit avec `list_sessions` (app de bureau).');
  else if (CMD === 'agents') out.push(`### Agents lancés : ${L.agents.length}${L.agents.length > 25 ? ' (les 25 derniers)' : ''}`, '', L.agents.length ? tAgents.join('\n') : 'Aucun.');
  else if (CMD === 'poids') out.push('### Poids de cette session', '', ...poids(L.ctx));
  else if (CMD === 'cout') out.push('### Coût de cette session (prix publics, pas une facture)', '',
    `**${$(s.cout + coutAgents)}** — conversation ${$(s.cout)} · agents ${$(coutAgents)} · ${s.tours} tours`, '',
    comparaisonSonnet(L, s.cout));
  else if (CMD === 'regles') out.push(`### Règles du skill tenues dans cette session : ${R.score}`, '', ...R.lignes.map((l) => `- ${l}`));
  else {
    const lanc = L.sessions.filter((x) => x.etat !== 'refusé');
    out.push(`## 🎛 Orchestration en cours — ${projet || path.basename(DOSSIER)} ${debut}`, '',
      '| | |', '|---|---|',
      `| **Sessions lancées** | **${lanc.length}** — ${enLigne(compter(lanc, (x) => nom(x.modele)))}${L.sessions.length - lanc.length ? ` · ❌ ${L.sessions.length - lanc.length} refusée(s)` : ''} |`,
      `| **Agents** | **${L.agents.length}** — ${enLigne(compter(L.agents, (x) => nom(x.modele)))} |`,
      `| **Poids** | \`${jauge(L.ctx, 500000, 14)}\` ${k(L.ctx)} jetons |`,
      `| **Coût** | ${$(s.cout + coutAgents)} (dont agents ${$(coutAgents)}) |`,
      `| **Suivi** | ${L.minuteries.length} minuterie(s) · ${s.sendMessage} message(s) aux sessions · ${s.annonces} annonce(s) modèle · effort |`,
      `| **Règles tenues** | ${R.score} |`, '',
      ...(lanc.length ? ['**Sessions**', '', tSessions.join('\n'), ''] : []),
      '**Règles**', '', ...R.lignes.map((l) => `- ${l}`), '', ...poids(L.ctx));
  }
}
console.log(out.join('\n'));
