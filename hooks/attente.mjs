#!/usr/bin/env node
// Hook Notification + Stop : une session fille attend l'utilisateur (autorisation d'outil, question,
// inactivité) → ~/.cache/orchestration/attentes/<session_id>.json ; elle repart (Stop) → le fichier s'efface.
// L'orchestratrice lit ce dossier pour présenter l'attente en carte visuelle (voir questions-visuelles.md).
// Champs du JSON reçu (doc des hooks) : session_id, cwd, hook_event_name, message, title, notification_type.
// Ne décide rien, ne bloque jamais, sort toujours en 0.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const lireStdin = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };
export const DOSSIER = () => process.env.ORCH_ATTENTES || path.join(os.homedir(), '.cache', 'orchestration', 'attentes');

// Le type d'attente d'une notification, ou '' si elle n'en est pas une (auth réussie, tâche finie…).
export function typeDAttente(e) {
  const t = String(e.notification_type || '');
  if (t === 'permission_prompt') return /AskUserQuestion/i.test(e.message || '') ? 'question' : 'autorisation';
  if (t === 'elicitation_dialog' || t === 'elicitation_url_dialog' || t === 'agent_needs_input') return 'question';
  if (t === 'idle_prompt') return 'inactive';
  return '';
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const e = JSON.parse(lireStdin() || '{}');
    const id = String(e.session_id || '').replace(/[^\w.-]/g, '');
    if (id) {
      const cible = path.join(DOSSIER(), id + '.json');
      if (e.hook_event_name === 'Stop') fs.rmSync(cible, { force: true });
      else if (e.hook_event_name === 'Notification') {
        const type = typeDAttente(e);
        if (type) {
          fs.mkdirSync(DOSSIER(), { recursive: true });
          const v = { session: id, app: process.env.CLAUDE_CODE_HOST_SESSION_ID || '',
            projet: e.cwd ? path.basename(e.cwd) : '', type,
            message: String(e.message || e.title || '').slice(0, 500), depuis: new Date().toISOString() };
          fs.writeFileSync(cible + '.tmp', JSON.stringify(v) + '\n'); fs.renameSync(cible + '.tmp', cible);
        }
      }
    }
  } catch {}
  process.exit(0);
}
