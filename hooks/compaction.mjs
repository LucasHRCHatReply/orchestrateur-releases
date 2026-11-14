#!/usr/bin/env node
// Hook PreCompact + SessionStart (matcher compact) : la session compacte SUR PLACE, avec des consignes de résumé qui gardent
// ce qu'une orchestratrice ne doit jamais perdre, et une note de reprise toujours à jour comme mémoire de référence.
//
// Faits établis (documentation officielle, relevé du 12/11/2026, voir apprentissages/compaction-faits-et-mecanisme.md) :
//  - PreCompact (matcher manual | auto) reçoit { trigger, custom_instructions } ; son stdout (code 0) sert de consignes au résumé, 10 000 caractères au plus ;
//  - SessionStart avec source « compact » : son additionalContext est ajouté au contexte après le compactage ;
//  - aucun mécanisme documenté ne laisse un modèle ou un crochet déclencher /compact : le déclenchement automatique passe par le
//    seuil de compaction automatique de Claude Code (autoCompactWindow / CLAUDE_CODE_AUTO_COMPACT_WINDOW / /autocompact).
// Ne bloque jamais la compaction.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ETAT = path.join(os.homedir(), '.cache', 'orchestration', 'compaction');
const JOURNAL = path.join(os.homedir(), '.cache', 'orchestration', 'compactions.jsonl');
const RANGER = path.join(path.dirname(new URL(import.meta.url).pathname), '../outils/ranger.mjs');
const lireStdin = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };

// Les consignes de résumé. Elles renvoient à la note plutôt que de tout recopier.
export function consignes({ note = '', perso = '' } = {}) {
  const t = [
    perso && `Consignes données à la main : ${perso}`,
    'Tu résumes la conversation d\'une ORCHESTRATRICE (elle découpe, lance et suit des sessions et des agents). Le résumé doit lui permettre de continuer sans rien redemander. À GARDER, dans cet ordre, et exact :',
    '1. Le but de l\'orchestration et son critère de fin, avec les mots de l\'utilisateur.',
    '2. Chaque session fille et chaque agent lancé : identifiant (local_… ou id d\'agent), titre, modèle · effort, état (travaille, attend, finie, vérifiée ou non) et ce qu\'elle doit rendre.',
    '3. Les branches, les commits (hash court + message) et les fichiers non commités par dépôt.',
    '4. Les décisions de l\'utilisateur et ses consignes, mot pour mot quand elles sont courtes : ce qu\'il a autorisé, refusé, demandé « ne pas refaire ». Les garde-fous (ne pas pousser, ne pas toucher tel fichier, jamais d\'API).',
    '5. Les processus de fond encore vivants (serveurs, minuteries, bancs) et ce qu\'il faut arrêter à la fin.',
    '6. Ce qui attend l\'utilisateur et la prochaine action de l\'orchestratrice.',
    note ? `7. Le chemin de la note de reprise : ${note}. Elle porte l'état détaillé : renvoie-y (« voir la note ») au lieu de recopier plans, journaux et longues sorties.` : '7. Aucune note de reprise n\'existe : écris l\'état détaillé dans le résumé.',
    'À NE PAS GARDER : sorties d\'outils et relevés bruts (garde seulement le chiffre utile et sa source), lectures de fichiers entières, tentatives abandonnées, politesses. Si une information n\'existe QUE dans la conversation (ni dans la note, ni dans un fichier, ni dans git), garde-la en toutes lettres.',
  ].filter(Boolean).join('\n');
  return t.slice(0, 9800);
}

function noteAJour() {
  const id = process.env.CLAUDE_CODE_HOST_SESSION_ID || '';
  if (!/^local_/.test(id)) return '';
  try { const f = execFileSync(process.execPath, [RANGER, 'relance', id, '--compaction'], { timeout: 8000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop(); return f && fs.existsSync(f) ? f : ''; } catch { return ''; }
}
const fEtat = (s) => path.join(ETAT, `${String(s).replace(/[^\w.-]/g, '_')}.json`);

if (process.argv[1] && new URL(import.meta.url).pathname === fs.realpathSync(process.argv[1])) {
try {
  let e = {}; try { e = JSON.parse(lireStdin() || '{}'); } catch {}
  const session = String(e.session_id || 'inconnue');
  const evenement = e.hook_event_name || (e.trigger !== undefined ? 'PreCompact' : 'SessionStart');
  fs.mkdirSync(ETAT, { recursive: true });
  if (evenement === 'PreCompact') {
    const note = noteAJour();
    fs.writeFileSync(fEtat(session), JSON.stringify({ note, trigger: e.trigger, ts: new Date().toISOString() }));
    fs.appendFileSync(JOURNAL, JSON.stringify({ ts: new Date().toISOString(), session, trigger: e.trigger, note: note || undefined, cwd: e.cwd }) + '\n');
    process.stdout.write(consignes({ note, perso: e.custom_instructions || '' }));
  } else if (evenement === 'SessionStart' && (e.source === 'compact' || e.matcher === 'compact')) {
    let etat = {}; try { etat = JSON.parse(fs.readFileSync(fEtat(session), 'utf8')); } catch {}
    const texte = `Le contexte vient d'être compacté sur place (${etat.trigger === 'auto' ? 'automatiquement' : 'à la demande'}). Reprise : ${etat.note ? `relis la note de reprise ${etat.note} ; ` : ''}vérifie l'état réel avant d'agir (git status et derniers commits des dépôts touchés, \`list_sessions\` des filles) ; ne refais rien qui est noté fait. Dis à l'utilisateur en une ligne que tu as compacté et que tu continues.`;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: texte } }));
  }
} catch {}
process.exit(0);
}
