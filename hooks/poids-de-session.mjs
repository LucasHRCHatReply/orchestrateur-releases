#!/usr/bin/env node
// Hook UserPromptSubmit + PostToolUse : mesure ce qu'une session relit à chaque tour (le contexte
// envoyé au modèle, lu dans l'usage du dernier tour du journal de session) et, au passage d'un palier,
// rappelle en contexte la règle « une-session-trop-longue-se-relance-avec-une-note-de-reprise ».
// Une fois par palier et par session ; au palier fort, une notification part aussi sur le téléphone.
// Ne bloque jamais. Mesure du 09/10 : la session PPA relisait ~780 000 jetons par tour.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
const lireStdin = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };

const AVERTIR = 200_000;   // la session coûte déjà cher : préparer la relance (mesure du 20/10 : 80 % du coût Opus est au-delà de 300 000)
const RELANCER = 300_000;  // relancer à la fin de l'étape en cours (seuils recalculés le 20/10, voir la règle)
const NOTE = 250_000;      // la note de reprise s'écrit d'elle-même (02/11 : une grosse session sur deux seulement en laissait une)
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
  // À 250 k, une fois : outils/ranger.mjs écrit la note (plan, commits, fichiers, reste à faire, prompt de reprise).
  let note = '';
  const idApp = process.env.CLAUDE_CODE_HOST_SESSION_ID || '';
  if (contexte >= NOTE && !etat.note && /^local_/.test(idApp)) {
    try { note = execFileSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), '../outils/ranger.mjs'), 'relance', idApp],
      { timeout: 6000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop(); } catch {}
    if (note && fs.existsSync(note)) etat.note = note; else note = '';
  }
  if (contexte < prochain && !note) { if (etat.note) fs.writeFileSync(fEtat, JSON.stringify(etat)); process.exit(0); }

  const k = Math.round(contexte / 1000);
  const fort = contexte >= RELANCER;
  const texte = fort
    ? `Poids de cette session : elle relit environ ${k} 000 jetons à chaque tour, ce qui vide vite le quota. Règle du skill orchestrateur (section 5) : à la fin de l'étape en cours, ne lance rien de nouveau ; écris une note de reprise (état chiffré, fichiers et commandes, traitements inachevés et comment les reprendre, décisions, prochaines étapes, ce qui attend l'utilisateur), commite, puis propose de continuer dans une session neuve où Opus orchestre et Sonnet relève.`
    : `Poids de cette session : elle relit déjà environ ${k} 000 jetons à chaque tour. Garde les relevés, captures et gros fichiers dans des agents Sonnet qui rendent un résumé, et prépare la note de reprise : au-delà de 300 000, la relance avec note de reprise s'applique (skill orchestrateur, section 5).`;

  const texteFinal = note
    ? `Poids de cette session : ~${k} 000 jetons relus par tour. Une note de reprise vient d'être écrite par le code : ${note}. À la fin de l'étape en cours : complète-la (décisions prises, chiffres avec leur source, pièges rencontrés, ce que la note automatique a mal dit), commite, puis dis à l'utilisateur en une ligne que la suite peut repartir dans une session neuve avec le prompt de la section « Comment reprendre ». Ne lance rien de nouveau avant.`
    : texte;
  const evenement = entree.hook_event_name || (entree.prompt !== undefined ? 'UserPromptSubmit' : 'PostToolUse');
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: evenement, additionalContext: texteFinal } }));

  if (fort && !etat.notifie && NOTIFIER) {
    const titre = path.basename(entree.cwd || '') || 'session';
    // Détaché : la notification part même si le hook rend la main tout de suite.
    spawn(NOTIFIER, [`Session ${titre} : ~${k} 000 jetons relus par tour, à relancer avec une note de reprise`, 'Session trop longue'], { detached: true, stdio: 'ignore' }).unref();
    etat.notifie = true;
  }
  etat.dernier = contexte;
  fs.writeFileSync(fEtat, JSON.stringify(etat));
  fs.appendFileSync(JOURNAL, JSON.stringify({ ts: new Date().toISOString(), session, cwd: entree.cwd, contexte, palier: note ? 'note' : fort ? 'relancer' : 'avertir', note: note || undefined }) + '\n');
} catch {}
process.exit(0);
