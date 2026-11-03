#!/usr/bin/env node
// Hook UserPromptSubmit + PostToolUse : rend le skill orchestrateur automatique.
//   UserPromptSubmit : quand le message demande de lancer, déléguer ou répartir des tâches, rappelle
//     en contexte d'appliquer le skill et d'annoncer chaque lancement en une ligne
//     « → titre — Modèle · effort — parce que … ».
//   PostToolUse (start_session, Agent, Task) : si le lancement vient de partir sans cette ligne,
//     ou sans modèle fixé, le rappelle tout de suite pour que l'annonce apparaisse dans la conversation.
// Ne bloque jamais. Mesure du 29/10 (785 sessions) : annonce faite dans 24 % des orchestrations,
// 26 % des lancements sans modèle, 25 demandes d'orchestration sur 45 sans aucune session lancée.
//   UserPromptSubmit, aussi : une conversation sur Opus qui ne lance rien depuis 5 réponses reçoit, une fois,
//     le conseil de proposer Sonnet. Mesure du 02/11 (30 jours, 59 conversations, 475 $ d'Opus) : basculer à
//     la 5ᵉ réponse aurait économisé 188 $ net (− 40 %), réécriture du cache comprise ; 42 sur 52 y gagnent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const lireStdin = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };

const DEMANDE = /\borchestre[rsz]?\b|\borchestrons\b|prompt master|\blance[rsz]?\s+(?:des|une?|les|deux|trois|quatre|cinq|plusieurs|\d+)\s+(?:sessions?|agents?|t[aâ]ches?|chantiers?|filles?)\b|lance[rsz]?\s+(?:en parall[eè]le|en fond)|en parall[eè]le|r[ée]partis|d[ée]l[eè]gue|fais(?: les)? faire|sous[- ]t[aâ]ches?|sessions? (?:filles?|s[ée]par[ée]es?)|plusieurs (?:sessions|agents|t[aâ]ches)|des agents? (?:pour|qui|en)\b|\bagents? (?:pour|qui)\b/i;
const ANNONCE = /(haiku|sonnet|opus|fable)(?:[\s-]*\d(?:[.,]\d)?)?\s*[·•\/,(]\s*(?:effort\s*)?(low|medium|high|xhigh|max)\b/i;
const TABLE = 'Haiku · medium : lire, extraire, trier, note à gabarit, bug simple testé (1/15 du prix de Sonnet, même note au banc) · Sonnet · low : code, captures, classement, raisonnement vérifiable · Sonnet · medium : multi-fichiers, revue de diff · Opus · medium : décider, concevoir, orchestrer (n\'a battu Sonnet sur aucune des 11 tâches du banc)';

const sortir = (evenement, texte) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: evenement, additionalContext: texte } }));
  process.exit(0);
};

// Un message qui n'est pas tapé par l'utilisateur : rapport d'agent, notification de tâche, reprise, prompt de script.
const PAS_HUMAIN = /^\s*(This session is being continued|Background \(from the session|Tu (?:es|écris|lis|reçois)\b|Another Claude session sent a message|\[SYSTEM NOTIFICATION|<task-notification|<agent-message)/;

// Le tour précédent, une fois terminé : lancements faits et lignes d'annonce écrites.
// (03/11/2026 : le texte d'un tour n'arrive dans la transcription qu'à la fin du tour ; un contrôle fait au moment
// du lancement, en PostToolUse, ne voyait jamais l'annonce et la réclamait à tort.)
export function tourPrecedent(fichier) {
  const r = { lancements: 0, annonces: 0 };
  try {
    const taille = fs.statSync(fichier).size, n = Math.min(taille, 2 * 1024 * 1024);
    const fd = fs.openSync(fichier, 'r'); const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, taille - n); fs.closeSync(fd);
    for (const l of buf.toString('utf8').split('\n').reverse()) {
      if (!l) continue; let d; try { d = JSON.parse(l); } catch { continue; }
      if (d.isSidechain) continue;
      const c = d?.message?.content;
      if (d.type === 'user' && !d.isMeta) {
        const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join('\n') : '';
        if (t && !PAS_HUMAIN.test(t)) break;
        continue;
      }
      if (d.type !== 'assistant' || !Array.isArray(c)) continue;
      for (const x of c) {
        if (x.type === 'tool_use' && /start_session$|^Agent$|^Task$/.test(x.name)) r.lancements++;
        if (x.type === 'text' && x.text) r.annonces += (x.text.match(new RegExp(ANNONCE.source, 'gi')) || []).length;
      }
    }
  } catch {}
  return r;
}

// Fin du journal : réponses distinctes sur Opus, et si un lancement (session, agent, workflow) a eu lieu.
export function opusSansLancement(fichier) {
  const r = { opus: 0, autres: 0, lance: false, dernier: '' };
  try {
    const taille = fs.statSync(fichier).size, n = Math.min(taille, 4 * 1024 * 1024);
    const fd = fs.openSync(fichier, 'r'); const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, taille - n); fs.closeSync(fd);
    const vus = new Set();
    for (const l of buf.toString('utf8').split('\n')) {
      if (!l.includes('"assistant"')) continue; let d; try { d = JSON.parse(l); } catch { continue; }
      const m = d.message; if (d.type !== 'assistant' || !m || d.isSidechain) continue;
      for (const c of Array.isArray(m.content) ? m.content : []) if (c.type === 'tool_use' && /start_session$|^Agent$|^Task$|^Workflow$/.test(c.name)) r.lance = true;
      if (!m.model || !m.usage || vus.has(m.id)) continue; vus.add(m.id);
      if (/opus/.test(m.model)) r.opus++; else r.autres++; r.dernier = m.model;
    }
  } catch {}
  return r;
}
const SEUIL_OPUS = 5;

