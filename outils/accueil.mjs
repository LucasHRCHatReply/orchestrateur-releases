#!/usr/bin/env node
// La page d'accueil du skill, à l'installation (et par /orch accueil).
// 1. relit les 30 derniers jours de ce Mac (une seule lecture des transcriptions, via extraire.mjs) ;
// 2. demande à Claude (Haiku · medium, un seul appel, ≈ 0,01 $) un mot d'accueil court — facultatif ;
// 3. écrit ~/.cache/orchestration/bienvenue.html (page autonome, sans dépendance) et l'ouvre.
// Un chiffre qu'on ne peut pas calculer s'affiche « n/a », jamais 0. Sans aucune donnée (Mac neuf), la page se génère quand même.
//
// Usage : node outils/accueil.mjs [--texte] [--sans-claude] [--sans-ouvrir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyserSession, verdict } from './extraire.mjs';
import { dossierDonnees } from './donnees.mjs';

const DEPOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const COMPTE = (() => { try { return fs.readFileSync(path.join(dossierDonnees(DEPOT), 'perfs/.compte'), 'utf8').trim(); } catch { return os.userInfo().username; } })();
const PRENOM = (() => { const p = (COMPTE.split(/[-_. ]/)[0] || COMPTE); return p ? p[0].toUpperCase() + p.slice(1) : ''; })();
const VERSION = (() => { try { return (fs.readFileSync(path.join(DEPOT, 'skills/orchestrateur/SKILL.md'), 'utf8').match(/^version:\s*(.+)$/m) || [])[1] || ''; } catch { return ''; } })();
const JOURS = 30;

// ── Les chiffres : une lecture de chaque transcription modifiée depuis 30 jours
const VIDE = { depuis: null, n: 0, cout: null, agents: 0, agentsSansModele: 0, lourdes: 0, lourdesAvecNote: 0, conversations: 0, sansPreuve: 0,
  avecCode: 0, codeSansTest: 0, opusSansLancement: 0, coutOpusSansLancement: 0, lancees: 0 };
async function lireChiffres() {
  const racine = path.join(os.homedir(), '.claude/projects');
  const depuis = new Date(Date.now() - JOURS * 864e5).toISOString().slice(0, 10);
  const c = { ...VIDE, depuis, cout: 0 };
  let dossiers = []; try { dossiers = fs.readdirSync(racine); } catch { /* Mac neuf */ }
  const fichiers = [];
  for (const d of dossiers) {
    const p = path.join(racine, d); try { if (!fs.statSync(p).isDirectory()) continue; } catch { continue; }
    for (const f of fs.readdirSync(p)) { try { if (f.endsWith('.jsonl') && fs.statSync(path.join(p, f)).mtime.toISOString().slice(0, 10) >= depuis) fichiers.push(path.join(p, f)); } catch { /* fichier disparu */ } }
  }
  let k = 0;
  for (const f of fichiers) {
    if (++k % 200 === 0) process.stderr.write(`  ${k}/${fichiers.length}\n`);
    let r; try { r = await analyserSession(f, depuis); } catch { continue; }
    const s = r.s; if (!s.tours) continue;
    const coutSession = s.cout + r.coutAgents;
    c.n++; c.cout += coutSession;
    c.agents += s.agents.length; c.agentsSansModele += s.agents.filter((x) => x.modele === 'hérité').length;
    c.lancees += s.sessions.length;
    if (s.ctxMax > 300000) { c.lourdes++; if (s.notesReprise > 0) c.lourdesAvecNote++; }
    if (s.humains >= 3) {
      c.conversations++;
      if (verdict(s).verdict === 'n/a') c.sansPreuve++;
      const dominant = Object.entries(s.modeles).sort((x, y) => y[1] - x[1])[0]?.[0] || '';
      if (/opus/.test(dominant) && !s.agents.length && !s.sessions.length && !s.workflows) { c.opusSansLancement++; c.coutOpusSansLancement += coutSession; }
    }
    if (s.modifsCode > 0) { c.avecCode++; if (s.codeSansTest > 0) c.codeSansTest++; }
  }
  if (!c.n) c.cout = null;
  return c;
}

const pct = (x, n) => (n ? Math.round((100 * x) / n) : null);
const nf = (n) => Math.round(n).toLocaleString('fr-FR');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const NA = 'n/a';
const PS = ' %';   // espace fine insécable avant %

