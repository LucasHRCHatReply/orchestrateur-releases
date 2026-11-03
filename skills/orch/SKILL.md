---
name: orch
description: Le tableau de bord de l'orchestration en cours — combien de sessions et d'agents elle a lancés, avec quel modèle, ce qu'ils coûtent, le poids du contexte, les règles du skill orchestrateur tenues ou manquées, et le bilan du mois. `/orch` (tableau), `/orch sessions`, `/orch agents`, `/orch poids`, `/orch cout`, `/orch regles`, `/orch bilan [jours]`, `/orch conseil`, `/orch accueil`, et `/orch ranger` qui archive les sessions finies après une note de reprise et dit la mémoire vive rendue.
version: 1.3.1
model: claude-haiku-5-5
effort: medium
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/skills/orch/lancer.sh:*)
argument-hint: "[sessions|agents|poids|cout|regles|bilan N|conseil|accueil|ranger]"
---

# /orch — où en est l'orchestration

Toutes les commandes lisent la transcription de **cette** session (ou de tout ce Mac pour `bilan`) avec
`outils/etat.mjs` du dépôt du skill. Rien n'est envoyé nulle part.

Le dépôt est le dossier du plugin : `DEPOT="${CLAUDE_PLUGIN_ROOT}"`.

| Commande | Ce qu'elle dit | Lancer |
|---|---|---|
| `/orch` | le tableau : sessions, agents, poids, coût, suivi, règles tenues | `node "$DEPOT/outils/etat.mjs" tableau --dossier "$PWD"` |
| `/orch sessions` | chaque session lancée : titre, modèle, heure, état, id | `… sessions …` |
| `/orch agents` | les 25 derniers agents : modèle, en fond ou non, rendu ou non | `… agents …` |
| `/orch poids` | la jauge du contexte et le nombre de tours à partir duquel relancer coûte moins | `… poids …` |
| `/orch cout` | le coût de la session, conversation et agents | `… cout …` |
| `/orch regles` | les règles du skill orchestrateur tenues (✓), manquées (✗) et pourquoi | `… regles …` |
| `/orch bilan [jours]` | le mois de ce Mac comparé aux mesures de la v1 (≈ 35 s) | `… bilan 30` |
| `/orch conseil` | quel modèle et quel effort pour quel travail, avec la mesure | `… conseil` |
| `/orch accueil` | rouvre la page d'accueil et réécrit le mot d'accueil | voir plus bas |
| `/orch ranger` | range l'orchestration : chaque session de la famille (état, âge, mémoire vive, contexte, coût, non commité, question), le tri archiver / garder / relancer, puis notes de reprise, archivage et bilan | voir plus bas |

## Sortie déjà calculée

Claude Code a lancé la commande avant ce tour (`/orch $ARGUMENTS`) ; sa sortie est ci-dessous :

!`${CLAUDE_PLUGIN_ROOT}/skills/orch/lancer.sh $ARGUMENTS`

## Comment répondre

1. **Recopier la sortie ci-dessus telle quelle** (tableaux, jauges, ✓ ✗ ·), sans relancer la commande et sans
   rien recalculer de tête. Ne relancer par Bash que si la sortie est vide ou montre une erreur.