try {
  const e = JSON.parse(lireStdin() || '{}');
  if (e.hook_event_name === 'UserPromptSubmit') {
    // Le texte de l'utilisateur seulement : ni le résumé d'une reprise, ni un prompt de script (« Tu écris… »), ni un collage.
    const p = String(e.prompt || '').replace(/<pasted_content[\s\S]*?<\/pasted_content>/g, '');
    if (PAS_HUMAIN.test(p)) process.exit(0);
    const t = tourPrecedent(e.transcript_path || '');
    // 03/11/2026 : dans l'app de bureau, le texte écrit juste avant un appel d'outil n'est pas enregistré dans la
    // transcription ; l'annonce ne s'y lit donc pas. Le rappel est coupé, sauf ORCH_CONTROLE_ANNONCE=1 (terminal).
    const rappel = process.env.ORCH_CONTROLE_ANNONCE === '1' && t.lancements > t.annonces ? `Au tour précédent : ${t.lancements} lancement${t.lancements > 1 ? 's' : ''} pour ${t.annonces} ligne${t.annonces > 1 ? 's' : ''} d'annonce. Chaque session ou agent lancé s'annonce avant l'appel : « → <titre> — <Modèle> · <effort> — parce que <raison> ». ` : '';
    if (!DEMANDE.test(p.slice(0, 1500))) {
      const r = opusSansLancement(e.transcript_path || '');
      const marque = path.join(os.tmpdir(), `orchestrateur-sonnet-${String(e.session_id || 'x').replace(/[^\w-]/g, '')}`);
      const lancee = path.join(os.tmpdir(), `orchestrateur-lance-${String(e.session_id || 'x').replace(/[^\w-]/g, '')}`);
      if (r.lance || fs.existsSync(lancee) || r.opus < SEUIL_OPUS || !/opus/.test(r.dernier) || fs.existsSync(marque)) { if (rappel) sortir('UserPromptSubmit', 'Skill orchestrateur : ' + rappel.trim()); process.exit(0); }
      try { fs.writeFileSync(marque, new Date().toISOString()); } catch {}
      sortir('UserPromptSubmit', `Skill orchestrateur : ${rappel}cette conversation tourne sur Opus depuis ${r.opus} réponses sans rien lancer. Si le travail est de l'exécution (code, lecture, rédaction, captures), écris d'abord à l'utilisateur, en une ligne : « → Cette conversation peut passer sur Sonnet · low ou medium — parce que <raison> ; changer de modèle dans le sélecteur de l'app ou par /model sonnet ». Repère mesuré : sur 30 jours, passer à la 5ᵉ réponse aurait coûté 40 % de moins, réécriture du cache comprise, et au banc Sonnet n'a perdu sur aucune des 11 tâches. Si le travail est de décider, concevoir ou arbitrer, reste sur Opus et ne dis rien. Ce conseil ne revient pas dans cette conversation.`);
    }
    sortir('UserPromptSubmit', `Skill orchestrateur (automatique) : ${rappel}ce message demande de lancer ou répartir du travail. Charge le skill « orchestrateur » s'il ne l'est pas, et pour chaque session ou agent lancé, écris AVANT l'appel, dans la conversation, une ligne : « → <titre> — <Modèle> · <effort> — parce que <raison en quelques mots> ». Modèle et effort toujours fixés, jamais par défaut. Repères mesurés : ${TABLE}. Le rendu de chaque fille se vérifie contre son critère de fin avant d'être annoncé comme fait.`);
  }
  if (e.hook_event_name === 'PostToolUse') {
    const outil = String(e.tool_name || ''); const i = e.tool_input || {};
    if (!/start_session$|^Agent$|^Task$/.test(outil)) process.exit(0);
    // Un lancement ancien sort des 4 derniers Mo lus par le conseil Sonnet : on le marque ici.
    try { fs.writeFileSync(path.join(os.tmpdir(), `orchestrateur-lance-${String(e.session_id || 'x').replace(/[^\w-]/g, '')}`), outil); } catch {}
    const titre = i.title || i.description || i.name || 'ce lancement';
    // L'annonce ne se contrôle pas ici (voir tourPrecedent) ; le modèle, si : il est dans l'appel.
    if (i.model) process.exit(0);
    sortir('PostToolUse', `Skill orchestrateur : « ${titre} » vient de partir sans modèle fixé (la fille hérite de celui de l'app, souvent Opus). Fixe model et effort au prochain lancement. Repères : ${TABLE}.`);
  }
} catch {}
process.exit(0);