export function chiffresAffiches(c) {
  const sansModele = pct(c.agentsSansModele, c.agents);
  const partCode = pct(c.codeSansTest, c.avecCode);
  return [
    { v: c.cout == null ? NA : `${nf(c.cout)} $`, l: 'Coût', aide: `Coût de ${c.n} sessions, agents compris, calculé aux prix publics à partir des jetons lus. Ce n'est pas une facture. Source : transcriptions de ~/.claude/projects modifiées depuis le ${c.depuis}.` },
    { v: sansModele == null ? NA : `${sansModele}${PS}`, l: 'Agents sans modèle', aide: `Part des agents lancés sans modèle fixé : ils héritent alors du modèle de la conversation (${c.agentsSansModele} sur ${c.agents}). Source : appels Agent des transcriptions de ~/.claude/projects, 30 derniers jours.` },
    { v: c.n ? String(c.lourdes) : NA, l: 'Conversations lourdes', aide: `Conversations dont le contexte a dépassé 300 000 jetons (${c.lourdesAvecNote} avec une note de reprise). Au-delà, chaque tour relit tout l'historique. Source : usage des tours dans ~/.claude/projects, 30 derniers jours.` },
    { v: partCode == null ? NA : `${partCode}${PS}`, l: 'Code sans tests', aide: `Part des sessions qui modifient du code et s'arrêtent sans relancer les tests (${c.codeSansTest} sur ${c.avecCode}). Ne comptent pas : notes, pages, fichiers de test. Source : outils d'écriture et commandes de test des transcriptions, 30 derniers jours.` },
  ];
}

// ── Les schémas : 3 à 4 éléments, le dernier porte l'accent
function schema(etiquettes) {
  const n = etiquettes.length, gap = 26, W = 360, w = (W - gap * (n - 1)) / n, h = 52;
  let x = 0, out = '';
  etiquettes.forEach((e, i) => {
    const lignes = e.split('|');
    out += `<rect x="${x.toFixed(1)}" y="6" width="${w.toFixed(1)}" height="${h}" rx="10" class="${i === n - 1 ? 'sa' : 'sb'}"/>`;
    lignes.forEach((t, j) => { out += `<text x="${(x + w / 2).toFixed(1)}" y="${(32 - (lignes.length - 1) * 7 + j * 14).toFixed(1)}" text-anchor="middle" class="${i === n - 1 ? 'ta' : 'tb'}">${esc(t)}</text>`; });
    if (i < n - 1) out += `<path d="M${(x + w + 5).toFixed(1)} 32h${gap - 10}m-5 -4l5 4l-5 4" class="fl"/>`;
    x += w + gap;
  });
  return `<svg viewBox="0 0 ${W} 64" role="img" aria-hidden="true">${out}</svg>`;
}