2. Pour `/orch` et `/orch sessions` dans l'app de bureau : compléter l'état **en direct** des sessions filles avec
   `mcp__ccd_session_mgmt__list_sessions` `{"linked": true}` (charger par `ToolSearch` s'il est différé) —
   colonne « En direct » : travaille, attend l'utilisateur, finie.
3. Terminer par **une ligne** « À faire maintenant : … » quand une règle est ✗ ou que le poids dépasse 200 k
   (ex. « armer `/point 5` », « écrire la note de reprise et relancer »). Rien d'autre.

## `/orch accueil`

`node "$DEPOT/outils/accueil.mjs"` relit les 30 derniers jours, écrit la page `~/.cache/orchestration/bienvenue.html` et l'ouvre.
Puis écrire dans la conversation un mot d'accueil court et visuel à partir de la sortie `--texte` :
`node "$DEPOT/outils/accueil.mjs" --texte` (chiffres de l'utilisateur) — un titre, trois chiffres marquants en tableau,
les trois commandes à essayer d'abord (`/orch`, `/orch conseil`, « orchestre ce chantier : … »), ton chaleureux et direct, aucun chiffre inventé.

## `/orch ranger`

La sortie ci-dessus (`outils/ranger.mjs`) liste la famille de sessions, sa mémoire vive mesurée par `ps`, et
propose un tri. Elle finit par `Ids à archiver : …` puis par `Question à poser …`.

**Une seule commande est permise : `${CLAUDE_PLUGIN_ROOT}/skills/orch/lancer.sh ranger …`.** Aucune autre commande, jamais :
ni `timeout` (il n'existe pas sur macOS), ni `node`, ni `git`, ni `ps`. Si la sortie injectée est vide ou annonce un
passage en arrière-plan, relancer `${CLAUDE_PLUGIN_ROOT}/skills/orch/lancer.sh ranger` tel quel, sans rien y ajouter.

**Recopier la sortie mot pour mot, intégralement, tableaux compris** : ne pas la résumer, ne pas la mettre en liste,
ne pas réordonner les lignes, ne pas reformuler une cellule. N'ajouter qu'**une seule question**, à la fin : celle que
donne la ligne `Question à poser`, sans autre mot.

Déroulé habituel, **un seul oui pour toute la liste** :

1. Recopier la sortie telle quelle (voir ci-dessus).
2. Charger `mcp__ccd_session_mgmt__list_sessions` par `ToolSearch` et l'appeler avec `{"linked": true}`. Retirer
   de la liste toute session dont `isRunning` est vrai. Ne jamais archiver une session marquée 🟢 travaille, 🟠 attend ou 👁 qui surveille.
3. Poser la question de la ligne `Question à poser`. Rien d'autre tant que la réponse n'est pas un oui.
4. Sur oui, dans cet ordre :
   - Bash : `${CLAUDE_PLUGIN_ROOT}/skills/orch/lancer.sh ranger notes` (écrit les notes ; refuse d'elle-même une session qui travaille, attend ou surveille) ;
   - pour chaque id de la ligne `Prêtes à archiver : …`, `mcp__ccd_session_mgmt__archive_session` avec
     `reason` « rangée par /orch ranger, note de reprise écrite » — un refus (session ouverte à l'écran, épinglée) se note et on continue ;
   - Bash : `${CLAUDE_PLUGIN_ROOT}/skills/orch/lancer.sh ranger bilan`, et recopier ce bilan tel quel.
5. Finir par une ligne : les sessions 🔁 à relancer repartent d'une session neuve avec leur note pour seul brief.

États : 🟢 travaille = processus vivant et activité de moins de 3 min ; 🔴 interrompue = pas de processus et dernier tour
non terminé ; 💤 dort = pas de statut fini et inactive depuis plus de 30 min. Interrompues et dormeuses s'archivent, avec leur note.
Une session qui **surveille** (Monitor, cron, réveil programmé, tâche planifiée encore vivants) est toujours gardée ;
« ⚠ surveillance annoncée, aucune minuterie vivante » veut dire : à vérifier avec l'utilisateur avant d'archiver.

### Mode « tout archiver, reprendre dans la session active »

Quand l'utilisateur veut tout ranger et reprendre le travail dans la session active :

1. Bash : `${CLAUDE_PLUGIN_ROOT}/skills/orch/lancer.sh ranger tout --reprise-dans <id de la session active>` (sans id, c'est la session courante).
   Il écrit une note de reprise par session de la famille (sauf la courante et celles qui tournent vraiment : processus vivant
   et activité récente, ou surveillance vivante), plus une **note commune** (`…-reprise-commune-…`), et imprime
   `Note commune : …`, `Envoyer à : …`, `Prêtes à archiver : …`, `Gardées (tournent) : …`. Recopier cette sortie mot pour mot.
2. Si `Envoyer à` n'est pas la session courante : `mcp__ccd_session_mgmt__send_message` vers cet id avec le chemin de la note commune.
3. Une seule question : « Archiver ces N sessions ? » ; sur oui, `archive_session` pour chaque id de `Prêtes à archiver`
   (jamais une session de `Gardées`), puis `${CLAUDE_PLUGIN_ROOT}/skills/orch/lancer.sh ranger bilan`, recopié tel quel.

Archiver arrête le processus de la session (c'est ce qui rend la mémoire) et se défait par `unarchive_session`.
