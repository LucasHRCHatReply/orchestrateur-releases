// Où ce dépôt écrit ses données (perfs/.compte, perfs/<compte>/, .local/).
// Installé par zip ou clone : dans le dépôt lui-même (comportement d'origine).
// Installé comme plugin Claude Code (.claude-plugin/plugin.json présent) : le dossier du plugin est un cache remplacé à
// chaque mise à jour, donc rien ne s'y écrit ; les données vont dans ~/.cache/orchestration/donnees (ou ORCH_DONNEES).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const dossierDonnees = (depot) => process.env.ORCH_DONNEES
  || (fs.existsSync(path.join(depot, '.claude-plugin', 'plugin.json')) ? path.join(os.homedir(), '.cache', 'orchestration', 'donnees') : depot);