export function cartes(c) {
  const sm = pct(c.agentsSansModele, c.agents);
  const lourdesAvant = c.n ? `${c.lourdes} conversations ont dépassé 300 000 jetons, dont ${c.lourdesAvecNote} seulement avec une note de reprise.` : `Conversations au-delà de 300 000 jetons : ${NA}.`;
  return [
    { nom: 'Modèle annoncé', schema: ['Tâche', 'Plus petit|modèle', 'Annonce|modèle · effort'],
      aide: 'Règle du skill : chaque lancement dit son modèle et son effort, et pourquoi.',
      avant: sm == null ? `Part des agents sans modèle fixé : ${NA}.` : `${sm}${PS} de vos agents (${nf(c.agentsSansModele)} sur ${nf(c.agents)}) partaient sans modèle fixé et prenaient celui de la conversation.`,
      apres: 'Avant chaque agent et chaque session, une ligne : « modèle · effort — parce que … ». Le plus petit modèle qui suffit.' },
    { nom: 'Conseil Sonnet', schema: ['5 réponses|sur Opus', 'Rien|lancé', 'Proposer|Sonnet'],
      aide: 'Hook aiguillage : une fois par conversation.',
      avant: c.conversations ? `${c.opusSansLancement} de vos conversations sur Opus n'ont rien lancé : ${nf(c.coutOpusSansLancement)} $ aux prix publics.` : `Conversations sur Opus qui ne lancent rien : ${NA}.`,
      apres: 'À la 5e réponse sur Opus sans rien lancer, Claude propose Sonnet en une ligne, si le travail est de l\'exécution. Une décision reste sur Opus.' },
    { nom: 'Note de reprise', schema: ['250 000|jetons', 'Note|écrite seule', 'Session|neuve'],
      aide: 'Hook poids-de-session, dans l\'app de bureau.',
      avant: lourdesAvant,
      apres: 'À 250 000 jetons, la note de reprise s\'écrit seule, avec le prompt de la session neuve. Claude propose ensuite la relance.' },
    { nom: 'Verdict automatique', schema: ['Tests', 'Commits', 'Verdict|de la session'],
      aide: 'Hook verdict, à chaque fin de tour. Fichier dans ~/.cache/orchestration/verdicts.',
      avant: c.conversations ? `${c.sansPreuve} de vos ${c.conversations} conversations s'arrêtaient sans test ni commit : aucune preuve que le travail tenait.` : `Conversations sans preuve de réussite : ${NA}.`,
      apres: 'À chaque fin de tour, un verdict est écrit seul : réussi, réussi après correction, échec, ou n/a. Il se calcule sur les tests, les commits et vos corrections.' },
    { nom: 'Tests relancés', schema: ['Code|modifié', 'Fin|refusée', 'Tests|du dépôt'],
      aide: 'Hook verdict. Se coupe avec ORCH_RELANCE_TESTS=0.',
      avant: c.avecCode ? `${c.codeSansTest} de vos ${c.avecCode} sessions qui modifient du code s'arrêtaient sans relancer les tests.` : `Sessions qui modifient du code : ${NA}.`,
      apres: 'Si du code a changé depuis les derniers tests, la fin de tour est refusée une fois, avec la commande de test du dépôt. Sans tests, Claude le dit en une ligne.' },
    { nom: 'Questions en cartes', schema: ['Session|fille', 'Question', 'Carte|un clic'],
      aide: 'Modèle : outils/question-carte.html.',
      avant: c.lancees ? `Vous avez lancé ${c.lancees} sessions filles : chacune pouvait vous arrêter sur une question écrite en paragraphe.` : `Sessions filles lancées : ${NA}.`,
      apres: 'La question d\'une session fille arrive en carte : un schéma, deux à quatre réponses, la recommandée en premier. Un clic répond.' },
    { nom: 'Bandeau replié', schema: ['Bandeau|replié', 'Un clic', 'Qui travaille,|qui attend'],
      aide: 'Extension de l\'app de bureau, onglet Code.',
      avant: c.lancees || c.agents ? `Avec ${c.lancees} sessions filles et ${nf(c.agents)} agents lancés, savoir qui attend quoi demandait d'ouvrir /orch.` : `Sessions et agents lancés : ${NA}.`,
      apres: 'Un bandeau, replié par défaut au-dessus de la saisie, montre qui travaille, attend ou a fini. Un clic l\'ouvre ; son état est gardé.' },
  ];
}

if (a.includes('--texte')) {
  const c = await lireChiffres();
  console.log(`Prénom : ${PRENOM} · skill v${VERSION}\n${JSON.stringify(c, null, 1)}`);
  process.exit(0);
}

process.stderr.write(`Lecture de vos ${JOURS} derniers jours de Claude Code…\n`);
let c; try { c = await lireChiffres(); } catch { c = { ...VIDE }; }

// ── Le mot de Claude (facultatif, court)
let mot = null;
if (!a.includes('--sans-claude') && spawnSync('sh', ['-c', 'command -v claude']).status === 0) {
  process.stderr.write('Claude écrit votre mot d’accueil…\n');
  const resume = { cout: c.cout == null ? null : Math.round(c.cout), conversations_lourdes: c.n ? c.lourdes : null, agents_sans_modele_pct: pct(c.agentsSansModele, c.agents), code_sans_tests_pct: pct(c.codeSansTest, c.avecCode) };
  const prompt = `Tu écris le mot d'accueil de ${PRENOM}, qui vient d'installer le skill « orchestrateur » pour Claude Code${VERSION ? ` (v${VERSION})` : ''}. Le skill fait de Claude un chef de chantier : il découpe, confie chaque morceau au plus petit modèle qui suffit, vérifie, relance les sessions trop lourdes.
Chiffres réels de ses ${JOURS} derniers jours (null = non mesuré) : ${JSON.stringify(resume)}.
Réponds UNIQUEMENT par un objet JSON : {"titre": "...", "mot": "..."}
- titre : 3 à 6 mots, s'adresse à ${PRENOM} par son prénom.
- mot : une ou deux phrases, vouvoiement, ton direct et chaleureux ; cite au plus un de ses chiffres, tel quel. N'invente aucun chiffre. Français.`;
  const r = spawnSync('claude', ['-p', prompt, '--model', 'claude-haiku-5-5', '--effort', 'medium', '--output-format', 'text', '--tools', ''], { encoding: 'utf8', timeout: 90000 });
  try { const t = r.stdout || ''; const o = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); if (o.titre && o.mot) mot = { titre: String(o.titre), mot: String(o.mot) }; } catch { mot = null; }
}
const titre = mot?.titre || `Bienvenue, ${PRENOM}`;

