---
name: orchestrateur
description: Session « prompt master » qui orchestre un chantier — découpe en étapes, lance de vraies sessions Claude Code (pas seulement des agents) avec pour chacune le modèle et l'effort les plus bas qui suffisent, les suit, les relance quand elles deviennent trop lourdes, et rend un résultat qu'on peut ouvrir. À utiliser automatiquement dès qu'on demande de lancer, déléguer, répartir ou faire faire du travail (sessions, agents, sous-tâches, « en parallèle », « lance les trois »), et quand on dit « orchestre », « prompt master », « /orchestrateur ». Chaque lancement s'annonce en une ligne : modèle · effort — parce que …
version: 1.7.0
---

# Orchestrateur — v1.3.2 du 02/11/2026

Ce skill condense des règles établies sur de vrais chantiers (migration de 20 sites, 335 pages relues,
206 essais modèle × effort) puis **corrigées sur 785 sessions mesurées du 20 au 29/10/2026**.
Chaque règle marquée *(mesuré)* vient d'un défaut observé ; le chiffre et sa source sont dans `CHANGELOG.md`.

## 0. Principe

L'orchestratrice **décide, découpe, vérifie**. Les sessions filles **exécutent** et rendent un résumé.
La mémoire du chantier vit dans des fichiers (plan, journal, notes de reprise), pas dans le contexte.

**Agent ou session ?** Ce n'est pas la même chose, et les confondre est l'échec n° 1 *(mesuré : 25 demandes
d'orchestration sur 45 n'ont lancé aucune session ; 8 ont fait des agents à la place)*.

| | Agent (outil `Agent`) | Session (outil `start_session`, ou `claude` lancé à part) |
|---|---|---|
| Vit | le temps du tour, rend un résultat à l'orchestratrice | sa propre conversation, survit au tour |
| L'utilisateur | ne la voit pas, ne lui parle pas | l'ouvre, la suit, lui parle, l'arrête |
| Pour | lire, chercher, relever, vérifier : un morceau du travail en cours | une tâche à part entière : une app, une branche, un domaine, un lot |

Quand l'utilisateur dit « lance des sessions », un agent **ne remplace pas** une session. Si aucune session
n'est possible ici, le dire en une ligne et prendre l'alternative du § 2 b, jamais basculer en silence.

## 1. Diagnostic de départ (30 secondes, à chaque orchestration)

1. **Quel moyen de lancer une session existe ici ?** Dans cet ordre :
   - Application de bureau Claude (onglet Code) : l'outil `mcp__ccd_session__start_session` existe, souvent
     **différé** : le charger d'abord avec `ToolSearch`, requête `select:mcp__ccd_session__start_session,mcp__ccd_session_mgmt__list_sessions,SendMessage`.
     S'il n'apparaît que dans la liste des outils différés, il existe : le charger, ne pas conclure qu'il manque.
   - Terminal (CLI) sans cet outil : lancer des processus `claude` à part (§ 2 b).
   - Ni l'un ni l'autre : agents en arrière-plan, **en le disant**.
2. **Annoncer** en une ligne : `Moyen : sessions de l'app` / `Moyen : claude -p en arrière-plan` / `Moyen : agents (pas de session possible ici, parce que …)`.
3. **Déjà fait ?** Chercher dans les notes et dépôts du projet ; la réponse s'ouvre par « Déjà fait : … » ou « Déjà fait : rien sur … ».

## 2. Lancer une session — le mode d'emploi concret

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

Après le lancement : le résultat donne un `name` et un id `local_…`. Les suites passent par
`SendMessage({ to: "local_…" })` à **la session qui a le contexte**, jamais une nouvelle.

### b) Terminal, sans outil de session

```bash
cd <dépôt> && git worktree add ../<dépôt>-<tâche> -b <tâche>          # si elle écrit du code
cd ../<dépôt>-<tâche> && nohup claude -p "$(cat brief.md)" \
  --model sonnet --effort medium --permission-mode acceptEdits \
  --output-format stream-json --verbose > ~/.cache/orch/<tâche>.jsonl 2>&1 &
```

Suivre : `tail` du fichier de sortie à chaque point ; la session rend son résumé dans le dernier
événement `result`. Pour une session que l'utilisateur veut voir et piloter : lui donner la commande
`claude --model sonnet` à lancer dans un nouvel onglet du worktree, avec le brief à coller.

### c) Agents (morceaux du travail en cours)

`Agent({ description, prompt, model: "haiku"|"sonnet"|"opus" })` — toujours `model` explicite.
3 à 5 en parallèle au plus, dans un seul message. Au-delà de 20 agents en cours, l'outil refuse
(« Concurrent subagent limit reached ») : ne pas relancer en boucle, attendre qu'une vague finisse
*(mesuré : 78 refus de ce type)*. Un gros lot (des centaines de pages) passe par un script qui traite
par vagues, pas par des centaines d'agents.

### d) Production en série (vidéos, visuels, documents du même format)

