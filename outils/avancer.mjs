#!/usr/bin/env node
// Une fille dit où elle en est, en une commande (quelques jetons de sortie, rien pour l'orchestratrice) :
//   node ~/orchestration-claude/outils/avancer.mjs --etape 2/5 --nom "relever les pages" --fait 120/406 --prochain "comparer" [--obstacle "…"]
// Écrit ~/.cache/orchestration/etat/<session>.avancement.json, lu par outils/suivi.mjs. La session est celle de la CLI
// (CLAUDE_CODE_SESSION_ID, la même clé que le hook d'état), sinon --session.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOSSIER, masquer, cleDeSession } from '../hooks/etat.mjs';

const fraction = (t) => { const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(t || '')); return m ? [Number(m[1]), Number(m[2])] : null; };
const court = (t, n = 160) => { const s = masquer(String(t || '').replace(/\s+/g, ' ').trim()); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function avancement(o, maintenant = new Date()) {
  const v = { t: maintenant.toISOString() };
  const e = fraction(o.etape); if (e) [v.etape, v.etapes] = e;
  const f = fraction(o.fait); if (f) [v.fait, v.total] = f;
  for (const k of ['nom', 'prochain', 'obstacle']) if (o[k]) v[k] = court(o[k]);
  return v;
}

export function ecrireAvancement(o, env = process.env) {
  const cle = o.session ? String(o.session).replace(/[^\w.-]/g, '') : cleDeSession(env);
  if (!cle) throw new Error('session inconnue : passer --session');
  fs.mkdirSync(DOSSIER(), { recursive: true });
  const f = path.join(DOSSIER(), cle + '.avancement.json'); const t = f + '.' + process.pid;
  const v = avancement(o); fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f);
  return { f, v };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const a = process.argv.slice(2); const o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1]?.startsWith('--') ? '' : a[++i];
  try { const { v } = ecrireAvancement(o); console.log(`avancement noté${v.etape ? ` : étape ${v.etape}/${v.etapes}` : ''}${v.fait != null ? ` · ${v.fait}/${v.total}` : ''}`); }
  catch (e) { console.log(`avancement non noté : ${e.message}`); }
}