// ── La page
const kpis = chiffresAffiches(c).map((k) => `<div class="kpi" tabindex="0" title="${esc(k.aide)}"><b${k.v === NA ? ' class="na"' : ''}>${esc(k.v)}</b><span>${esc(k.l)}</span><i class="tip" role="tooltip">${esc(k.aide)}</i></div>`).join('');
const cartesHtml = cartes(c).map((m, i) => `<article class="carte" title="${esc(m.aide)}"><header><em>${i + 1}</em><h3>${esc(m.nom)}</h3></header>${schema(m.schema)}<p class="av"><span>Avant</span>${esc(m.avant)}</p><p class="ap"><span>Maintenant</span>${esc(m.apres)}</p></article>`).join('');
const CMDS = [['/orch', 'Le tableau de bord : sessions, agents, coût, poids du contexte.'], ['/sessiondesk', 'Une page qui montre qui travaille, qui attend, qui a fini.'], ['/point', 'Un point d’avancement condensé, tout de suite ou toutes les 5 minutes.'], ['/reprise', 'Reprend le chantier là où la dernière pause l’a laissé.']];
const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bienvenue — Orchestrateur</title><style>
:root{--f:#fafaf8;--t:#17171c;--m:#5f5f6b;--c:#fff;--l:#e5e5e0;--a:#2f5fd0;--as:#e9effc;--ac:#fff}
@media (prefers-color-scheme:dark){:root{--f:#0f0f13;--t:#f1f1f4;--m:#9a9aa8;--c:#17171d;--l:#2a2a33;--a:#7ea2ff;--as:#1c2540;--ac:#0f0f13}}
*{box-sizing:border-box}body{margin:0;background:var(--f);color:var(--t);font:16px/1.6 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;-webkit-text-size-adjust:100%}
.w{max-width:920px;margin:0 auto;padding:72px 20px 88px}
.ey{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--a);font-weight:600;margin:0 0 14px}
h1{font-size:clamp(34px,7vw,56px);line-height:1.04;letter-spacing:-.03em;margin:0 0 18px;font-weight:700}
.lead{font-size:clamp(18px,3.2vw,22px);line-height:1.5;max-width:680px;margin:0 0 14px}
.mot{color:var(--m);max-width:640px;margin:0;border-left:3px solid var(--a);padding-left:14px}
h2{font-size:26px;letter-spacing:-.02em;margin:72px 0 6px;font-weight:700}
.sub{color:var(--m);margin:0 0 24px;max-width:640px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi{position:relative;background:var(--c);border:1px solid var(--l);border-radius:16px;padding:20px 18px;outline:none;cursor:help}
.kpi:focus-visible{border-color:var(--a)}
.kpi b{display:block;font-size:clamp(28px,4vw,36px);line-height:1.1;letter-spacing:-.03em;font-weight:700;font-variant-numeric:tabular-nums}
.kpi b.na{color:var(--m)}.kpi span{display:block;margin-top:6px;color:var(--m);font-size:14px}
.tip{position:absolute;left:0;right:0;bottom:calc(100% + 8px);background:var(--t);color:var(--f);font-style:normal;font-size:13px;line-height:1.45;padding:10px 12px;border-radius:10px;opacity:0;pointer-events:none;transition:opacity .15s;z-index:5}
.kpi:hover .tip,.kpi:focus .tip{opacity:1}
.cartes{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.carte{background:var(--c);border:1px solid var(--l);border-radius:20px;padding:22px}
.carte header{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.carte em{font-style:normal;font-size:13px;font-weight:700;width:26px;height:26px;border-radius:50%;background:var(--as);color:var(--a);display:grid;place-items:center;flex:none}
.carte h3{margin:0;font-size:18px;letter-spacing:-.01em}
.carte svg{display:block;width:100%;height:auto;margin:0 0 18px}
.sb{fill:none;stroke:var(--l);stroke-width:1.5}.sa{fill:var(--as);stroke:var(--a);stroke-width:1.5}
.tb{fill:var(--m);font:12px -apple-system,system-ui,sans-serif}.ta{fill:var(--a);font:600 12px -apple-system,system-ui,sans-serif}
.fl{fill:none;stroke:var(--m);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.carte p{margin:0 0 12px;font-size:15px;line-height:1.5}.carte p:last-child{margin:0}
.carte p span{display:block;font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;color:var(--m);margin-bottom:2px}
.carte .av{color:var(--m)}.carte .ap span{color:var(--a)}
.cmds{display:grid;gap:0;border:1px solid var(--l);border-radius:16px;background:var(--c);overflow:hidden}
.cmd{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:14px 18px;border-top:1px solid var(--l);align-items:baseline}.cmd:first-child{border-top:0}
.cmd code,.retrait code{font:600 15px ui-monospace,SFMono-Regular,Menlo,monospace}.cmd code{color:var(--a)}
.cmd p{margin:0;color:var(--m);font-size:15px}
.retrait{background:var(--c);border:1px solid var(--l);border-radius:16px;padding:20px 22px}
.retrait p{margin:0 0 10px}.retrait p:last-child{margin:0;color:var(--m);font-size:15px}
.retrait code{display:inline-block;background:var(--as);color:var(--a);border-radius:8px;padding:3px 9px;word-break:break-all}
footer{margin-top:64px;color:var(--m);font-size:13px;max-width:640px}
@media (max-width:760px){.w{padding:48px 16px 64px}.kpis{grid-template-columns:repeat(2,1fr)}.cartes{grid-template-columns:1fr}.cmd{grid-template-columns:1fr;gap:2px}h2{margin-top:56px}.tip{bottom:auto;top:calc(100% + 6px)}}
</style></head><body><main class="w">
<p class="ey">Orchestrateur${VERSION ? ` · v${esc(VERSION)}` : ''}</p>
<h1>${esc(titre)}</h1>
<p class="lead">Claude devient chef de chantier : il découpe le travail, confie chaque morceau au plus petit modèle qui suffit, vérifie, et relance les sessions devenues trop lourdes.</p>
${mot ? `<p class="mot">${esc(mot.mot)}</p>` : ''}
<h2>Vos ${JOURS} derniers jours</h2>
<p class="sub">Tirés de ce Mac, jamais envoyés. Survolez un chiffre pour sa définition et sa source.</p>
<div class="kpis">${kpis}</div>
<h2>Ce qui change dès maintenant</h2>
<p class="sub">Sept mécanismes, chacun comparé à vos chiffres.</p>
<div class="cartes">${cartesHtml}</div>
<h2>Commandes utiles</h2>
<p class="sub">À taper dans Claude Code.</p>
<div class="cmds">${CMDS.map(([k, v]) => `<div class="cmd"><code>${esc(k)}</code><p>${esc(v)}</p></div>`).join('')}</div>
<h2>Tout retirer</h2>
<p class="sub">Un seul script, réversible.</p>
<div class="retrait"><p><code>~/orchestration-claude/desinstaller.sh</code></p><p>Il enlève les hooks de ce dépôt dans les réglages de Claude Code, les liens des skills et les tâches mensuelles. Il garde le dossier, vos mesures, et une sauvegarde des réglages (settings.json.avant-desinstallation).</p></div>
<footer>Le 1er du mois, une fenêtre vous propose de partager ces chiffres, jamais vos messages. Rien ne part sans « Partager ». Rouvrir cette page : <code>/orch accueil</code></footer>
</main></body></html>`;
const sortie = path.join(os.homedir(), '.cache/orchestration/bienvenue.html');
fs.mkdirSync(path.dirname(sortie), { recursive: true });
fs.writeFileSync(sortie, html);
console.log(`Page d'accueil : ${sortie}`);
if (!a.includes('--sans-ouvrir')) spawnSync('open', [sortie]);