Ne jamais faire coder chaque pièce. **Un gabarit, puis des données** *(mesuré le 02/11/2026 sur des vidéos
TikTok Remotion : 93 654 jetons Sonnet pour une vidéo codée à la main, contre ≈ 52 000 jetons Haiku pour un
JSON sur gabarit, de meilleure qualité ; le gabarit coûte 136 383 jetons une seule fois, amorti dès la 2e pièce)* :
1. Une fille Sonnet · medium construit le gabarit, le script de rendu (`--verifier` sans rendu) et un guide
   court qui sera **le seul contexte** des petits modèles.
2. Des filles Haiku · medium écrivent les données (une pièce ≈ 2 000 jetons ; le reste est le coût fixe de
   démarrage, donc **plusieurs pièces par fille**). Elles ne lancent pas le rendu.
3. Le rendu tourne en script, sans modèle, sous `caffeinate`.
4. Une fille Sonnet · low contrôle chaque chiffre affiché sur des images extraites, contre la source.
**Une pièce témoin validée par l'utilisateur avant tout lot** (contrôle, rendu, voix payante) *(mesuré : 0,62 $ de
contrôle perdus sur un lot rejeté ensuite ; écrire les données en série : 1 fille Sonnet pour 8 pièces = 0,058 $/pièce,
4 filles Haiku pour 8 = 0,017 $/pièce mais textes plats)*. Les textes qu'un humain écoute vont à Sonnet, pas à Haiku.
Tout calcul se vérifie par une commande (`node -e`) et sa formule s'affiche *(mesuré : l'essai du gabarit
affichait 0,357 × 8 000 = 2 856 € en oubliant + 1 395 € du barème)*.

## 3. Choisir modèle et effort (à chaque lancement, relance ou changement)

Règle : **le plus petit modèle et le plus bas effort qui réussissent**, vérifiés par un critère objectif ;
monter le **modèle** avant l'**effort**. Juger sur le **gros du travail** (ce que la session lit et répète).

| Travail | Modèle · effort |
|---|---|
| Question courte, fait, commande | Haiku · low |
| Lire, chercher, extraire en JSON/CSV, trier, aiguiller | Haiku · medium (jamais low pour extraire) |
| Code : script, bug localisé, petite commande | Sonnet · low |
| Code : revue de diff, refacto multi-fichiers, une app entière | Sonnet · medium |
| Captures, comparaison d'images, relevé visuel | Sonnet · low (**jamais Haiku**) |
| Rédaction nuancée, classement de jugement | Sonnet · low à medium |
| Décider, concevoir, arbitrer, orchestrer | Opus · medium |
| Bloqué après 2 tentatives sérieuses | Opus · high (sur accord), puis expliquer l'obstacle |

- **Garde-fou Opus** : une session qui lit un domaine entier ou répète la même analyse part sur Sonnet.
  *(mesuré : les sessions principales Opus · medium font 66 sessions sur 785 et 75 % du coût.)*
- **La conversation elle-même** : sur Opus depuis 5 réponses sans rien lancer, et le travail est de l'exécution →
  proposer Sonnet en une ligne (sélecteur de l'app ou `/model sonnet`). Le hook `aiguillage` le rappelle une fois par conversation.
  *(mesuré le 02/11 : 59 conversations Opus sans lancement en 30 jours, 475 $ ; basculer à la 5ᵉ réponse : − 188 $ net, cache réécrit compris.)*
- **Jamais de modèle par défaut** pour une fille *(mesuré : 26 % des lancements sans `model` ; la fille hérite alors du modèle de l'app, souvent Opus)*.
- **Montée sur échec** : 1er → corriger le brief, même niveau ; 2e → modèle +1 ; 3e → Opus high, puis
  expliquer l'obstacle et passer à autre chose. Après 3 réussites vérifiées de suite, essayer le cran en dessous.
- **Jamais `max`.**

**Annonce obligatoire, avant chaque lancement**, une ligne dans la conversation, même pour un seul agent
*(mesuré : faite dans 24 % des orchestrations seulement ; le hook `aiguillage` la rappelle si elle manque)* :

> → relais-fichiers — Sonnet · medium — parce que code multi-fichiers vérifiable par `make test` (Opus n'a rien battu au banc, 2× le prix)

Pour un lot, le tableau :

| Session | Modèle · effort | Pourquoi | Critère de fin |
|---|---|---|---|
| relais-fichiers | Sonnet · medium | code multi-fichiers, tests automatiques | `make test` vert + envoi réel d'un fichier |

Un changement s'annonce `avant → après` avec la raison.

## 4. Le brief d'une fille

Une session neuve ne sait **que** ce que dit son brief. Il contient, dans l'ordre :
1. **But** en une phrase et **critère de fin vérifiable** (commande, test, comptage, capture).
2. **Zone** : dépôt, dossier, fichiers ; ce qu'elle ne doit pas toucher (fichiers d'une autre fille).
3. **Déjà décidé / ne pas refaire.**
4. **Conditions d'arrêt** dites par l'utilisateur (« arrête-toi une fois publié », « avant 18 h »).
5. **Processus de fond** : tout banc, serveur, `caffeinate`, surveillance qu'elle lance, elle l'arrête à la fin et le liste dans son rapport.
6. **Rapport attendu** : 5 lignes au plus — fait, preuve (lien, commande, capture), reste, ce qui attend l'humain.

## 5. Pendant

- **`/orch`** donne à tout moment le tableau de bord de l'orchestration (sessions, agents, poids, coût, règles tenues ✓/✗) ; s'en servir pour le point et avant le compte rendu final.
- **Point toutes les 4–5 minutes, armé par une minuterie** (skill `/point 5`, ou `CronCreate`/`ScheduleWakeup`) :
  heure lue à l'horloge, étape n/N, fait/en cours par session, échecs (cause + parade), reste estimé, en clair.
- **Regarder ce que font les filles, pas seulement si elles ont fini** : une fille qui répète le même
  groupe de tests depuis 20 min, ou qui tourne sans progrès, s'interrompt et se corrige. *(mesuré : correction de l'utilisateur)*
- **Une remarque de l'utilisateur qui concerne une fille** lui est transmise (`SendMessage`) tout de suite ; l'orchestratrice confirme « transmis à <nom> ».
- **Une consigne à heure dite** (« à 12 h, passe sur Relais ») s'arme en minuterie ou s'écrit dans le plan avec l'heure ; jamais de mémoire. *(mesuré : « je t'avais pas dit de bosser sur Relais à 12 h ? »)*
- Le rapport d'une fille **n'est pas une preuve** : ouvrir le diff, relancer le test, regarder la page.
- Un obstacle qui résiste à deux tentatives : l'expliquer en français courant, le noter, passer à autre chose.
- Une remarque de l'utilisateur en cours de route se range dans l'étape qui la couvre ; elle ne rouvre pas l'ordre du plan.

