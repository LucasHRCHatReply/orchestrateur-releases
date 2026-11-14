#!/usr/bin/env node
// Hook UserPromptSubmit + PostToolUse : mesure ce qu'une session relit à chaque tour (le contexte
// envoyé au modèle, lu dans l'usage du dernier tour du journal de session) et, au passage d'un palier,
// rappelle en contexte la règle « compacter sur place, au bon moment, avec la note de reprise à jour » (12/11/2026 :
// la relance en session neuve n'est plus que le dernier recours). Le déclenchement lui-même n'est pas possible depuis
// un crochet : il passe par le seuil de compaction automatique (voir hooks/compaction.mjs) ou par /compact validé par l'utilisateur.
// Une fois par palier et par session ; au palier fort, une notification part aussi sur le téléphone.
// Ne bloque jamais. Mesure du 09/10 : la session PPA relisait ~780 000 jetons par tour.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
const lireStdin = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };

const AVERTIR = 150_000;   // à compacter à la fin de l'étape : note mise à jour, commande donnée (mesure du 20/10 : 80 % du coût Opus est au-delà de 300 000 ; le 12/11, 202 000 en 30 min)
const RELANCER = 300_000;  // compactage en retard : à la fin de l'étape, sans rien lancer de nouveau
const IMMEDIAT = 500_000;  // compacter tout de suite ; la relance en session neuve seulement si le compactage ne suffit pas
const NOTE = 150_000;      // la note de reprise s'écrit et se met à jour d'elle-même (02/11 : une grosse session sur deux seulement en laissait une)
const RAPPEL_TOUS = 100_000; // au-delà, un nouveau rappel tous les 100 000 jetons de plus
const ETAT = path.join(os.homedir(), '.cache', 'orchestration', 'poids-sessions');
const JOURNAL = path.join(os.homedir(), '.cache', 'orchestration', 'poids-sessions.jsonl');
// Notification facultative : une commande qui reçoit (message, titre), ex. ORCH_NOTIFIER=~/bin/ntfy.sh
const NOTIFIER = process.env.ORCH_NOTIFIER || (fs.existsSync(path.join(os.homedir(), 'pboard/outils/notifier.sh')) ? path.join(os.homedir(), 'pboard/outils/notifier.sh') : '');

// Lit la fin du journal de session (il peut peser des centaines de Mo) et rend le contexte du dernier tour.
function contexteDuDernierTour(fichier) {
  const taille = fs.statSync(fichier).size;
  const n = Math.min(taille, 4 * 1024 * 1024);
  const fd = fs.openSync(fichier, 'r');
  const buf = Buffer.alloc(n);
  fs.readSync(fd, buf, 0, n, taille - n);
  fs.closeSync(fd);
  const lignes = buf.toString('utf8').split('\n').reverse();
  for (const l of lignes) {
    if (!l.includes('"usage"')) continue;
    try {
      const d = JSON.parse(l);
      const u = d?.message?.usage;
      if (d.type === 'assistant' && u) return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    } catch {}
  }
  return 0;
}

