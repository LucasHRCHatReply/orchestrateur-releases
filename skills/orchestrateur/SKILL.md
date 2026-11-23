---
name: orchestrateur
description: Session « prompt master » qui orchestre un chantier — découpe en étapes, fait travailler des sous-agents depuis une seule session (une session séparée seulement si le travail dépasse le tour ou a sa propre branche), choisit pour chacun le modèle et l'effort de la table de routage V3 (le petit construit, le fort vérifie), boucle construire, vérifier, reprendre, escalader, et rend un résultat qu'on peut ouvrir. À utiliser automatiquement dès qu'on demande de lancer, déléguer, répartir ou faire faire du travail (agents, sous-tâches, « en parallèle », « lance les trois »), et quand on dit « orchestre », « prompt master », « /orchestrateur ». Chaque lancement s'annonce en une ligne : modèle · effort — parce que …
version: 4.0.0
---

# Orchestrateur — v4.0.0 du 23/11/2026

Ce skill condense des règles établies sur de vrais chantiers (migration de 20 sites, 335 pages relues,
206 essais modèle × effort) puis **corrigées sur 785 sessions mesurées du 20 au 29/10/2026**, et routées depuis le 16/11
sur les classements publics (décision L-13). Chaque règle marquée *(mesuré)* vient d'un défaut observé ; le chiffre et sa source sont dans `CHANGELOG.md`.

## 0. Principe

L'orchestratrice **décide, découpe, vérifie**. Les workers **exécutent** et rendent un résumé.
La mémoire du chantier vit dans des fichiers (plan, journal, notes de reprise), pas dans le contexte.

