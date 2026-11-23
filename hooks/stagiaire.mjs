#!/usr/bin/env node
// Hook Stop : à chaque fin de tour, lance détaché le stagiaire en ombre sur les agents Haiku finis de la session
// (outils/stagiaire.mjs ombre). Rend la main tout de suite ; le rejeu se fait sur le Mac mini en SSH.
// Coupé par ORCH_STAGIAIRE=0 ou par l'absence de la clé SSH du mini.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
try {
  const e = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const cle = process.env.STAGIAIRE_CLE || path.join(os.homedir(), '.ssh/id_ed25519_mini_claude');
  if (e.session_id && process.env.ORCH_STAGIAIRE !== '0' && fs.existsSync(cle)) {
    const outil = new URL('../outils/stagiaire.mjs', import.meta.url).pathname;
    spawn(process.execPath, [outil, 'ombre', '--session', e.session_id], { detached: true, stdio: 'ignore' }).unref();
  }
} catch {}