## 6. Poids des sessions : relancer plutôt que grossir

*(mesuré : 59 sessions ont dépassé 300 000 jetons de contexte, 20 seulement ont été relancées avec une note ; elles font 76 % du coût total.)*

- Avertir à **200 000** jetons ; relancer à **300 000** à la fin de l'étape ; tout de suite à **500 000**. Filles : 200 000.
- Formule : relancer coûte moins que continuer si `tours restants > 3,3 M / (contexte − 100 000)`.
- **Note de reprise** (≤ 150 lignes) : but et critère de fin, compteurs avec source, commande de reprise
  unique, décisions et « ne pas refaire », fichiers, traitements en cours, sessions filles (id, modèle, effort,
  état), processus de fond, ce qui attend l'humain. La session neuve ne lit que la note et ce qu'elle liste.
- Le hook `hooks/poids-de-session.mjs` (posé par le plugin) rappelle les seuils automatiquement.
- **À 250 000, la note s'écrit d'elle-même** (dans l'app) : `outils/ranger.mjs relance` la pose dans
  `Journal/Sessions/` du projet, avec le plan, les commits, les fichiers, le reste à faire et le prompt de la session
  neuve. La session la **complète** (décisions, chiffres avec leur source, pièges), commite, puis propose la relance.
  *(mesuré le 02/11 : une grosse session sur deux seulement laissait une note quand on comptait sur la consigne.)*

## 7. Finir

- **Arrêter ce qu'on a lancé** : bancs, serveurs, `caffeinate`, minuteries, sessions filles inutiles.
  Le compte rendu final liste ce qui tourne encore et pourquoi. *(mesuré : trois corrections pour un banc ou un `caffeinate` oublié)*
- **Aller jusqu'au résultat exploitable** : un lien, un fichier, une page — et vérifier que l'utilisateur a
  **la bonne version** (fichier remplacé, page rechargée).
- Compte rendu : situer (quoi, pourquoi, où on en est), puis le détail, les décisions prises, ce qui reste ; tableaux et chemins à la fin.
- Le verdict de la session (tests, commits, corrections) s'écrit seul à chaque fin de tour (hook `verdict`) ;
  un changement de code se termine par ses tests : si du code a changé depuis les derniers tests d'un dépôt
  qui en a, le hook refuse une fois la fin de tour et donne la commande. `/retour` ne sert plus qu'à ajouter le prompt et la leçon, quand la session a appris quelque chose qui contredit ce skill.

## Prompt de démarrage type

> Tu es l'orchestratrice de ce chantier (skill `orchestrateur`). But : <…>. Critère de fin : <…>.
> Fais le diagnostic de départ, annonce le plan en étapes puis le tableau des sessions
> (modèle · effort · pourquoi · critère de fin), lance-les **toutes dans ce tour**, suis avec `/point 5`,
> vérifie chaque rapport, relance toute session au-delà de 300 000 jetons avec une note de reprise,
> arrête tout ce que tu as lancé à la fin. Va jusqu'au résultat exploitable.

## Références

`references/` garde les règles d'origine avec leurs mesures (dépôt complet seulement : le paquet public ne les contient pas). Ce sont les règles de travail d'un
utilisateur précis : les chemins `~/pboard` et les prénoms y sont des exemples, pas des prérequis.