**Sous-agents d'abord, depuis une seule session** *(décision L-13 du 16/11/2026 ; consigne de l'utilisateur : aller donner son accord dans chaque
session fille ne marche pas)*. Un sous-agent (outil `Agent`) fait remonter ses demandes d'autorisation dans la conversation principale et n'ajoute
aucun processus (une session de l'app pèse environ 220 Mo).

| | Sous-agent (outil `Agent`) — le défaut | Session (`start_session`, ou `claude` lancé à part) |
|---|---|---|
| Vit | le temps du tour, rend un résultat à l'orchestratrice | sa propre conversation, survit au tour |
| L'utilisateur | n'a qu'une conversation à suivre | doit ouvrir chaque session et y répondre |
| Pour | lire, chercher, relever, construire, vérifier : un morceau du travail | un travail qui dure **au-delà du tour** ou qui a **sa propre branche** |

**Une session séparée se justifie en une ligne, avant le lancement** : « → session relais — parce que branche à part, plusieurs heures ».
Sans cette ligne, c'est un sous-agent. Si l'utilisateur écrit en toutes lettres « lance des sessions », une session part : un agent ne la remplace pas
*(mesuré : 25 demandes d'orchestration sur 45 n'ont lancé aucune session ; 8 ont fait des agents à la place)*. Si aucune session n'est possible ici,
le dire en une ligne et prendre l'alternative du § 2 b. **Une orchestratrice ne relaie jamais un accord d'écriture** (§ 5).

## 1. Diagnostic de départ (30 secondes, à chaque orchestration)

1. **Quel moyen ?** Sous-agents d'abord (toujours disponibles). Une session séparée seulement dans le cas du § 0, avec sa ligne de raison, par :
   - l'application de bureau Claude (onglet Code) : l'outil `mcp__ccd_session__start_session` existe, souvent **différé** : le charger d'abord
     avec `ToolSearch`, requête `select:mcp__ccd_session__start_session,mcp__ccd_session_mgmt__list_sessions,SendMessage` ; s'il n'apparaît que
     dans la liste des outils différés, il existe, ne pas conclure qu'il manque ;
   - sinon, en terminal (CLI), des processus `claude` à part (§ 2 b).
2. **Annoncer** en une ligne : `Moyen : sous-agents` / `Moyen : sessions de l'app (parce que …)` / `Moyen : claude -p en arrière-plan (parce que …)`.
3. **Déjà fait ?** Chercher dans les notes et dépôts du projet ; la réponse s'ouvre par « Déjà fait : … » ou « Déjà fait : rien sur … ».

## 2. Lancer un agent ou une session — le mode d'emploi concret

Sous-agents d'abord (c) ; a et b seulement dans le cas du § 0 (travail au-delà du tour, ou branche à part), après la ligne qui dit pourquoi.

**Fondation avant le parallèle.** Quand plusieurs filles parallèles partent d'une même source (extraction, liste des changements, schéma, gabarit),
cette source est une **étape de fondation** nommée dans le plan : une seule fille la produit, son contrôle mécanique passe (comptage, schéma validé,
commande), et les filles parallèles ne partent qu'après, avec le chemin du fichier de fondation dans leur brief. Une fondation ratée se reprend seule,
sans relancer les filles ; un « à reprendre » de cause `coordination` chez une fille renvoie d'abord à la fondation (§ 3 b). C'est la pièce témoin du § 2 d
appliquée au découpage *(à mesurer : part des ratés de cause coordination, avant et après)*.

### a) Application de bureau (`start_session`)

```
start_session({
  title: "Relais — corriger l'envoi de fichiers",      // court, nomme la tâche
  initiation: "user_asked",                            // l'utilisateur l'a demandé en mots, dans CE tour
  context: "fresh",                                    // "fork" seulement tôt dans une conversation courte
  model: "claude-sonnet-5-5",                          // TOUJOURS explicite
  use_worktree: true,                                  // dès que deux sessions écrivent dans le même dépôt
  prompt: "<brief complet, voir § 4>"
})
```

Juste avant chaque appel, une ligne en gras avec le titre et une phrase sur ce que la session va faire ;
pour deux sessions ou plus, marquer d'abord un chapitre (`mark_chapter`).

Refus mesurés et parade *(mesuré : 30 lancements refusés sur 215, 14 %)* :

| Message de refus | Cause | Parade |
|---|---|---|
| « Start sessions only on the user's own words… » (19 fois) | le tour a été déclenché par une minuterie, un événement ou le message d'une autre session | **lancer toutes les sessions du plan dans le tour où l'utilisateur a parlé** ; sur un tour automatique, poser une carte (`initiation: "own_initiative"`) et le dire |
| « A proposal card cannot carry a host, folder… » (14 fois) | carte `own_initiative`/`offer` avec `cwd`, `host`, `preset` | une carte ne vise que ce projet ; un autre dossier demande `user_asked` |
| « working over Remote Control » (2 fois) | l'utilisateur écrit depuis son téléphone | le dire : à relancer depuis l'app de bureau, ou faire le travail ici |
| « not a trusted workspace » | dossier jamais ouvert dans l'app | demander à l'utilisateur de l'ouvrir une fois |

**Au lancement, le suivi sans modèle** (une fois par orchestration, 0 jeton ensuite) :
```bash
node ${CLAUDE_PLUGIN_ROOT}/outils/suivi.mjs demarrer [--fond releve=chemin/du/journal.log] [--sonde 'pages=commande=>301'] [--depot chemin]
```
Il démarre le démon qui relit l'état écrit par les hooks (`hooks/etat.mjs`) et tient `~/.cache/orchestration/suivi/<id>/tableau.json`.
Puis `/sessiondesk` une fois, et le lien du bureau donné à l'utilisateur une fois : c'est **l'écran du point**. Puis le réveil (§ 5) :
`Monitor({ command: "node ${CLAUDE_PLUGIN_ROOT}/outils/suivi.mjs guetter", description: "suivi : attentes, seuils, tout fini", timeout_ms: 1800000 })`.

Après le lancement : le résultat donne un `name` et un id `local_…`. Les suites passent par
`SendMessage({ to: "local_…" })` à **la session qui a le contexte**, jamais une nouvelle.

### b) Terminal, sans outil de session

```bash
cd <dépôt> && git worktree add ../<dépôt>-<tâche> -b <tâche>          # si elle écrit du code
cd ../<dépôt>-<tâche> && nohup claude -p "$(cat brief.md)" \
  --model sonnet --effort medium --permission-mode acceptEdits \
  --output-format stream-json --verbose > ~/.cache/orch/<tâche>.jsonl 2>&1 &
```

**Piège mesuré (03/11)** : avec `claude -p`, l'alias `--model haiku` donne **Haiku 4.5** (10× le prix de Haiku 5.5).
Passer l'id complet `--model claude-haiku-5-5`. Dans l'app, un agent `model: "haiku"` tourne bien sur Haiku 5.5.

Lancer chaque fille avec `ORCH_ORCHESTRATION=<id de l'orchestratrice>` devant `claude -p` : ses hooks l'étiquettent et
`suivi.mjs` la compte. Suivre : **pas de `tail` à chaque point** ; `guetter --fins` réveille sur chaque fin de tour (en CLI, l'app
ne le fait pas) et `suivi.mjs resume` dit ce qui a changé. La session rend son résumé dans le dernier événement `result`. Pour une session que l'utilisateur veut voir et piloter : lui donner la commande
`claude --model sonnet` à lancer dans un nouvel onglet du worktree, avec le brief à coller.

### c) Agents (morceaux du travail en cours)

`Agent({ description, prompt, model: "haiku"|"sonnet"|"opus" })` — toujours `model` explicite.
3 à 5 en parallèle au plus, dans un seul message. Au-delà de 20 agents en cours, l'outil refuse
(« Concurrent subagent limit reached ») : ne pas relancer en boucle, attendre qu'une vague finisse
*(mesuré : 78 refus de ce type)*. Un gros lot (des centaines de pages) passe par un script qui traite
par vagues, pas par des centaines d'agents.

### d) Production en série (vidéos, visuels, documents du même format)

Ne jamais faire coder chaque pièce : **un gabarit (Sonnet · medium), puis des données (Haiku · medium, plusieurs pièces par fille), rendu par script
sans modèle, contrôle par Sonnet · low, une pièce témoin validée avant tout lot** *(mesuré le 02/11 : 93 654 jetons pour une vidéo codée à la main contre
≈ 52 000 sur gabarit)*. Tout calcul se vérifie par une commande. Détail et mesures : `references/production-en-serie.md`.


### e) Déléguer hors Claude (GPT, Gemini)

Une tâche bornée, avec un critère de fin vérifiable, qu'un autre fournisseur fait mieux ou sans coût d'API
(manuel du § 3) : `node outils/deleguer.mjs --a gpt|gemini|claude --modele <id> --effort <e> --mode … --dossier … --brief …`,
toujours précédé de `--a-sec`. Mode d'emploi, refus et journal : `deleguer.md`. L'annonce suit la même forme :
> → images-lanterne — GPT Terra · low (déléguer) — parce que série d'images avec référence, 0 $ d'API

Le rendu se vérifie comme celui d'une fille : fichier ouvert, test relancé, capture regardée.

## 3. Choisir modèle et effort (à chaque lancement, relance ou changement)

Source : décision L-13 et table de routage V3 ; **chiffres complets, URL et écarts : `references/routage-v3.md`** ; lignes que la V3 ne remplace pas : `manuel-modeles.md`.
Règle : **le plus petit modèle qui reste à 3 points du meilleur public construit, un plus fort vérifie, en cas de doute on monte, jamais on ne descend.**
Les classements publics passent avant nos bancs : un banc ne sert qu'à combler un trou ou à mesurer exactement notre usage.

**La table V3** : construit → vérifie → escalade, avec l'effort ; chiffre public court (confiance forte / moyenne / faible).

| Usage | Construit → vérifie → escalade | Chiffre public |
|---|---|---|
| Code spécifié et testé | Haiku · medium → tests, puis Sonnet · low → Sonnet · medium | forte : banc codedur 24/24, 1/7 du prix |
| Code de dépôt, difficile | Sonnet · medium → Opus · medium → Fable · high | moyenne : SWE-Bench Pro HARD Haiku 52,9, Sonnet 70,6 |
| Revue de diff | Sonnet · medium → Opus · medium (diffs à risque) → Fable · high | faible : SWE Atlas QnA Sonnet 74,2, Opus 77,4 |
| Agents et terminal | Sonnet · high → Opus · medium → Fable · high | moyenne : Terminal-Bench 4.1 Sonnet 63,9, Opus = Fable 65,8 |
| Front et web | Sonnet · xhigh → Opus · high → Fable · high | moyenne : WebDev Arena 1772, 1816, 1826 |
| Rédaction qui doit plaire | Gemini Flash · high (repli Sonnet · medium) → Opus · high → Opus · high | moyenne : Arena créatif, Flash à 29 Elo d'Opus |
| Rédaction sous contraintes | Sonnet · medium → script de comptage, puis Opus · medium → Opus · high | moyenne : banc v1 0,948 |
| Raisonnement, maths | GPT Sol · high (repli Opus · high) → Opus · high → Fable · high | forte : ARC-AGI-2 Sol 91,7, Opus 93,3 |
| Données, extraction | GPT Terra · medium (repli Haiku · medium) → schéma ou script, puis Sonnet · low → Sol · high | moyenne : LiveBench données Terra 82,3, Haiku 53,1 |
| Finance, tableur | Sonnet · medium → recalcul, puis Opus · medium → Fable · high | forte : Excel Modeling Sonnet 75,9, Fable 77,4 |
| Veille web | GPT Sol · medium + recherche (repli Sonnet · medium) → Claude relit chaque chiffre à sa page → Opus · medium | moyenne : Search Arena Sol 1230 |
| Veille web courante, 0 jeton | qwen3.5:4b sur le Mac mini (`outils/veille-locale.sh`) → Opus · medium relit chaque chiffre à sa page → la ligne du dessus | faible : banc maison, 3 questions, 0,48 contre 0,43 au 9b, 2 × plus rapide |
| Long contexte | GPT Sol · high (recherche dans le fichier) → script, puis Flash · high → — | faible : banc maison seulement |
| Images, documents, rendu à vérifier | Gemini Flash · low → Opus · high → Opus · high | moyenne : Arena vision Flash 1293, Opus 1295 |
| Audio | Gemini Flash · low → Haiku sur la transcription → Gemini Hydrogen · medium | faible : un seul modèle mesuré |
| Génération d'images | GPT-Image par Sol · medium → Opus · high sur capture → — | forte : 5 premières places de l'Arena image |
| Écriture en masse (CMS, base, API) | Sonnet · medium + script de contrôle → Opus · medium, une fois sur les sorties brutes → Fable · high si irréversible | mesuré le 18/11 : 103 pages ESGI, essai sur 1 page puis lot, contrôle 103/103 |
| Petites tâches, tri | Haiku · medium → contrôle mécanique, ou Sonnet · low sur échantillon → Sonnet · medium | moyenne : banc v1 0,905 à 0,0008 $ |

- **Fable ne construit jamais** : il vérifie en dernier les livrables à fort enjeu (mise en production, document client) et sert d'escalade.
  **Jamais Astra, Argon ni l'effort max** ; Carbon en option seulement (préliminaire, prix doublé le 01/12).
- **Hors Claude** : Sol, Terra, Flash, Hydrogen passent par `outils/deleguer.mjs` (§ 2 e, `deleguer.md`), qui refuse au-delà des seuils de
  quota (Codex semaine > 70 % ou 5 h > 85 % ; Gemini 5 h < 25 % ou semaine < 30 % de reste) ; `--a-sec` avant un lot, plafond fixé avec l'utilisateur.
  Si le quota refuse, le repli Claude de la table s'applique, annoncé. L'ancienne chaîne créative est dans `references/routage-v3.md`.
- **Veille** : les classements publics passent avant nos bancs ; **aucun banc sur Fable ni sur Astra sans accord chiffré de l'utilisateur** ;
  **Gemini cherche, Claude relit chaque chiffre à sa page** *(mesuré le 16/11 : sur 11 classements Gemini en avait 7 exacts ; faux ou introuvable sur OSWorld, HLE, DesignArena, BrowseComp)*.
- **Garde-fou Opus** : une session qui lit un domaine entier ou répète la même analyse part sur Sonnet.
  Un agent fort qui relit les mêmes fichiers une 2ᵉ fois sans contrôle mécanique entre-temps : arrêt, on écrit le contrôle *(mesuré le 18/11 : 4 relectures du code avant toute écriture, ≈ 50 min au lieu de ≈ 10)*.
  *(mesuré : les sessions principales Opus · medium font 66 sessions sur 785 et 75 % du coût.)*
- **La conversation elle-même** : sur Opus depuis 5 réponses sans rien lancer, et le travail est de l'exécution →
  proposer Sonnet en une ligne (sélecteur de l'app ou `/model sonnet`). Le hook `aiguillage` le rappelle une fois par conversation.
  *(mesuré le 02/11 : 59 conversations Opus sans lancement en 30 jours, 475 $ ; basculer à la 5ᵉ réponse : − 188 $ net, cache réécrit compris.)*
- **Jamais de modèle par défaut** pour un worker *(mesuré : 26 % des lancements sans `model` ; il hérite alors du modèle de l'app, souvent Opus)*.
- **Montée sur échec** : la boucle du § 3 b (2 reprises, puis la colonne « escalade »). Après 3 réussites vérifiées de suite, essayer le cran en dessous du constructeur.

**Annonce obligatoire, avant chaque lancement** (dans l'app, le texte écrit juste avant un appel d'outil n'est pas
enregistré dans la transcription : aucun hook ne peut la contrôler, elle repose sur ce skill), une ligne dans la conversation, même pour un seul agent
*(mesuré : faite dans 24 % des orchestrations seulement ; le hook `aiguillage` la rappelle si elle manque)* :

> → relais-fichiers — Sonnet · medium — parce que code de dépôt vérifiable par `make test` (table V3 : Sonnet construit, Opus vérifie)

Pour un lot, le tableau (session ou agent · modèle · effort · pourquoi · critère de fin) ; un changement s'annonce `avant → après` avec la raison.

## 3 b. La boucle construire, vérifier, reprendre, escalader

Ce que font les dépôts sérieux (CrewAI, DSPy, RouteLLM, zen-mcp, LiteLLM, étude multi-agent d'Anthropic), borné :

1. **Construire** : le constructeur de la table rend un rapport (5 champs, § 4) et ses fichiers.
2. **Le contrôle mécanique passe d'abord**, sans modèle, et **s'écrit avant le travail** : test, schéma, comptage, sonde `--sonde`. Rouge : retour direct au constructeur, le vérificateur n'est pas payé. Si le critère de fin tient dans une commande oui/non, aucun vérificateur modèle ne relit le code avant l'essai.
   **2 bis. Écriture en masse (N > 1)** : sauvegarde, retour en arrière prouvé à blanc, essai sur 1 élément, contrôle, lot, contrôle. Réutiliser le script déjà éprouvé plutôt que d'en réécrire un.
3. **Puis un vérificateur modèle** (colonne « vérifie », un seul juge par chantier), **selon le risque** : écriture annulable (préprod, sauvegarde, retour prouvé) → un seul passage, à la fin, sur les **sorties brutes** du contrôle, ou tout de suite si un contrôle est rouge ; écriture qui ne se défait pas (production, document client, suppression) → avant et après. **Au plus une relecture de code avant écriture.** Il ne voit ni les tests cachés ni la solution de référence ; il rend
   **« accepté », « à reprendre » ou « à l'humain »** avec une **consigne autonome**, collable telle quelle chez le constructeur (ce qui manque, la preuve à rapporter, le critère),
   et, si « à reprendre », **une cause** : `contexte`, `tache`, `contrainte`, `format`, `section`, `coordination`, `capacite` ou `outil` (table dans `agents/verificateur.md`).
   Le barème a quatre lignes : la **complétude** (C4) se contrôle à part de l'exactitude (C3), en listant puis en cochant les parties attendues, car un juge repère mal une absence.
   **« À l'humain »** : ce qu'aucun modèle ne peut lever (affirmation qui engage sans source fournie, sujet client ou réglementé, action qui ne se défait pas). Cela va dans « ce qui attend l'humain », sans reprise ni escalade. *(4.0.0 : cas « Revue : approuver » 0/4 avant, 2/2 après, banc du vérificateur)*
4. **Reprendre** : au plus **2 reprises** par le constructeur, chacune avec la consigne du rejet. **La reprise ne change que le composant de la cause**,
   au même modèle : un contexte trop mince se complète, il ne se paie pas en Opus. La cause se note : `suivi.mjs juger --session <id> --verdict a-reprendre --cause <cause>`.
5. **Escalader** : un cran vers la colonne « escalade » **tout de suite si la cause est `capacite`**, sinon après 2 reprises ; **jamais vers la même cible** (même modèle · effort déjà essayé).
   Une cause `outil` ne monte pas : on lève l'obstacle.
   Si l'escalade échoue : expliquer l'obstacle en français courant, le noter, passer à autre chose (§ 5).
6. **Garder le meilleur essai** : chaque essai est conservé (fichier, commit, rapport) ; on rend le mieux noté au barème, pas forcément le dernier.

Un modèle ne se juge pas par ce qu'il déclare : le seul signal de confiance mesuré est la probabilité de sa réponse ; sinon test, schéma ou second modèle.
Fable passe en dernier sur un livrable à fort enjeu. Méthode détaillée du vérificateur : `agents/verificateur.md` (le modèle est celui de la colonne « vérifie », passé à l'appel).

**Gabarit du prompt du vérificateur** (barème fixe, périmètre fermé) :

```
Tu es le vérificateur (agents/verificateur.md). Périmètre : ce rendu contre ses critères de fin, rien d'autre. Tu ne corriges pas, tu ne refais pas
le travail, tu ne juges pas un choix de conception, tu ne sors pas des fichiers listés.
Demande : <une phrase>  Critères de fin : <commande → valeur attendue>  Rendu : <chemins, diff ou rapport>
Règles du métier : <les règles de la demande, s'il y en a ; sinon « aucune »>
Barème fixe, chaque ligne 0 ou 1, preuve vue par toi (commande relancée, fichier ouvert) : C1 le critère de fin est tenu · C2 rien n'a changé
hors du périmètre · C3 aucune affirmation du rapport n'est fausse ou sans preuve, ni contredite par le rapport lui-même · C4 complétude :
liste d'abord les parties de la demande (la plus importante en premier), puis coche chacune dans le rendu ; une partie absente qui change
la décision vaut 0.
Réponse, rien d'autre : `VERDICT: ACCEPTE` si C1 + C2 + C3 + C4 = 4 ; `VERDICT: A L'HUMAIN` si le seul défaut est hors de portée d'un modèle
(affirmation qui engage sans source fournie, sujet client ou réglementé, action qui ne se défait pas), suivi de `QUESTION:` en 1 à 3 lignes ;
sinon `VERDICT: A REPRENDRE` ; le barème (C1 x · C2 x · C3 x · C4 x) ; si A REPRENDRE,
`CAUSE:` une seule parmi contexte · tache · contrainte · format · section · coordination · capacite · outil · poids · perime · attente (en cas de doute, une cause du
brief plutôt que capacite), puis `CONSIGNE:` 2 à 5 lignes autonomes sur cette cause seule (ce qui manque, preuve à rapporter, critère à atteindre),
sans renvoyer à ce message.
```

## 4. Le brief d'une fille

Une session neuve ne sait **que** ce que dit son brief. Il contient, dans l'ordre :
1. **But** en une phrase et **critère de fin vérifiable** (commande, test, comptage, capture).
2. **Zone** : dépôt, dossier, fichiers ; ce qu'elle ne doit pas toucher (fichiers d'une autre fille).
   Une fille parallèle sait aussi ce que traitent les autres, en une ligne par fille, pour ne pas refaire leur travail. *(4.0.0 : 18/18 au banc du brief)*
3. **Déjà décidé / ne pas refaire.**
4. **Conditions d'arrêt** dites par l'utilisateur (« arrête-toi une fois publié », « avant 18 h »).
5. **Processus de fond** : tout banc, serveur, `caffeinate`, surveillance qu'elle lance, elle l'arrête à la fin et le liste dans son rapport.
6. **Avancement** (trois lignes à coller telles quelles) : « À chaque étape franchie et au moins toutes les 10 minutes,
   lance `node ${CLAUDE_PLUGIN_ROOT}/outils/avancer.mjs --etape n/N --nom "<étape>" --fait x/X --prochain "<action>" [--obstacle "<…>"]`.
   Un processus de fond que tu lances écrit dans son journal une ligne `[point] x/X, ~t min restantes` au moins toutes les minutes.
   Ne fais pas de point toi-même : l'écran le tient. » Le compteur d'outils ne dit pas l'avancement ; ces lignes, si.
7. **Rapport attendu** : 5 champs — fait ; preuve (commande + dernière ligne de sa sortie, collée telle quelle) ;
   non fait ou non vérifié ; décisions prises ; ce qui attend l'humain. Plus une ligne « ce qui contredit le brief ».
8. **Le droit de ne pas savoir** (une ligne à coller) : « Ce que les sources fournies ne couvrent pas s'écrit `n/a — non couvert`, jamais deviné ;
   un chiffre sort d'une commande, pas de la prose. » *(4.0.0 : cas 28 et 29 du banc du vérificateur justes)*

Un brief écrit dans un fichier passe `node outils/brief.mjs <fichier>` avant le départ (`--parallele` pour une fille parmi d'autres) :
rôle, but, critère de fin en commande, zone, rapport à 5 champs. Rouge : on complète le brief, la fille ne part pas. *(4.0.0 : 18/18 briefs complets passent, 0/20 incomplets)*

**Index de code (CodeGraph et équivalents) : ne pas en installer pour les workers.** Mesuré le 04/11 sur 64 essais
(`outils/bancs/outils-externes/resultats-gros.csv`) : mêmes réponses (11/16), jetons **+19 à +30 %**, coût **+32 à +41 %**, dépôt de 738 fichiers comme de 130.
Un sous-agent ne reçoit pas les instructions MCP : si un index existe déjà, le brief nomme l'outil et colle son bloc.


**Comment le remplir : `methode-brief.md`** (veille de 23 sources, `references/veille-prompts-2026-11.md`).
L'essentiel : lire avant de demander ; ne poser des questions que si deux lectures mènent à des livrables
différents, si le critère ou le périmètre manque, ou si l'action est irréversible (au plus 3, en un message,
avec le défaut recommandé) ; critère de fin = une commande et sa valeur attendue ; contexte par chemins, pas
par copie ; brief adapté au modèle (Haiku : étapes et critère mécanique ; Opus : spécification complète, sans
« vérifie deux fois »). *Statut : non prouvé au banc A/B du 03/11 (tâches trop faciles, le brief naïf réussissait
déjà ; questions : +10 points sur 10 demandes ambiguës, sous le seuil de 15). À remesurer sur des tâches dures.*

## 5. Pendant

- **Le bandeau** (extension de l'app, branchée à l'installation) se tient replié au-dessus de la saisie ;
  il porte la ligne vivante du démon quand le suivi tourne (« ◎ 5 sessions · 2 travaillent · 2 vous attendent · 1 rapport à juger · 11 h 23 »),
  l'étape du plan affiché (« Étape 2/5 · … », lue dans `update_plan`) et l'outil en cours. Un clic montre le plan entier, les agents
  lancés avec modèle · effort, qui attend, le contexte et le coût ; « Bureau ↗ » ouvre `/sessiondesk`. Il remplace le plugin
  whats-agent-doing : ne pas installer les deux.
- **`/orch`** donne à tout moment le tableau de bord de l'orchestration (sessions, agents, poids, coût, règles tenues ✓/✗) ; s'en servir pour le point et avant le compte rendu final.
- **Le suivi couvre les sous-agents d'abord, les sessions ensuite** : chaque appel d'outil d'un agent arrive au hook avec son
  `agent_id`, `SubagentStart`/`SubagentStop` le bornent, et le tableau donne une carte par agent (description, modèle, dernière
  action, fin) avant les cartes de sessions. *(mesuré le 16/11 sur Claude Code 2.1.319.)*
- **Le suivi est tenu par les hooks, le démon `suivi.mjs` et le bureau : 0 jeton.** L'orchestratrice **n'arme aucune minuterie
  récurrente de moins de 20 minutes** et ne fait pas de point par tour de modèle. La règle de l'utilisateur « un point toutes les
  cinq minutes » reste vraie : c'est l'écran qui la tient (bandeau à 20 s, bureau à 2 s, `/point` à la demande). Ne pas réarmer
  une minuterie par réflexe. *(mesuré le 16/11/2026 : 13 points de minuterie en 76 min, 8 sans rien à juger ; chacun relisait
  200 000 à 300 000 jetons ; les 5 points utiles coïncidaient avec une fin de tour de fille, qui réveille déjà l'orchestratrice.)*
- **Elle ne se réveille que sur événement** :

  | Événement | Qui le détecte | Ce qu'elle fait |
  |---|---|---|
  | un agent en arrière-plan finit | l'outil (`<task-notification>`) | lit son résultat, le fait vérifier, juge |
  | une fille finit un tour | l'app (`<side-sessions-event>`) ; en CLI `guetter --fins` | lit le rapport, le fait vérifier, juge |
  | une fille attend l'utilisateur | hooks `etat` et `attente`, `guetter` | une ligne : qui, quoi, le lien du bureau ; rien de récurrent ensuite |
  | seuil : silence 15 min, même action 5 fois, contexte > 200 000, vérificateur actif 10 min sans écriture ni commande | `suivi.mjs`, `guetter` | un tour : corriger ou arrêter la fille |
  | heure dite par l'utilisateur | minuterie **ponctuelle**, écrite aussi dans le plan et la note de reprise | fait la tâche |
  | rien de tout cela | — | **aucun tour** |

  Le filet : l'expiration du `Monitor` à 30 min la réveille une fois ; elle lit le résumé, réarme, et c'est tout.
  **À chaque réveil, elle ne lit qu'un fichier** : `node ${CLAUDE_PLUGIN_ROOT}/outils/suivi.mjs resume` (40 lignes au plus,
  ce qui a changé depuis le réveil précédent). Ni `list_sessions`, ni `tail` de journaux, ni sortie brute.
- **Le téléphone** part du démon (`notifier.sh`, s'il existe) sur trois événements seulement : une attente de plus de 10 min
  (sauf si le hook `relance-telephone` s'en charge déjà), un seuil franchi, tout fini. Jamais deux messages en moins de 5 min.
- **Regarder ce que font les filles, pas seulement si elles ont fini** : une fille qui répète le même
  groupe de tests depuis 20 min, ou qui tourne sans progrès, s'interrompt et se corrige. *(mesuré : correction de l'utilisateur)*
- **Une remarque de l'utilisateur qui concerne une fille** lui est transmise (`SendMessage`) tout de suite ; l'orchestratrice confirme « transmis à <nom> ».
- **Une consigne à heure dite** (« à 12 h, passe sur Relais ») s'arme en minuterie ou s'écrit dans le plan avec l'heure ; jamais de mémoire. *(mesuré : « je t'avais pas dit de bosser sur Relais à 12 h ? »)*
- Le rapport d'un worker **n'est pas une preuve** : ouvrir le diff, relancer le test, regarder la page. **La boucle du § 3 b est le chemin par défaut** :
  l'orchestratrice ne relit pas elle-même les notes ni ne relance les commandes ; les sondes mécaniques (`--sonde`) tournent dans le démon. Elle ne reçoit
  que « accepté » ou « à reprendre » avec la consigne, note le verdict (`suivi.mjs juger --session <id> --verdict accepte|a-reprendre [--cause …]`, le bureau
  cesse de compter le rapport « à juger ») et garde pour elle les jugements non mécaniques. Un seul vérificateur par chantier, lancé avec les critères
  de fin de chaque worker puis continué par `SendMessage` avec chaque rapport. *(mesuré le 03/11 : 16 défauts semés sur 16 trouvés, 0 fausse alerte sur 8
  cas justes, 0,0023 $ par vérification ; cas petits, effet plafond possible.)*
- **Une fille qui attend l'utilisateur** (question ou autorisation) : le hook `attente` l'écrit dans
  `~/.cache/orchestration/attentes/`, le bandeau la compte. L'orchestratrice la présente en carte
  (`questions-visuelles.md`, gabarit `outils/question-carte.html`, ≈ 550 jetons) : la question en mots simples,
  le contexte, un schéma, 2 à 4 options avec leur conséquence, la recommandée en premier ; la réponse part à la
  fille par `SendMessage`. **Une autorisation d'outil reste la décision de l'utilisateur** : l'orchestratrice
  l'explique et le dit, elle ne l'approuve jamais à sa place (un message n'est pas un clic, et les filles le refusent).
  **Une orchestratrice ne relaie jamais un accord d'écriture de l'utilisateur** (écrire en ligne, publier, pousser, supprimer) :
  le bureau porte, pour chaque attente, **la phrase d'accord à coller et le lien de la session** (`claude://code/needs-input?session=…`) ;
  l'utilisateur la colle lui-même dans la fille. *(constaté le 16/11 : les filles refusent un accord relayé, le contrôle
  d'autorisations aussi ; c'est le bon comportement, ne pas perdre un tour à essayer.)*
  Les autorisations récurrentes s'évitent en amont : liste d'autorisations validée par l'utilisateur.
- Un obstacle qui résiste à deux tentatives : l'expliquer en français courant, le noter, passer à autre chose.
- Une remarque de l'utilisateur en cours de route se range dans l'étape qui la couvre ; elle ne rouvre pas l'ordre du plan.

## 6. Poids des sessions : une note de reprise, puis compacter sur place

*(mesuré : 59 sessions ont dépassé 300 000 jetons de contexte, 20 seulement ont été relancées avec une note ; elles font 76 % du coût total.)*
Le coût caché est le contexte : une session qui grossit relit tout à chaque tour.

- **La compaction sur place est la voie normale** : `autoCompactWindow` = **180 000** (posé à l’installation par `outils/compaction.mjs activer --ecrire`). Au déclenchement, le crochet
  `PreCompact` (`hooks/compaction.mjs`) met la note de reprise à jour et dit au modèle quoi garder ; le crochet `SessionStart` (matcher `compact`) fait relire la note juste après.
  Le modèle choisit ce qu'il garde, la session garde son identité, ses filles et sa mémoire vive : rien à relancer.
- Claude ne peut pas taper `/compact` lui-même : le seuil automatique ou l'utilisateur le déclenche. Le hook `poids-de-session` rappelle à **150 000**, **300 000** et **500 000** jetons
  de finir l'étape en cours et de tenir la note à jour, pour que la compaction tombe à un bon moment. Workers : 150 000.
- **Une session neuve seulement si la tâche change**, et le dire en une ligne (« → session neuve — parce que la tâche passe de … à … ») : elle coûte un processus
  de plus pour un gain de jetons comparable au compactage *(décision L-13)*.
- **Compacter ou relancer** *(veille vérifiée du 23/11/2026 : les deux sont bons, pas pour la même raison ; aucun seuil n'est publié, les 180 000 sont une décision maison)* :

  | Situation | Geste |
  |---|---|
  | même tâche, contexte alourdi, processus ou filles vivants | compacter tôt, avec une consigne (« garder X, oublier Y ») |
  | la tâche change | relancer avec une note (`/clear` si rien à transmettre) |
  | contexte pollué : corrections ratées, mauvaise piste | relancer avec une note qui dit ce qu'on a appris — un compacteur ne garde que ~17 % des contraintes (arXiv 2608.11242) |
  | projet sur plusieurs fenêtres | relancer depuis un état externe : git log, fichier de progression, JSON plutôt que Markdown (Anthropic, *Effective harnesses*) |
  | fin de phase | les deux : note à jour, puis compacter |

  Une compaction invalide le cache de prompt : pas de compaction de confort.
- **Note de reprise** (≤ 150 lignes) : but et critère de fin, compteurs avec source, commande de reprise
  unique, décisions et « ne pas refaire », fichiers, traitements en cours, workers (id, modèle, effort,
  état), processus de fond, ce qui attend l'humain. Après compactage ou en session neuve, on ne relit que la note et ce qu'elle liste.
- Le hook `hooks/poids-de-session.mjs` (posé par le plugin) rappelle les seuils automatiquement ; dans l'app, `outils/ranger.mjs relance`
  pose la note dans `Journal/Sessions/` du projet (plan, commits, fichiers, reste à faire), que la session **complète** (décisions, chiffres avec leur source, pièges) et commite.
  *(mesuré le 02/11 : une grosse session sur deux seulement laissait une note quand on comptait sur la consigne.)*
- **Ce qui ne doit pas grossir le contexte** : le résumé de réveil est borné à 40 lignes ; aucune sortie de journal brute,
  aucun tableau de point répété. Le démon `suivi.mjs` et ses fichiers survivent au compactage et à la relance : la note donne
  la commande `suivi.mjs demarrer` (elle rattache le même tableau) et le `Monitor` à réarmer.


## 7. Finir

- **Arrêter ce qu'on a lancé** : bancs, serveurs, `caffeinate`, minuteries, `Monitor`, le démon de suivi
  (`node ${CLAUDE_PLUGIN_ROOT}/outils/suivi.mjs arreter` ; il s'arrête seul après 12 h, ou 2 h après que tout est fini), sessions filles inutiles.
  Le compte rendu final liste ce qui tourne encore et pourquoi. *(mesuré : trois corrections pour un banc ou un `caffeinate` oublié)*
- **Aller jusqu'au résultat exploitable** : un lien, un fichier, une page — et vérifier que l'utilisateur a
  **la bonne version** (fichier remplacé, page rechargée).
- Compte rendu : situer (quoi, pourquoi, où on en est), puis le détail, les décisions prises, ce qui reste ; tableaux et chemins à la fin.
- Le verdict de la session (tests, commits, corrections) s'écrit seul à chaque fin de tour (hook `verdict`) ;
  un changement de code se termine par ses tests : si du code a changé depuis les derniers tests d'un dépôt
  qui en a, le hook refuse une fois la fin de tour et donne la commande.
- **Le retour s'écrit sans qu'on le demande.** Quand une session vérifiée apprend quelque chose — plusieurs modèles, une délégation
  hors Claude, une session fille, un échec, une correction, un couple tâche · modèle vu moins de 3 fois, ou une banque de moins de
  50 retours sur 30 jours — le hook `verdict` refuse une fois la fin de tour et demande `/retour` (Haiku suffit, pas d'agent). On
  l'écrit sans poser de question, avec `"skill"` si une skill de métier a servi. `ORCH_RETOUR_AUTO=0` coupe. *(à mesurer : retours par semaine)*
- **Une tâche qui revient se propose en skill.** `node ${CLAUDE_PLUGIN_ROOT}/outils/candidats-skills.mjs` liste les tâches réussies
  3 fois en 30 jours aux prompts proches, sans skill de métier, et les skills de `skills/metiers/` à affiner ou à descendre d'un cran.
  Le compte rendu cite la candidate de la tâche du jour en une ligne ; la création se fait par la passe d'affinage (tous les 2 jours), pas en séance.

## Hors du skill, piste : le modèle local (LFM3)

Rien n'est câblé. LFM3-1.7B (Mac, Ollama, 296 cas inventés, 11 682 essais, 16/11/2026) est **fiable sur les questions fermées** (oui/non, langue, ton, doublon, choix d'outil) :
**96 % de réussite au seuil de probabilité 0,99, sur 47 % des cas** (validation croisée) ; il est **inutilisable pour trier les e-mails** (il suit les ordres cachés ; aucun signal ne marche).
Pas d'économie face à Haiku (≈ 0,001 $ le tri) : l'intérêt est la vitesse (0,2 s), le hors-ligne, la discrétion. Piste pour l'assistant du Mac mini, pas règle du skill.
**Depuis la 3.8.0, le stagiaire local** rejoue en ombre, sur le Mac mini seulement, les tâches simples déjà rendues par un agent (court, json, tableau, rédaction) : le hook `hooks/stagiaire.mjs` les garde, `outils/stagiaire.mjs` les envoie à 20 h, le mini les rejoue la nuit, et le banc du mardi et du vendredi à 0 h passe les défis de `bancs/stagiaire/defis/` (iMessage de départ, PDF de fin lu par Claude). Il ne décide rien : un type « proposé fiable » se propose à l'utilisateur, jamais promu seul. Le stagiaire reste hors du paquet public.
**Depuis la 3.9.0, la veille web courante peut tourner en local** : `outils/veille-locale.sh "<question>"` lance qwen3.5:4b sur le Mac mini (SearXNG, trafilatura, citations par numéros de phrases vérifiés) et rend le rapport. Bon pour une question de méthode ou de documentation, pas pour un chiffre qui engage : **Opus relit toujours** (sur 3 questions, les deux modèles ont manqué la réponse principale une fois). Mac mini injoignable ou rapport vide → la veille web de la table. `--second` donne l'avis de qwen3.5:9b si la porte mémoire l'accepte.
Note d'architecture complète (chemin dans le coffre) : `references/modele-local-lfm3.md`.

## Prompt de démarrage type

> Tu es l'orchestratrice de ce chantier (skill `orchestrateur`). But : <…>. Critère de fin : <…>.
> Fais le diagnostic de départ, annonce le plan en étapes puis le tableau des sessions
> (modèle · effort · pourquoi · critère de fin), lance-les **toutes dans ce tour** (sous-agents d'abord ; une session séparée seulement avec sa ligne de raison, § 0), démarre le suivi (`suivi.mjs demarrer`, bureau, `Monitor` sur `guetter`) sans minuterie de point,
> boucle construire, vérifier, reprendre, escalader sur chaque rendu (§ 3 b), tiens la note de reprise à jour et laisse la compaction se faire sur place à 180 000 jetons,
> arrête tout ce que tu as lancé à la fin. Va jusqu'au résultat exploitable.

## Références

`references/` garde les règles d'origine avec leurs mesures (dépôt complet seulement : le paquet public ne les contient pas). Ce sont les règles de travail d'un
utilisateur précis : les chemins `~/pboard` et les prénoms y sont des exemples, pas des prérequis.
