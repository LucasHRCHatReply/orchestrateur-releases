#!/usr/bin/env node
// Hook Stop : à chaque fin de tour, le verdict de la session sans /retour — dernière série de tests
// (verte ou rouge), commits réussis, corrections de l'utilisateur — écrit dans
// ~/.cache/orchestration/verdicts/<session>.json. /retour le reprend tel quel ; extraire.mjs le recalcule
// pour l'historique partagé. 02/11/2026 : 0 /retour donné depuis le 22/10.
//
// Relance des tests (1.7) : si du code a changé depuis les derniers tests et que son dépôt a des tests,
// la fin de tour est refusée une fois, avec la commande à lancer. Une fois par lot de modifications ;
// jamais deux fois de suite (stop_hook_active). Mesure du 02/11 : 65 à 88 % des sessions qui modifient
// du code s'arrêtaient sans relancer les tests après la dernière modification.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { creerAnalyse, verdict } from '../outils/extraire.mjs';
const lireStdin = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };
export const DOSSIER = process.env.ORCH_VERDICTS || path.join(os.homedir(), '.cache', 'orchestration', 'verdicts');

// Lecture incrémentale (03/11/2026 : 3,4 à 3,8 s à chaque fin de tour sur une session de 176 Mo, relue en entier avec ses
// sous-agents). L'état de l'analyse (compteurs, position lue) est gardé par session dans DOSSIER/.etat/<session>.json ;
// au tour suivant, seuls les octets ajoutés sont lus. L'état n'est repris que si la transcription n'a pas été
// réécrite : même taille ou plus, et les octets juste avant la position sont ceux qu'on avait vus. Sinon, relecture complète.
// Ni sous-agents ni coût : le verdict n'en a pas besoin.
const ANCRE = 256, MORCEAU = 8 * 1024 * 1024, LIGNE_MAX = 400 * 1024;
const lireOctets = (fd, debut, n) => { const b = Buffer.alloc(n); const lu = fs.readSync(fd, b, 0, n, debut); return b.subarray(0, lu); };
export function analyserIncremental(fichier, session) {
  const cible = path.join(DOSSIER, '.etat', session.replace(/[^\w.-]/g, '_') + '.json');
  const fd = fs.openSync(fichier, 'r');
  try {
    const taille = fs.fstatSync(fd).size;
    let reprise = null;
    try { const e = JSON.parse(fs.readFileSync(cible, 'utf8'));
      if (e.v === 1 && e.offset <= taille && lireOctets(fd, Math.max(0, e.offset - ANCRE), Math.min(ANCRE, e.offset)).toString('base64') === e.ancre) reprise = e; } catch {}
    const A = creerAnalyse('0000', reprise?.analyse);
    let offset = reprise ? reprise.offset : 0, reste = Buffer.alloc(0);
    while (offset + reste.length < taille) {
      const b = Buffer.concat([reste, lireOctets(fd, offset + reste.length, MORCEAU)]);
      const fin = b.lastIndexOf(10) + 1;   // seulement des lignes complètes : la dernière peut être en cours d'écriture
      if (!fin) { reste = b; if (b.length > 8 * LIGNE_MAX) { offset += b.length; reste = Buffer.alloc(0); } continue; }
      for (const l of b.subarray(0, fin).toString('utf8').split('\n')) {
        if (!l || l.length > LIGNE_MAX) continue; try { A.onEv(JSON.parse(l)); } catch {} }
      offset += fin; reste = b.subarray(fin);
    }
    try { fs.mkdirSync(path.dirname(cible), { recursive: true });
      const ancre = lireOctets(fd, Math.max(0, offset - ANCRE), Math.min(ANCRE, offset)).toString('base64');
      fs.writeFileSync(cible + '.tmp', JSON.stringify({ v: 1, offset, ancre, analyse: A.etat() })); fs.renameSync(cible + '.tmp', cible); } catch {}
    return { s: A.s, projet: A.projet() };
  } finally { fs.closeSync(fd); }
}

// La commande des tests d'un dépôt, ou '' s'il n'en a pas.
export function commandeDeTests(fichier) {
  let d = path.dirname(fichier);
  try { d = execFileSync('git', ['-C', d, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { if (!fs.existsSync(d)) return ''; }
  const ici = p => fs.existsSync(path.join(d, p));
  try { const t = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).scripts?.test;
    if (t && !/no test specified/.test(t)) return `cd "${d}" && npm test`; } catch {}
  if (ici('Package.swift') && ici('Tests')) return `cd "${d}" && swift test`;  // avant « tests » : le disque ignore la casse
  for (const t of ['outils/tests', 'tests', 'test', '__tests__']) if (ici(t)) {
    const js = fs.readdirSync(path.join(d, t)).filter(f => /\.test\.m?js$/.test(f));
    if (js.length) return `cd "${d}" && for t in ${t}/*.test.*js; do node "$t" || exit 1; done`;
    if (fs.readdirSync(path.join(d, t)).some(f => /^test_.*\.py$|_test\.py$/.test(f))) return `cd "${d}" && python3 -m pytest -q ${t}`;
  }
  return '';
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
try {
  const e = JSON.parse(lireStdin() || '{}');
  const f = e.transcript_path;
  if (f && fs.existsSync(f)) {
    const session = String(e.session_id || path.basename(f, '.jsonl'));
    const { s, projet } = analyserIncremental(f, session);
    const v = { session, app: process.env.CLAUDE_CODE_HOST_SESSION_ID || '',
      projet, debut: s.debut, fin: s.fin, messages_humains: s.humains, corrections: s.corrections,
      series_tests: s.seriesTests, tests_fin: s.tests, commits: s.commits,
      modifs_code: s.modifsCode, code_sans_test_a_la_fin: s.codeSansTest, ...verdict(s) };
    fs.mkdirSync(DOSSIER, { recursive: true });
    const cible = path.join(DOSSIER, v.session + '.json');
    const avant = (() => { try { return JSON.parse(fs.readFileSync(cible, 'utf8')); } catch { return {}; } })();
    let sortie = '';
    if (s.codeSansTest > 0 && !e.stop_hook_active && process.env.ORCH_RELANCE_TESTS !== '0' && avant.relance_a !== s.modifsCode) {
      const cmd = commandeDeTests(s.dernierCode);
      if (cmd) {
        v.relance_a = s.modifsCode; v.relances = (avant.relances || 0) + 1;
        sortie = JSON.stringify({ decision: 'block', reason: `Du code a changé depuis les derniers tests (${s.codeSansTest} modification${s.codeSansTest > 1 ? 's' : ''}, dernière : ${path.basename(s.dernierCode)}) et ce dépôt a des tests. Lance-les avant de conclure : ${cmd}. Si ce changement n'est pas couvert par des tests (texte, style, script jetable), dis-le en une ligne et termine.` });
      }
    }
    if (!('relance_a' in v) && 'relance_a' in avant) { v.relance_a = avant.relance_a; v.relances = avant.relances; }
    fs.writeFileSync(cible + '.tmp', JSON.stringify(v) + '\n'); fs.renameSync(cible + '.tmp', cible);
    if (sortie) process.stdout.write(sortie);
  }
} catch {}
process.exit(0);
}