try {
  let entree = {};
  try { entree = JSON.parse(lireStdin() || '{}'); } catch {}
  const transcript = entree.transcript_path;
  if (!transcript || !fs.existsSync(transcript)) process.exit(0);
  const session = String(entree.session_id || path.basename(transcript, '.jsonl'));
  const contexte = contexteDuDernierTour(transcript);
  const fEtat = path.join(ETAT, `${session.replace(/[^\w.-]/g, '_')}.json`);
  // Le contexte est retombé (/compact, relance) : l'ancien pic ne doit plus masquer les rappels (revue du 03/11 :
  // 320 k compacté à 60 k, remonté à 330 k, restait muet). Sous AVERTIR, l'état est effacé ; au-dessus, il est remis à zéro
  // si le contexte est 100 k sous le dernier rappel.
  if (contexte < AVERTIR) { fs.rmSync(fEtat, { force: true }); process.exit(0); }

  fs.mkdirSync(ETAT, { recursive: true });
  let etat = { dernier: 0, notifie: false };
  try { etat = JSON.parse(fs.readFileSync(fEtat, 'utf8')); } catch {}
  if (etat.dernier && contexte < etat.dernier - RAPPEL_TOUS) etat = { dernier: 0, notifie: false };
  const prochain = etat.dernier === 0 ? AVERTIR : etat.dernier + RAPPEL_TOUS;
  // À chaque rappel : outils/ranger.mjs écrit la note (plan, commits, fichiers, reste à faire) ; la compaction la réutilise.
  let note = '';
  const idApp = process.env.CLAUDE_CODE_HOST_SESSION_ID || '';
  if (contexte >= NOTE && contexte >= prochain && /^local_/.test(idApp)) {   // à chaque rappel : la note est réécrite, à jour
    try { note = execFileSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), '../outils/ranger.mjs'), 'relance', idApp, '--compaction'],
      { timeout: 6000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop(); } catch {}
    if (note && fs.existsSync(note)) etat.note = note; else note = '';
  }
  if (contexte < prochain) { if (etat.note) fs.writeFileSync(fEtat, JSON.stringify(etat)); process.exit(0); }

  const k = Math.round(contexte / 1000);
  const fort = contexte >= RELANCER;
  const immediat = contexte >= IMMEDIAT;
  const cheminNote = note || etat.note || '';
  // La commande exacte que l'utilisateur valide d'un geste (le crochet ne peut pas la saisir à sa place). Le crochet PreCompact,
  // s'il est installé, ajoute déjà les consignes complètes : cette version courte suffit alors.
  const commande = `/compact Orchestration : garder le but et son critère de fin, chaque fille (id, modèle · effort, état), branches et commits, décisions et garde-fous de l'utilisateur, processus de fond${cheminNote ? `, et renvoyer à la note ${cheminNote} au lieu de tout recopier` : ''}`;
  const regle = `Règle du skill orchestrateur (section 6, compacter sur place) : à la fin de l'étape en cours, ne lance rien de nouveau, vérifie que tout est commité, puis compacte`;
  const manuel = `Si l'auto-compactage est réglé sur ce Mac (autoCompactWindow), il se déclenche seul ; sinon dis à l'utilisateur de valider cette commande d'un geste : ${commande}`;
  const texte = fort
    ? `Poids de cette session : ~${k} 000 jetons relus par tour, le compactage est en retard. ${regle}. ${cheminNote ? `La note de reprise est à jour : ${cheminNote}. ` : ''}${manuel}`
    : `Poids de cette session : ~${k} 000 jetons relus par tour. C'est le moment de compacter. Garde relevés, captures et gros fichiers dans des agents Sonnet qui rendent un résumé. ${regle}. ${cheminNote ? `La note de reprise vient d'être mise à jour : ${cheminNote}. ` : ''}${manuel}`;
  const urgent = `Poids de cette session : ~${k} 000 jetons relus par tour, plus de 500 000 : chaque message coûte plusieurs fois ce qu'il coûterait compacté. Compacte TOUT DE SUITE, sans finir l'étape (${cheminNote ? `note à jour : ${cheminNote} ; ` : ''}${manuel}). Dernier recours seulement : si le compactage est impossible ou si le contexte reste au-dessus de 250 000 après lui, écris la note, commite et dis à l'utilisateur de repartir dans une session neuve avec le prompt de la section « Comment reprendre ».`;
  const texteFinal = immediat ? urgent : texte;
  const evenement = entree.hook_event_name || (entree.prompt !== undefined ? 'UserPromptSubmit' : 'PostToolUse');
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: evenement, additionalContext: texteFinal } }));

  if (fort && !etat.notifie && NOTIFIER) {
    const titre = path.basename(entree.cwd || '') || 'session';
    // Détaché : la notification part même si le hook rend la main tout de suite.
    spawn(NOTIFIER, [`Session ${titre} : ~${k} 000 jetons relus par tour, à compacter`, 'Session lourde'], { detached: true, stdio: 'ignore' }).unref();
    etat.notifie = true;
  }
  etat.dernier = contexte;
  fs.writeFileSync(fEtat, JSON.stringify(etat));
  fs.appendFileSync(JOURNAL, JSON.stringify({ ts: new Date().toISOString(), session, cwd: entree.cwd, contexte, palier: immediat ? 'immediat' : fort ? 'retard' : 'compacter', note: note || undefined }) + '\n');
} catch {}
process.exit(0);
