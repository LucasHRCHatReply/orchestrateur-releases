#!/usr/bin/env node
// Le suivi sans modèle : un petit démon relit l'état écrit par les hooks (hooks/etat.mjs, hooks/attente.mjs) et par les
// filles (outils/avancer.mjs), et tient ~/.cache/orchestration/suivi/<orchestration>/ :
//   tableau.json       ce que montrent le bandeau, le bureau et /point (0 jeton)
//   evenements.jsonl   fins de tour, attentes, seuils franchis, tout fini
//   resume.md          ce qui a changé depuis le dernier réveil de l'orchestratrice, 40 lignes au plus
// L'orchestratrice ne se réveille que sur événement : elle arme `Monitor` sur `suivi.mjs guetter` (une ligne par
// événement à juger ; l'expiration à 30 min sert de filet), et à son réveil ne lit que `suivi.mjs resume`.
// Le téléphone (notifier.sh) part sur trois événements seulement : attente de plus de 10 min, seuil, tout fini.
//
// Commandes :
//   demarrer [--orchestration id] [--session id]… [--fond nom=journal]… [--sonde 'nom=commande=>attendu']… [--depot chemin]… [--intervalle s]
//   ajouter  (mêmes options)          arreter          etat          tableau          point          resume [--sans-marquer]
//   guetter [--fins]                  juger --session id --verdict accepte|a-reprendre
//   boucle  (le démon lui-même)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CACHE = () => process.env.ORCH_CACHE || path.join(os.homedir(), '.cache', 'orchestration');
const ETAT = () => process.env.ORCH_ETAT || path.join(CACHE(), 'etat');
const ATTENTES = () => process.env.ORCH_ATTENTES || path.join(CACHE(), 'attentes');
export const DOSSIER = (orch) => path.join(CACHE(), 'suivi', String(orch).replace(/[^\w.-]/g, ''));
const MOI = fileURLToPath(import.meta.url);

