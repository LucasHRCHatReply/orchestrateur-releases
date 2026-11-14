---
name: sessiondesk
description: Le bureau de l'orchestration, en page locale — ce qu'orchestre cette session, ses sous-sessions et ses agents à leur poste (qui travaille, qui a fini, modèle · effort, coût, contexte), une frise de qui a travaillé quand, un « voir plus » qui raconte en français ce que chacun a fait, rendu et laissé, et un sélecteur pour passer aux autres orchestrations du Mac. `/sessiondesk`.
version: 1.3.0
model: claude-haiku-5-5
effort: low
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/skills/sessiondesk/lancer.sh:*)
---

# /sessiondesk — le bureau de l'orchestration

La page est calculée **avant ce tour**, sans modèle, par `outils/bureau.mjs` du dépôt du skill : la famille de sessions
vient de `outils/ranger.mjs` (magasin de l'app, transcriptions, `ps`), les agents de `~/.claude/projects/…/subagents/`.
Les travaux confiés à d'autres modèles que Claude (GPT/Codex, Gemini, Antigravity) y figurent aussi, **sans transcription lue** : ce sont les essais de `outils/intermodele.mjs` (banc, journal `~/.cache/orchestration/intermodele/*.jsonl`, et `perfs/<compte>/intermodele.jsonl` partagé par GitHub). Ils ont leur pôle « Hors Claude » au bureau, une rangée par fournisseur dans la frise, un tableau dans la liste, et l'onglet **Comparer** les met côte à côte par type de tâche, compte par compte.
Un serveur local (`http://127.0.0.1:4517`, s'arrête seul après 3 h sans visite) sert la page et la relit toutes les 5 s ; il ne recalcule que si un fichier a bougé (empreinte tailles + dates, 5 ms). Le coût est le relevé de Claude Code (`cost-state`) quand il couvre la session, sinon le calcul aux prix publics du modèle exact.
Seul le récit « voir plus » passe par Haiku 5.5 · low, à la demande, mis en cache tant que l'état ne change pas.

## Sortie déjà calculée

!`${CLAUDE_PLUGIN_ROOT}/skills/sessiondesk/lancer.sh`

## Comment répondre

1. **Recopier la sortie ci-dessus telle quelle** (titre, phrase, tableau, lien). Ne rien recalculer.
2. Si elle est vide ou montre une erreur, relancer une seule fois `${CLAUDE_PLUGIN_ROOT}/skills/sessiondesk/lancer.sh` par Bash, tel quel.
3. Finir par une ligne : « Bureau : les postes et leur état · Liste : les tableaux · Temps : qui a travaillé quand · Comparer : les modèles côte à côte · « Voir plus » sur chacun · le menu en haut change d'orchestration. » Rien d'autre.