export const SEUILS = {
  silenceMin: Number(process.env.ORCH_SILENCE_MIN) || 15,       // « travaille » sans aucun événement depuis…
  repetitions: 5,                                                // même outil, même cible, de suite
  contexte: 200_000,                                             // jetons de contexte d'une fille
  attenteMin: Number(process.env.ORCH_ATTENTE_MIN) || 10,        // attente de l'utilisateur avant le téléphone
  telephoneMin: 5,                                               // jamais deux messages en moins de…
};
const ATTENTE_TYPES = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);
const ACTIVITE = new Set(['PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'Stop', 'SessionStart']);
// Un dernier message qui demande un accord ou pose une question : la fille attend l'utilisateur.
// « j'attends sa notification » n'en est pas une (mesuré au banc du 16/11) : seul l'utilisateur est attendu ici.
const DEMANDE = /\?\s*$|\?\s|j['’]attends (?:ton|votre|ta|vos) |attend(?:s)? (?:ton|votre|l['’])accord|ton accord|votre accord|\bconfirme[sz]?\b|veux-tu|voulez-vous|on y va|je peux y aller|feu vert|à toi de|a toi de|ta décision|à valider/i;

const lireJSON = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const ecrireAtom = (f, texte) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = `${f}.${process.pid}`; fs.writeFileSync(t, texte); fs.renameSync(t, f); };
const lignesJSONL = (f, n = 500) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-n).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { return []; } };
const court = (t = '', n = 120) => { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const ms = (t) => Date.parse(t) || 0;
export const heure = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')} h ${String(d.getMinutes()).padStart(2, '0')}`; };
const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const duree = (m) => m < 1 ? 'moins d’une minute' : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`;

// Le lien qui ouvre la session : celui que l'app fabrique pour son menu « Sessions en attente » ; en CLI, la commande de reprise.
export const lienSession = (cle, cli = '') => /^local_/.test(cle) ? `claude://code/needs-input?session=${encodeURIComponent(cle)}` : `claude --resume ${cli || cle}`;

// La phrase d'accord à coller dans la session qui attend (jamais relayée par l'orchestratrice, voir le skill § 5).
export function phraseDAccord(type, message = '') {
  const m = court(String(message).replace(/^Claude needs your permission to use\s*/i, ''), 160);
  if (type === 'autorisation') return `Dans la session : « Autoriser » sur ${m || 'la demande affichée'} (un message n’est pas un clic).`;
  if (type === 'question') return `Réponse : <votre choix> — ${m}`;
  const q = (String(message).match(/[^.!?\n]*(?:\?|accord|valider|feu vert)[^.!?\n]*[.!?]?/i) || [m])[0];
  return `Accord : ${court(q.trim(), 160)} — vas-y.`;
}

// L'état d'une session à partir de ses lignes d'état (pur).
export function etatSession({ cle, lignes: toutes = [], avancement = null, attenteFichier = null, verdict = null, maintenant = Date.now(), meta = {} }) {
  const lignes = toutes.filter((l) => !l.agent);   // les appels des sous-agents comptent pour l'agent, pas pour la session
  const debut = lignes.find((l) => l.ev === 'SessionStart') || {};
  const critere = [...lignes].reverse().find((l) => l.critere)?.critere || meta.critere || '';
  const actifs = lignes.filter((l) => ACTIVITE.has(l.ev));
  const dernier = actifs[actifs.length - 1] || lignes[lignes.length - 1] || null;
  const outils = lignes.filter((l) => l.ev === 'PostToolUse' || l.ev === 'PostToolUseFailure');
  const derniereAction = outils[outils.length - 1] || null;
  const stop = [...lignes].reverse().find((l) => l.ev === 'Stop' && !l.enFond) || null;   // une vraie fin : rien ne tourne en fond
  const contexte = [...lignes].reverse().find((l) => l.ev === 'Stop' && l.contexte != null)?.contexte ?? null;
  const modele = [...lignes].reverse().find((l) => l.modele)?.modele || meta.modele || '';
  // Attente : une notification d'attente que rien n'a suivie, ou le fichier du hook attente, ou une fin de tour qui demande.
  const notif = [...lignes].reverse().find((l) => l.ev === 'Notification' && ATTENTE_TYPES.has(l.type));
  let attente = null;
  if (notif && (!dernier || ms(notif.t) >= ms(dernier.t))) attente = { type: /AskUserQuestion/i.test(notif.message) || notif.type !== 'permission_prompt' ? 'question' : 'autorisation', message: notif.message || '', depuis: notif.t };
  else if (attenteFichier && (attenteFichier.type === 'autorisation' || attenteFichier.type === 'question') && (!dernier || ms(attenteFichier.depuis) >= ms(dernier.t))) attente = { type: attenteFichier.type, message: attenteFichier.message || '', depuis: attenteFichier.depuis };
  let etat = 'repos';
  if (attente) etat = 'attend';
  else if (dernier?.ev === 'Stop' && dernier.enFond) etat = 'travaille';   // la main est rendue, une tâche de fond tourne encore
  else if (dernier?.ev === 'Stop') {
    if (DEMANDE.test(stop?.message || '')) { etat = 'attend'; attente = { type: 'accord', message: stop.message, depuis: stop.t }; }
    else etat = 'fini';
  } else if (dernier) etat = 'travaille';
  const app = debut.app || meta.id || '';
  if (attente) attente = { ...attente, phrase: phraseDAccord(attente.type, attente.message), lien: lienSession(app || cle, debut.cli || cle), minutes: (maintenant - ms(attente.depuis)) / 60000 };
  const inactifMin = dernier ? (maintenant - ms(dernier.t)) / 60000 : null;
  // Répétition : les derniers appels d'outil identiques, de suite.
  let rep = 0; const der = outils.slice(-SEUILS.repetitions * 2);
  for (let i = der.length - 1; i >= 0 && der[i].outil === derniereAction?.outil && der[i].cible === derniereAction?.cible; i--) rep++;
  const seuils = [];
  if (etat === 'travaille' && !dernier?.enFond && inactifMin != null && inactifMin >= SEUILS.silenceMin) seuils.push({ type: 'silence', texte: `silencieuse depuis ${duree(inactifMin)}${derniereAction ? ` (dernière action : ${derniereAction.outil} ${court(derniereAction.cible, 60)})` : ''}` });
  if (etat === 'travaille' && rep >= SEUILS.repetitions) seuils.push({ type: 'boucle', texte: `même action ${rep} fois de suite : ${derniereAction.outil} ${court(derniereAction.cible, 60)}` });
  if (contexte != null && contexte >= SEUILS.contexte) seuils.push({ type: 'contexte', texte: `contexte à ${Math.round(contexte / 1000)} k jetons (relance conseillée à 200 k)` });
  const aJuger = etat === 'fini' && !!stop && !(verdict && ms(verdict.t) >= ms(stop.t));
  return {
    genre: 'session', cle, app, cli: debut.cli || meta.cli || cle, titre: meta.titre || (debut.dossier ? `${path.basename(debut.dossier)} · ${cle.slice(-6)}` : cle),
    modele, effort: debut.effort || meta.effort || '', etat, critere,
    depuis: dernier?.t || null, inactifMin, outils: outils.length,
    derniere: derniereAction ? { outil: derniereAction.outil, cible: derniereAction.cible, t: derniereAction.t, echec: !!derniereAction.echec } : null,
    message: stop?.message || '', finDeTour: etat === 'fini' || etat === 'attend' ? (stop?.t || null) : null, enFond: dernier?.ev === 'Stop' ? (dernier.enFond || 0) : 0, minuteries: [...lignes].reverse().find((l) => l.ev === 'Stop')?.minuteries || 0, contexte, avancement, attente, seuils, aJuger,
    verdict: verdict?.verdict || null,
  };
}

// Les sous-agents d'une session, à partir de ses lignes d'état (pur). Ils passent en premier : depuis le 16/11/2026 la V3
// préfère les sous-agents, dont les demandes d'autorisation remontent dans la conversation principale.
export function agentsDe(cleParent, lignes = [], { maintenant = Date.now(), verdicts = {}, titreParent = '' } = {}) {
  const A = new Map();
  const de = (id) => { if (!A.has(id)) A.set(id, { id, lignes: [], lance: null, debut: null, fin: null, type: '' }); return A.get(id); };
  for (const l of lignes) {
    if (l.agentLance?.id) { const a = de(l.agentLance.id); a.lance = { ...l.agentLance, t: l.t }; }
    if (!l.agent) continue;
    const a = de(l.agent); a.type ||= l.type || '';
    if (l.ev === 'SubagentStart') a.debut = l.t; else if (l.ev === 'SubagentStop') a.fin = l; else a.lignes.push(l);
  }
  return [...A.values()].map((a) => {
    const cle = `${cleParent}#${a.id}`; const outils = a.lignes; const der = outils[outils.length - 1] || null;
    const dernier = a.fin ? Date.parse(a.fin.t) : Date.parse(der?.t || a.debut || a.lance?.t || 0);
    const etat = a.fin ? 'fini' : 'travaille'; const inactifMin = (maintenant - dernier) / 60000;
    let rep = 0; for (let i = outils.length - 1; i >= 0 && outils[i].outil === der?.outil && outils[i].cible === der?.cible; i--) rep++;
    const seuils = [];
    if (etat === 'travaille' && inactifMin >= SEUILS.silenceMin) seuils.push({ type: 'silence', texte: `agent silencieux depuis ${duree(inactifMin)}` });
    if (etat === 'travaille' && rep >= SEUILS.repetitions) seuils.push({ type: 'boucle', texte: `même action ${rep} fois de suite : ${der.outil} ${court(der.cible, 60)}` });
    const v = verdicts[cle];
    return { genre: 'agent', cle, parent: cleParent, titreParent, titre: a.lance?.description || `${a.type || 'agent'} · ${a.id.slice(-6)}`,
      modele: a.lance?.modele || '', effort: '', etat, async: !!a.lance?.async, depuis: new Date(dernier || maintenant).toISOString(), inactifMin, outils: outils.length,
      derniere: der ? { outil: der.outil, cible: der.cible, t: der.t, echec: !!der.echec } : null, message: a.fin?.message || '', finDeTour: a.fin?.t || null,
      contexte: null, avancement: null, attente: null, seuils, aJuger: etat === 'fini' && !(v && Date.parse(v.t) >= Date.parse(a.fin.t)), verdict: v?.verdict || null, critere: '' };
  });
}

// La ligne du bandeau : « ◎ 5 sessions · 2 travaillent · 2 vous attendent · 1 rapport à juger · 11 h 23 ».
export function ligneBandeau(filles, maintenant = Date.now()) {
  const n = (f) => filles.filter(f).length;
  const tr = n((f) => f.etat === 'travaille'), at = n((f) => f.etat === 'attend'), aj = n((f) => f.aJuger), al = n((f) => f.seuils.length);
  const p = (k, un, plusieurs) => (k === 1 ? un : plusieurs).replace('#', k);
  const ns = n((f) => f.genre !== 'agent'), na = n((f) => f.genre === 'agent');
  return ['◎ ' + [ns && p(ns, '# session', '# sessions'), na && p(na, '# agent', '# agents')].filter(Boolean).join(' · ') || '◎ rien en cours',
    tr && p(tr, '# travaille', '# travaillent'), at && p(at, '# vous attend', '# vous attendent'),
    aj && p(aj, '# rapport à juger', '# rapports à juger'), al && p(al, '# alerte', '# alertes'), heure(maintenant)].filter(Boolean).join(' · ');
}

// Les événements entre deux tableaux (pur) : fin, attente, seuil, tout-fini ; attente-longue pour le téléphone seul.
export function evenements(avant, apres, maintenant = Date.now()) {
  const tous = (T) => [...(T?.agents || []), ...(T?.filles || [])];
  const E = []; const A = new Map(tous(avant).map((f) => [f.cle, f]));
  const ev = (type, f, texte) => E.push({ t: new Date(maintenant).toISOString(), type, cle: f?.cle || '', titre: f?.titre || '', texte: court(texte, 240) });
  for (const f of tous(apres)) {
    const p = A.get(f.cle);
    if (f.finDeTour && f.finDeTour !== p?.finDeTour) ev('fin', f, f.message || 'fin de tour');
    if (f.attente && (!p?.attente || p.attente.depuis !== f.attente.depuis)) ev('attente', f, `${f.attente.type} : ${f.attente.message}`);
    if (f.attente && f.attente.minutes >= SEUILS.attenteMin && !(p?.attente?.minutes >= SEUILS.attenteMin && p.attente.depuis === f.attente.depuis)) ev('attente-longue', f, `attend depuis ${duree(f.attente.minutes)} : ${f.attente.message}`);
    for (const s of f.seuils) if (!(p?.seuils || []).some((x) => x.type === s.type)) ev('seuil', f, s.texte);
  }
  const fini = (T) => T && tous(T).length > 0 && tous(T).every((f) => f.etat === 'fini');
  if (fini(apres) && !fini(avant)) ev('tout-fini', null, `${tous(apres).length} session(s) et agent(s) ont fini`);
  return E;
}

// Lecture des journaux de fond déclarés : la dernière ligne utile (« [point] 330/406, ~6 min restantes »).
export function dernierPoint(f) {
  try {
    const st = fs.statSync(f); const n = Math.min(st.size, 16 * 1024); const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(n);
    fs.readSync(fd, b, 0, n, st.size - n); fs.closeSync(fd);
    const L = b.toString('utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    const p = [...L].reverse().find((l) => /\[point\]/i.test(l)) || L[L.length - 1] || '';
    return { ligne: court(p, 140), maj: st.mtime.toISOString() };
  } catch { return { ligne: 'journal introuvable', maj: null }; }
}

export function sonder(s) {
  const r = spawnSync('/bin/sh', ['-c', s.commande], { encoding: 'utf8', timeout: 20000 });
  const sortie = court((r.stdout || '').trim().split('\n').pop() || '', 120);
  const att = String(s.attendu ?? '');
  const ok = att.startsWith('/') && att.lastIndexOf('/') > 0 ? new RegExp(att.slice(1, att.lastIndexOf('/')), att.slice(att.lastIndexOf('/') + 1)).test(sortie) : sortie === att;
  return { nom: s.nom, ok, sortie, attendu: att, t: new Date().toISOString() };
}

// ── La famille : sessions déclarées, étiquetées ORCH_ORCHESTRATION, ou lues par bureau.mjs (sessions de l'app).
function cles(config) {
  const C = new Set(config.sessions || []);
  try {
    for (const f of fs.readdirSync(ETAT())) {
      if (!f.endsWith('.jsonl')) continue; const cle = f.slice(0, -6);
      if (C.has(cle) || cle === config.orchestration) continue;
      const premiere = lignesJSONL(path.join(ETAT(), f), 3);
      if (premiere.some((l) => l.orch === config.orchestration)) C.add(cle);
    }
  } catch {}
  for (const s of config._app || []) if (s.cli) C.add(s.cli);   // la clé d'état est l'id CLI ; l'id de l'app reste dans meta
  C.delete(config.orchestration); if (config.chef) C.delete(config.chef);   // l'orchestratrice elle-même n'est pas une fille
  return [...C];
}

async function familleApp(config) {
  if (config.app === false) return [];
  try {
    const { donnees } = await import('./bureau.mjs');
    const D = donnees({ session: config.orchestration, dossier: config.dossier || process.cwd() });
    return (D.sessions || []).filter((s) => !s.suite).map((s) => ({ id: s.id, cli: s.cli, titre: s.titre, modele: s.modele, effort: s.effort }));
  } catch { return []; }
}

export function lireTableau(orch) { return lireJSON(path.join(DOSSIER(orch), 'tableau.json')); }

export function calculerTableau(config, { maintenant = Date.now(), fond = [], sondes = [], depots = [] } = {}) {
  const verdicts = lireJSON(path.join(DOSSIER(config.orchestration), 'verdicts.json'), {});
  const meta = Object.fromEntries((config._app || []).filter((s) => s.cli).map((s) => [s.cli, s]));
  const attentesF = {}; try { for (const f of fs.readdirSync(ATTENTES())) if (f.endsWith('.json')) { const a = lireJSON(path.join(ATTENTES(), f)); if (a) { attentesF[a.session] = a; if (a.app) attentesF[a.app] = a; } } } catch {}
  const filles = cles(config).map((cle) => {
    const m = meta[cle] || (config.titres || {})[cle] && { titre: config.titres[cle] } || {};
    return etatSession({ cle, lignes: lignesJSONL(path.join(ETAT(), cle + '.jsonl')), avancement: lireJSON(path.join(ETAT(), cle + '.avancement.json')),
      attenteFichier: attentesF[cle] || (m.cli && attentesF[m.cli]) || null, verdict: verdicts[cle], maintenant, meta: { ...m, titre: (config.titres || {})[cle] || m.titre } });
  });
  const ordre = { attend: 0, travaille: 1, fini: 2, repos: 3 };
  filles.sort((a, b) => (ordre[a.etat] - ordre[b.etat]) || ((a.attente?.depuis || '') < (b.attente?.depuis || '') ? -1 : 1));
  const cleChef = config.chef || config.orchestration;
  const lignesChef = lignesJSONL(path.join(ETAT(), cleChef + '.jsonl'), 500);
  const chef = etatSession({ cle: cleChef, lignes: lignesChef, maintenant });
  // Les sous-agents : ceux de l'orchestratrice d'abord, puis ceux des filles.
  const agents = [...agentsDe(cleChef, lignesChef, { maintenant, verdicts, titreParent: 'orchestratrice' }),
    ...filles.flatMap((f) => agentsDe(f.cle, lignesJSONL(path.join(ETAT(), f.cle + '.jsonl')), { maintenant, verdicts, titreParent: f.titre }))];
  agents.sort((a, b) => (ordre[a.etat] - ordre[b.etat]) || (a.depuis < b.depuis ? 1 : -1));
  const tous = [...agents, ...filles];
  return {
    format: 'orchestration-suivi/1', orchestration: config.orchestration, maj: new Date(maintenant).toISOString(), ligne: ligneBandeau(tous, maintenant),
    compte: { sessions: filles.length, agents: agents.length, travaillent: tous.filter((f) => f.etat === 'travaille').length, attendent: tous.filter((f) => f.etat === 'attend').length,
      aJuger: tous.filter((f) => f.aJuger).length, finies: tous.filter((f) => f.etat === 'fini').length, alertes: tous.filter((f) => f.seuils.length).length },
    attentes: filles.filter((f) => f.attente).map((f) => ({ cle: f.cle, titre: f.titre, ...f.attente })),
    agents, filles, fond, sondes, depots, chef: { contexte: chef.contexte, depuis: chef.depuis, attente: chef.attente },
    suivi: { pid: process.pid, intervalle: config.intervalle || 3 },
  };
}

// Le résumé de réveil : ce qui a changé depuis le dernier réveil, borné à 40 lignes.
export function resume(T, evts, depuis, max = 40) {
  const neufs = evts.filter((e) => ms(e.t) > ms(depuis || 0) && e.type !== 'attente-longue');
  const L = [`# Suivi ${hhmm(T.maj)} — ${T.ligne}`, ''];
  L.push(neufs.length ? `## Depuis ${depuis ? hhmm(depuis) : 'le début'} : ${neufs.length} événement(s)` : `## Rien de neuf depuis ${depuis ? hhmm(depuis) : 'le début'}`);
  for (const e of neufs.slice(-15)) L.push(`- ${hhmm(e.t)} ${e.type} · ${e.titre || '—'} : ${court(e.texte, 150)}`);
  if (neufs.length > 15) L.push(`- (${neufs.length - 15} plus anciens dans evenements.jsonl)`);
  if (T.attentes.length) { L.push('', '## Attend l’utilisateur (ne jamais relayer un accord d’écriture)'); for (const a of T.attentes) L.push(`- ${a.titre} · ${a.type} depuis ${duree(a.minutes)} · ${a.lien}`); }
  L.push('', '## Agents et sessions');
  for (const f of [...(T.agents || []), ...T.filles]) {
    const av = f.avancement; const pas = av?.etape ? ` · étape ${av.etape}/${av.etapes}` : ''; const c = av?.total ? ` · ${av.fait}/${av.total}` : '';
    L.push(`- ${f.genre === 'agent' ? 'agent ' : ''}${f.titre} [${f.etat}${f.aJuger ? ', à juger' : ''}]${pas}${c} · ${f.derniere ? `${f.derniere.outil} ${court(f.derniere.cible, 50)} il y a ${duree((ms(T.maj) - ms(f.derniere.t)) / 60000)}` : 'aucune action'}${f.seuils.length ? ' · ⚠ ' + f.seuils.map((s) => s.type).join(', ') : ''}`);
  }
  if (T.fond.length) { L.push('', '## Fond'); for (const x of T.fond) L.push(`- ${x.nom} : ${x.ligne}`); }
  if (T.sondes.length) { L.push('', '## Sondes'); for (const s of T.sondes) L.push(`- ${s.ok ? '✓' : '✗'} ${s.nom} : ${s.sortie}${s.ok ? '' : ` (attendu ${s.attendu})`}`); }
  if (L.length > max) { const r = L.length - (max - 1); return [...L.slice(0, max - 1), `… ${r} ligne(s) de plus : node outils/suivi.mjs tableau`].join('\n') + '\n'; }
  return L.join('\n') + '\n';
}

// Le point au format du skill /point, calculé sans modèle.
export function point(T, k = 1) {
  const tous = [...(T.agents || []), ...T.filles];
  const fait = tous.filter((f) => f.etat === 'fini'); const enCours = tous.filter((f) => f.etat !== 'fini');
  const av = T.filles.map((f) => f.avancement).filter((a) => a?.etape);
  const etape = av.length ? `Étape ${Math.min(...av.map((a) => a.etape))} sur ${Math.max(...av.map((a) => a.etapes))}` : `${fait.length} fini(s) sur ${tous.length}`;
  const L = [`⏱ ${hhmm(T.maj)} · point n° ${k} — ${etape}`, '', 'Fait / en cours'];
  for (const f of tous.slice(0, 6)) L.push(`- ${f.genre === 'agent' ? 'agent ' : ''}${f.titre} : ${f.etat}${f.avancement?.total ? ` (${f.avancement.fait}/${f.avancement.total})` : ''}${f.avancement?.prochain ? ` — prochain : ${court(f.avancement.prochain, 60)}` : ''}`);
  for (const x of T.fond) L.push(`- ${x.nom} : ${x.ligne}`);
  L.push('', 'Échecs');
  const al = tous.flatMap((f) => f.seuils.map((s) => `- ${f.titre} : ${s.texte}`)); L.push(...(al.length ? al : ['- aucun']));
  L.push('', 'Reste');
  const reste = T.fond.map((x) => /(\d+\s*min)/.exec(x.ligne)?.[1]).filter(Boolean);
  L.push(reste.length ? `- ${reste.join(', ')} d’après les journaux de fond` : '- n/a (aucune fille ne donne de temps restant)');
  L.push('', `En clair : ${T.attentes.length ? `${T.attentes.length} session(s) vous attendent, en tête du bureau avec la phrase à coller.` : enCours.length ? `${enCours.length} session(s) travaillent, rien ne vous attend.` : 'tout est fini, les rapports sont à juger.'}`);
  return L.join('\n');
}

// ── Le téléphone : trois événements, jamais deux messages en moins de 5 minutes.
function notifier(dossier, E) {
  const garde = E.filter((e) => e.type === 'tout-fini' || e.type === 'seuil' || (e.type === 'attente-longue' && !relanceTelephonePosee()));
  if (!garde.length || process.env.ORCH_SANS_TELEPHONE) return;
  const f = path.join(dossier, 'telephone.json'); const der = lireJSON(f, { t: 0 });
  if (Date.now() - der.t < SEUILS.telephoneMin * 60000) return;
  const script = process.env.ORCH_NOTIFIER || path.join(os.homedir(), 'pboard', 'outils', 'notifier.sh');
  if (!fs.existsSync(script)) return;
  const e = garde[0]; const titre = e.type === 'tout-fini' ? 'Orchestration : tout est fini' : e.type === 'seuil' ? `Alerte : ${e.titre}` : `${e.titre} vous attend`;
  try { execFileSync(script, [court(e.texte + (garde.length > 1 ? ` (+${garde.length - 1})` : ''), 200), titre, e.type === 'tout-fini' ? 'default' : 'high'], { timeout: 15000, stdio: 'ignore' }); } catch {}
  ecrireAtom(f, JSON.stringify({ t: Date.now(), type: e.type }));
}
const relanceTelephonePosee = () => { try { return fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8').includes('relance-telephone'); } catch { return false; } };

// ── Le démon.
async function boucle(orch) {
  const dossier = DOSSIER(orch); const fc = path.join(dossier, 'config.json');
  ecrireAtom(path.join(dossier, 'pid'), String(process.pid));
  let precedent = lireTableau(orch); let tApp = 0, tLent = 0, fond = [], sondes = [], depots = [], dernierEv = Date.now();
  const debut = Date.now(); const maxH = Number(process.env.ORCH_SUIVI_MAX_H) || 12;
  for (;;) {
    const config = lireJSON(fc); if (!config || config.arret) break;
    const now = Date.now();
    if (now - tApp > 30000) { config._app = await familleApp(config); tApp = now; ecrireAtom(path.join(dossier, 'famille.json'), JSON.stringify(config._app)); }
    else config._app = lireJSON(path.join(dossier, 'famille.json'), []);
    fond = (config.fond || []).map((x) => ({ nom: x.nom, journal: x.journal, ...dernierPoint(x.journal) }));
    if (now - tLent > 60000) {
      tLent = now;
      sondes = (config.sondes || []).map(sonder);
      depots = (config.depots || []).map((d) => { try { return { depot: path.basename(d), dernier: execFileSync('git', ['-C', d, 'log', '-1', '--format=%h %s (%cr)'], { encoding: 'utf8', timeout: 5000 }).trim() }; } catch { return { depot: path.basename(d), dernier: 'n/a' }; } });
    }
    const T = calculerTableau(config, { maintenant: now, fond, sondes, depots });
    const E = evenements(precedent, T, now);
    if (E.length) { fs.appendFileSync(path.join(dossier, 'evenements.jsonl'), E.map((e) => JSON.stringify(e)).join('\n') + '\n'); notifier(dossier, E); dernierEv = now; }
    T.evenements = lignesJSONL(path.join(dossier, 'evenements.jsonl'), 30);
    ecrireAtom(path.join(dossier, 'tableau.json'), JSON.stringify(T));
    ecrireAtom(path.join(dossier, 'resume.md'), resume(T, T.evenements, lireJSON(path.join(dossier, 'lu.json'), {}).t));
    precedent = T;
    // S'arrête seul : 12 h de vie, ou 2 h sans aucun événement une fois tout fini.
    if (now - debut > maxH * 36e5 || ((T.compte.sessions + T.compte.agents) && T.compte.finies === T.compte.sessions + T.compte.agents && now - dernierEv > 2 * 36e5)) break;
    await new Promise((r) => setTimeout(r, (config.intervalle || 3) * 1000));
  }
  try { fs.rmSync(path.join(dossier, 'pid')); } catch {}
}

const vivant = (orch) => { const p = Number(fs.readFileSync(path.join(DOSSIER(orch), 'pid'), 'utf8')); try { process.kill(p, 0); return p; } catch { return 0; } };
const estVivant = (orch) => { try { return vivant(orch); } catch { return 0; } };

function options(a) {
  const o = { sessions: [], fond: [], sondes: [], depots: [], titres: {} };
  for (let i = 0; i < a.length; i++) {
    const v = a[i + 1];
    if (a[i] === '--orchestration') { o.orchestration = v; i++; }
    else if (a[i] === '--session') { const [id, ...t] = String(v).split('='); o.sessions.push(id); if (t.length) o.titres[id] = t.join('='); i++; }
    else if (a[i] === '--fond') { const j = v.indexOf('='); o.fond.push({ nom: v.slice(0, j), journal: path.resolve(v.slice(j + 1)) }); i++; }
    else if (a[i] === '--sonde') { const j = v.indexOf('='), k = v.lastIndexOf('=>'); o.sondes.push({ nom: v.slice(0, j), commande: v.slice(j + 1, k), attendu: v.slice(k + 2) }); i++; }
    else if (a[i] === '--depot') { o.depots.push(path.resolve(v)); i++; }
    else if (a[i] === '--intervalle') { o.intervalle = Number(v); i++; }
    else if (a[i] === '--dossier') { o.dossier = path.resolve(v); i++; }
    else if (a[i] === '--sans-app') o.app = false;
    else if (a[i] === '--fins') o.fins = true;
    else if (a[i] === '--sans-marquer') o.sansMarquer = true;
    else if (a[i] === '--verdict') { o.verdict = v; i++; }
  }
  o.orchestration ||= process.env.ORCH_ORCHESTRATION || (process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop' && process.env.CLAUDE_CODE_SESSION_ATTENDED !== '0' && process.env.CLAUDE_CODE_HOST_SESSION_ID) || process.env.CLAUDE_CODE_SESSION_ID;
  return o;
}

function fusionner(orch, o) {
  const fc = path.join(DOSSIER(orch), 'config.json'); const c = lireJSON(fc, { orchestration: orch, sessions: [], fond: [], sondes: [], depots: [], titres: {} });
  const uniq = (L, k) => [...new Map(L.map((x) => [k(x), x])).values()];
  const n = { ...c, sessions: [...new Set([...(c.sessions || []), ...o.sessions])], fond: uniq([...(c.fond || []), ...o.fond], (x) => x.nom),
    sondes: uniq([...(c.sondes || []), ...o.sondes], (x) => x.nom), depots: [...new Set([...(c.depots || []), ...o.depots])], titres: { ...(c.titres || {}), ...o.titres },
    dossier: o.dossier || c.dossier || process.cwd(), arret: false,
    chef: c.chef || process.env.CLAUDE_CODE_SESSION_ID || '' };
  if (o.intervalle) n.intervalle = o.intervalle; if (o.app === false) n.app = false;
  ecrireAtom(fc, JSON.stringify(n, null, 1)); return n;
}

async function guetter(orch, fins) {
  const f = path.join(DOSSIER(orch), 'evenements.jsonl');
  let pos = (() => { try { return fs.statSync(f).size; } catch { return 0; } })();
  const garder = new Set(['attente', 'seuil', 'tout-fini', ...(fins ? ['fin'] : [])]);
  let mort = 0;
  for (;;) {
    try {
      const st = fs.statSync(f);
      if (st.size > pos) {
        const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(st.size - pos); fs.readSync(fd, b, 0, b.length, pos); fs.closeSync(fd); pos = st.size;
        const L = b.toString('utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }).filter((e) => garder.has(e.type));
        if (L.length) console.log(`[suivi ${hhmm(Date.now())}] ${L.map((e) => `${e.type} · ${e.titre || '—'} : ${court(e.texte, 90)}`).join(' | ')} — lire : node ${MOI} resume`);
        if (L.some((e) => e.type === 'tout-fini')) process.exit(0);
      } else if (st.size < pos) pos = 0;
    } catch {}
    if (!estVivant(orch)) { if (++mort >= 5) { console.log(`[suivi ${hhmm(Date.now())}] le démon de suivi est arrêté — relancer : node ${MOI} demarrer`); process.exit(0); } } else mort = 0;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [cmd = 'etat', ...a] = process.argv.slice(2); const o = options(a); const orch = o.orchestration;
  if (!orch) { console.log('orchestration inconnue : passer --orchestration <id>'); process.exit(1); }
  const dossier = DOSSIER(orch);
  if (cmd === 'boucle') await boucle(orch);
  else if (cmd === 'demarrer' || cmd === 'ajouter') {
    const c = fusionner(orch, o);
    if (!estVivant(orch)) { fs.mkdirSync(dossier, { recursive: true }); const log = fs.openSync(path.join(dossier, 'suivi.log'), 'a');
      spawn(process.execPath, [MOI, 'boucle', '--orchestration', orch], { detached: true, stdio: ['ignore', log, log], env: process.env }).unref();
      for (let i = 0; i < 30 && !estVivant(orch); i++) await new Promise((r) => setTimeout(r, 100)); }
    console.log(`suivi ${estVivant(orch) ? 'en marche' : 'NON démarré'} (pid ${estVivant(orch) || '—'}) · ${c.sessions.length} session(s) déclarée(s), ${c.fond.length} fond, ${c.sondes.length} sonde(s) · ${path.join(dossier, 'tableau.json')}`);
    console.log(`réveil : Monitor { command: "node ${MOI} guetter --orchestration ${orch}", timeout_ms: 1800000 } · au réveil : node ${MOI} resume --orchestration ${orch}`);
  } else if (cmd === 'arreter') {
    const c = lireJSON(path.join(dossier, 'config.json')); if (c) ecrireAtom(path.join(dossier, 'config.json'), JSON.stringify({ ...c, arret: true }, null, 1));
    const p = estVivant(orch); if (p) try { process.kill(p); } catch {}
    console.log(p ? `suivi arrêté (pid ${p})` : 'suivi déjà arrêté');
  } else if (cmd === 'guetter') await guetter(orch, o.fins);
  else if (cmd === 'juger') {
    const s = o.sessions[0]; if (!s || !['accepte', 'a-reprendre'].includes(o.verdict)) { console.log('usage : juger --session id --verdict accepte|a-reprendre'); process.exit(1); }
    const f = path.join(dossier, 'verdicts.json'); const v = lireJSON(f, {}); v[s] = { verdict: o.verdict, t: new Date().toISOString() }; ecrireAtom(f, JSON.stringify(v)); console.log(`verdict noté : ${s} ${o.verdict}`);
  } else {
    const T = lireTableau(orch);
    if (!T) { console.log(`aucun tableau pour ${orch} : node ${MOI} demarrer --orchestration ${orch}`); process.exit(0); }
    const age = (Date.now() - ms(T.maj)) / 1000; const vieux = age > 30 ? ` (tableau vieux de ${duree(age / 60)} : suivi ${estVivant(orch) ? 'en marche' : 'arrêté'})` : '';
    if (cmd === 'resume') { process.stdout.write(fs.readFileSync(path.join(dossier, 'resume.md'), 'utf8')); if (vieux) console.log(vieux.trim()); if (!o.sansMarquer) ecrireAtom(path.join(dossier, 'lu.json'), JSON.stringify({ t: new Date().toISOString() })); }
    else if (cmd === 'point') { const fk = path.join(dossier, 'points.json'); const k = (lireJSON(fk, { k: 0 }).k || 0) + 1; ecrireAtom(fk, JSON.stringify({ k })); console.log(point(T, k) + vieux); }
    else if (cmd === 'tableau') console.log(JSON.stringify(T, null, 1));
    else console.log(T.ligne + vieux);
  }
}
