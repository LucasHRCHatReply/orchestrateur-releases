# Manuel des modèles (évaluations publiées, relevé du 13/11/2026)

> **Depuis la V3 (16/11/2026, décision L-13), la table de routage est `references/routage-v3.md`** (résumé : `SKILL.md` § 3) : 16 usages, chacun avec construit · vérifie · escalade. Ce manuel garde le détail des chiffres du 13/11. Chaque section porte ci-dessous **REMPLACÉ PAR LA V3**, **CONFIRMÉ PAR LA V3** ou **HORS TABLE** ; une ligne « Modèle · effort » marquée REMPLACÉ ne se suit plus. Règle V3 : Fable ne construit jamais (il vérifie et escalade), jamais Astra, Argon ni l'effort max.

## Comment lire ce manuel

Le manuel dit, pour 11 usages : **modèle · effort recommandé**, ce que les évaluations publiques donnent (chiffre, URL, date), l'alternative moins chère, ce qu'il faut éviter. Il alimente l'orchestrateur V3 ; le banc v1 (nos propres mesures) vient après lui et le corrige (dernière section).

Méthode : cinq questions ont été posées à Gemini 4 Hydrogen medium et à GPT-6.1 Sol medium avec recherche web (`sorties/q1` à `q5`). **Chaque chiffre cité ici a été relu à sa source par WebFetch le 13/11/2026.** Un chiffre que les deux fournisseurs donnent mais que la source n'a pas confirmé n'est pas repris (liste dans `veille-gemini-contre-gpt.md`). Les dates sont celles affichées par la page ; une page de classement sans date affichée est notée « consultée le 13/11/2026 ».

**Décision de cadrage — les 11 usages.** Les cinq prompts couvrent cinq sujets, pas 11 usages. Les 11 usages ci-dessous sont déduits des cinq sujets (code, raisonnement et outils, rédaction/veille/contexte long, vision/images, front-end/données/tâches longues) et de la table de décision de `ROUTAGE-IA.md (notes de banc de l’auteur)` (section 12), qui ajoute les petites tâches. Ce découpage est un choix de cette session, pas une liste imposée.

**Règles tenues partout** : jamais GPT-6 Astra (quota : `ROUTAGE-IA.md (notes de banc de l’auteur)`, règle 4), Gemini 4 Argon seulement au-dessus de 30 % de quota hebdomadaire, jamais l'effort `max`. Astra et Argon figurent dans les tableaux publics parce que les classements les contiennent ; ils ne sont jamais recommandés. Un effort recommandé que la source n'a pas mesuré est écrit « non mesuré ».

Avertissement général : un score public est mesuré par un éditeur ou un tiers sur ses propres tâches, avec son propre dispositif. Les scores SWE-bench Pro V2 sont tous au-dessus de 87 % : le classement est saturé et départage mal.

---

## 1. Code

> **REMPLACÉ PAR LA V3** : code spécifié et testé → Haiku · medium (tests, puis Sonnet · low) ; code de dépôt ou difficile → Sonnet · medium, Opus · medium vérifie, Fable · high escalade. « Sonnet · xhigh » ne se suit plus.

- **Modèle · effort : Claude Sonnet 5.5 · xhigh.**
- Ce que ça donne : 95,79 ± 1,30 % sur SWE-bench Pro V2 (xhigh, mini-swe-agent), https://labs.scale.com/leaderboard/swe_bench_pro_public_v2?tab=full (consulté le 13/11/2026, sans date de mesure). 70,6 % sur Terminal-Bench 4.0, https://www.anthropic.com/claude-sonnet-5-5 (28/09/2026), contre 66,4 % pour Opus 5.5 à xhigh, https://www.anthropic.com/claude-opus-5-5 (22/09/2026) : Sonnet n'est pas derrière Opus en code.
- Effort : FrontierCode 1.1 (Main) donne 52,1 % à xhigh et 46,2 % à max pour Sonnet 5.5, https://www.anthropic.com/claude-sonnet-5-5 (28/09/2026) : monter à max baisse le score.
- Alternative moins chère : Claude Haiku 5.5 · high, 87,23 ± 2,36 % (Scale, même URL), soit 8,6 points de moins ; 46,4 % sur FrontierCode 1.1, https://www.anthropic.com/claude-haiku-5-5 (07/10/2026).
- Autres lignes Scale (même URL) : GPT-6.1 Sol xhigh 96,11 ± 1,24 % ; Gemini 3.8 Flash high 94,86 ± 1,46 % ; Argon high 99,22 ± 0,45 % (non retenu : quota).
- Autre mesure : FrontierSWE v2, Fable 5.2 69,9 %, Opus 5.5 62,3 %, https://www.anthropic.com/claude-fable-and-mythos-5-2 (09/11/2026, effort « le plus haut disponible » selon la page).
- À éviter : conclure d'un SWE-bench Verified. La page Vals est archivée (« performance saturée ») et ne liste ni Opus 5.5 ni Sonnet 5.5 ; Gemini 3.8 Flash y fait 80,00 %, https://www.vals.ai/benchmarks/swebench (mise à jour 01/09/2026). À éviter aussi : les « SWE-bench Pro » d'Opus et de Sonnet donnés par Gemini (89,9 %, 81,3 %) : introuvables sur les pages Anthropic.

## 2. Raisonnement et usage d'outils (orchestrer, appeler des outils)

> **REMPLACÉ PAR LA V3** : raisonnement et maths → GPT Sol · high (repli Opus · high), Opus · high vérifie ; agents et terminal → Sonnet · high, Opus · medium vérifie. Opus ne « décide » plus seul : il vérifie.

- **Modèle · effort : Claude Opus 5.5 · high.**
- Ce que ça donne : ARC-AGI-2 par effort pour Opus 5.5 : low 70,1 %, medium 87,5 %, **high 93,3 %**, xhigh 92,5 %, max 91,7 %, https://arcprize.org/results/anthropic-claude-opus-5-5 (page consultée le 13/11/2026). Le meilleur effort est high ; au-delà le score baisse.
- Outils : MCP Atlas, Opus 5.5 85,40 ± 2,20, https://labs.scale.com/leaderboard/mcp_atlas (la page se dit mise à jour le 08/04/2026 alors qu'elle liste des modèles de septembre 2026 : date à prendre avec réserve). Sonnet 5.5, Fable 5.2 et les GPT-6 n'y figurent pas : N/D.
- Raisonnement difficile, humain : Humanity's Last Exam avec outils, Sonnet 5.5 64,5 %, Haiku 5.5 57,4 % (45,9 % sans outils), https://www.anthropic.com/claude-haiku-5-5 (07/10/2026).
- Alternative moins chère : GPT-6.1 Sol · medium, ARC-AGI-2 86,7 % (high 91,7 %, xhigh 91,7 %, max 94,2 %), https://arcprize.org/results/openai-gpt-6-1-sol (consulté le 13/11/2026) ; coût par jeton affiché 2 $ en entrée, 10 $ en sortie par million.
- À éviter : Haiku 5.5 sous xhigh et Opus à low (70,1 %). Ne pas croire « Opus 5.5 = 91,3 % » donné par Gemini : 91,3 % est le score d'Argon à high, https://arcprize.org/results/google-gemini-4-argon (résultats ARC-AGI-3 standard d'Argon incomplets, la page le dit).

## 3. Rédaction

> **REMPLACÉ PAR LA V3** : rédaction qui doit plaire → Gemini Flash · high (repli Sonnet · medium), Opus · high vérifie ; sous contraintes → Sonnet · medium, script de comptage puis Opus · medium.

- **Modèle · effort : Claude Opus 5.5 · high.**
- Ce que ça donne : Arena Creative Writing, 1517 ± 11 (rang 2, high), https://arena.ai/leaderboard/chat/text/creative-writing (11/11/2026). Les modèles de comparaison sur la même page : Gemini 3.8 Flash high 1488 ± 7 (préliminaire), Sonnet 5.5 xhigh 1464 ± 12, GPT-6 Astra 1451, GPT-6.1 Sol 1449, GPT-6 Luna 1408.
- Alternative moins chère : Gemini 3.8 Flash · high (1488, préliminaire) ou Sonnet 5.5 · xhigh (1464).
- À éviter : les GPT-6 pour le style (de 1408 à 1451, derrière les Claude et les Gemini de la page). Argon est premier (1523 ± 10) : non retenu (quota). Haiku 5.5, Fable 5.2 et GPT-6.1 Terra ne figuraient pas dans la page lue : N/D. EQ-Bench n'a pas été recoupé : les valeurs données ne sont pas reprises.

## 4. Veille et recherche web

> **CONFIRMÉ PAR LA V3** : GPT Sol · medium avec recherche (repli Sonnet · medium) ; en plus, Claude relit chaque chiffre à sa page et Opus · medium escalade.

- **Modèle · effort : GPT-6.1 Sol · medium avec `--search`** (verdict du comparatif Gemini/GPT mené ici : `veille-gemini-contre-gpt.md`).
- Ce que ça donne : Search Arena, GPT-6.1 Sol 1230 ± 8 (max), Claude Opus 5.5 1213 ± 7 (medium), https://arena.ai/leaderboard/chat/search (08/11/2026). Aucun Gemini 4 ni Haiku sur cette page. Firecrawl Search Lift avec Alexandria : Opus 5.5 79,0, Sol 77,9, Haiku 5.5 61,9, https://www.firecrawl.dev/benchmarks/search-lift (10/11/2026) ; aucun Gemini.
- Alternative moins chère : Claude Sonnet 5.5 · medium avec outil de recherche (mesuré au banc seulement) ; Haiku 5.5 est à 61,9 sur Firecrawl, 17 points sous Opus.
- À éviter : Gemini 3.8 Flash seul pour la veille (le plus lent et le plus faible au banc v1 ; absent des classements publics lus). Ne pas reprendre les BrowseComp : Gemini donne 90,4 à 95,4 % pour Opus et Sol, GPT cite 87,5 % pour Sol par un relais ; la page OpenAI (https://openai.com/index/gpt-6-astra/) répond 403 et aucune page primaire lue ne tranche. Toute veille se recoupe par WebFetch avant remise.

## 5. Très long contexte

> **REMPLACÉ PAR LA V3** : GPT Sol · high par recherche dans le fichier, script puis Gemini Flash · high ; confiance faible (banc maison seulement).

- **Modèle · effort : non établi par des évaluations publiques lues.** Aucun score MRCR, RULER ni Fiction.LiveBench n'a pu être recoupé : GPT n'en retrouve qu'un (Astra, page 403) et Gemini en cite sans source lisible. Résultat N/D, jamais 100 %.
- Ce que ça donne : fenêtres annoncées de 1 million de jetons pour les Claude 5.5 et de 1,05 million pour les GPT-6 par les deux rendus ; non recoupé (pages https://platform.claude.com/docs/en/models/overview et https://developers.openai.com/api/docs/models/gpt-6.1-sol non relues).
- Repli mesuré par nous : le banc v1 (section « Contradictions ») : GPT-6.1 Sol high par recherche dans le fichier, Gemini Flash high pour lire tout le texte.
- À éviter : se fier à une fenêtre annoncée comme à une longueur utile.

## 6. Vision et multimédia (lire une image, une vidéo, un son)

> **REMPLACÉ PAR LA V3** : images, documents et rendu → Gemini Flash · low, Opus · high vérifie ; audio → Gemini Flash · low, Haiku vérifie la transcription. « Opus · high pour l'image » ne se suit plus.

- **Modèle · effort : Claude Opus 5.5 · effort high pour l'image ; Gemini 3.8 Flash pour l'audio.** L'effort high n'est pas mesuré publiquement pour l'image.
- Ce que ça donne : MMMU-Pro, Opus 5.5 88 % (max, arrondi affiché), GPT-6 Astra 87 % (max), https://artificialanalysis.ai/evaluations/mmmu-pro (consultée le 13/11/2026). Les autres modèles n'étaient pas lisibles sur la page.
- Audio : aucun score public d'écoute native recoupé ; décision tirée du banc v1 (Flash seul, GPT 0 sur l'audio).
- Alternative moins chère : Claude Haiku 5.5 · low pour PDF, image, vidéo (banc).
- À éviter : conclure d'un MMMU-Pro d'agrégateur ; les valeurs « ~84 % » ou « ~86 % » de Gemini n'ont pas de page primaire lisible.

## 7. Génération d'images, textures, direction artistique

> **CONFIRMÉ PAR LA V3** : GPT-Image par Sol · medium, Opus · high vérifie sur capture.

- **Modèle · effort : GPT-6.1 Sol · medium qui appelle l'outil GPT-Image.**
- Ce que ça donne : Arena text-to-image : GPT-Image-2.5 Sunburst 1429 ± 5, GPT-Image-2.6 Sunburst (Medium) 1406 ± 13, GPT-Image-2.5 Flare 1398 ± 5, https://arena.ai/leaderboard/image/text-to-image (12/11/2026). Gemini Nano Banana 2.1 : 1327 ± 9, rang 7, préliminaire (même page).
- Alternative moins chère : Nano Banana 2.1 (Gemini), 102 points d'Elo sous GPT-Image-2.6 Sunburst medium.
- À éviter : demander une image raster à Claude (la page https://platform.claude.com/docs/en/build-with-claude/vision décrit l'envoi d'images à Claude, pas leur production ; le banc v1 donne du SVG seulement). À éviter aussi : les modèles texte Gemini 3.8 Flash et Argon pour produire l'image ; aucune évaluation publique de textures ou de direction artistique n'a été trouvée (GenEval n'a de ligne pour aucun des 11 modèles) : ce point reste un jugement par captures.

## 8. Front-end et animations

> **REMPLACÉ PAR LA V3** : Sonnet · xhigh, Opus · high vérifie, Fable · high escalade. Fable n'est plus « premier choix qualité » : il ne construit jamais.

- **Modèle · effort : Claude Sonnet 5.5 · xhigh** (premier choix qualité : Fable 5.2 · xhigh).
- Ce que ça donne : WebDev Arena, Fable 5.2 1838 ± 21 (xhigh), Opus 5.5 1815 ± 12 (max), Sonnet 5.5 1772 ± 10 (xhigh) et 1715 ± 8 (high), GPT-6.1 Sol 1743 ± 10 (max), Gemini 4 Hydrogen 1704 ± 14 (high, préliminaire), https://arena.ai/leaderboard/code/webdev (11/11/2026). De high à xhigh, Sonnet gagne 57 points.
- Alternative moins chère : Sonnet 5.5 · high (1715), ou Haiku 5.5 · high (1593 ± 8).
- Design Arena Overall Agentic (instantané du 13/11/2026, valeurs qui varient d'un relevé à l'autre) : GPT-6.1 Sol max 1421, Opus 5.5 high 1405, Fable 5.2 1356, Sonnet 5.5 1283, https://www.designarena.ai/leaderboard?section=overall. Le classement Sol devant Claude sur le design contredit WebDev Arena.
- À éviter : GPT-6 Luna (1577), Gemini 3.8 Flash (1583) ; Design Arena « Code Art » et « Code to Video » sont annoncés « coming soon » : aucune mesure d'animation publiée.

## 9. Données en masse (extraction, tableur, finance)

> **REMPLACÉ PAR LA V3** : données et extraction → GPT Terra · medium (repli Haiku · medium), schéma ou script puis Sonnet · low ; finance et tableur → Sonnet · medium, recalcul puis Opus · medium.

- **Modèle · effort : Claude Haiku 5.5 pour le volume, Sonnet 5.5 pour le contrôle.** Effort non indiqué par Vals sur la page lue.
- Ce que ça donne : Vals Finance Agent v2.1 : Fable 5.2 69,47 %, Opus 5.5 67,85 %, Argon 67,66 %, Sonnet 5.5 67,28 %, Gemini 3.8 Flash 65,76 %, Haiku 5.5 65,37 %, Hydrogen 65,12 %, Sol 61,82 %, Astra 60,43 %, Luna 56,84 %, Terra 55,96 %, https://www.vals.ai/benchmarks/fabv2-1 (11/11/2026 ; scores non comparables à la v2). Excel Modeling Benchmark v1.1 : Fable 5.2 77,38 %, Sonnet 5.5 75,90 %, Opus 5.5 75,84 %, Hydrogen 75,80 %, Flash 72,87 %, Haiku 5.5 65,48 %, https://www.vals.ai/benchmarks/emb-v1-1 (11/11/2026).
- Alternative moins chère : Haiku 5.5 sur la finance (2,5 points sous Opus) ; pas sur le tableur (10,4 points sous Sonnet).
- À éviter : les GPT-6 pour la finance agentique (Luna 56,84, Terra 55,96). BIRD et Spider n'ont pas été recoupés ; aucun score de débit d'extraction sur des millions de lignes n'existe dans les sources lues.

## 10. Tâches longues autonomes

> **HORS TABLE** : la V3 ne dit rien de plus ; la boucle construire, vérifier, reprendre, escalader (`SKILL.md` § 3 b) borne chaque étape.

- **Modèle · effort : Gemini 4 Hydrogen · high pour la régularité, Claude Sonnet 5.5 pour les jalons de contrôle.** Effort Vending-Bench non indiqué.
- Ce que ça donne : Vending-Bench 2 (solde final moyen sur une année simulée) : GPT-6 Astra 15 514,70 $ ± 1 074, Hydrogen 14 549,49 $ ± 495, Argon 13 718,16 $ ± 3 100, GPT-6.1 Sol 12 860,61 $ ± 1 043, Sonnet 5.5 11 165,28 $ ± 1 585, https://andonlabs.com/evals/vending-bench-2 (page sans date, consultée le 13/11/2026). Opus 5.5 n'est pas dans les dix premières lignes lues (Opus 5 : 11 181,87 $ ± 2 094).
- METR (horizon à 50 %) : la page n'a pas été mise à jour depuis le 08/09/2026 (« plus mise à jour ») et ne liste ni Opus 5.5, ni GPT-6, ni Gemini 4, https://metr.org/time-horizons/. Aucun horizon n'est donc publié pour ces modèles. METR précise : l'horizon est la durée de la tâche pour un humain expert, pas la durée de travail de l'agent, et les tâches sont « bien spécifiées » ; au-delà de 16 h, la mesure est jugée peu fiable.
- À éviter : Argon sur une longue chaîne (écart ± 3 100 $, le plus large du haut de tableau) ; quoi qu'il en soit, Argon est exclu par quota.

## 11. Petites tâches (tri, résumé, petite modification, note à gabarit)

> **CONFIRMÉ PAR LA V3** : Haiku · medium, contrôle mécanique ou Sonnet · low sur échantillon, escalade Sonnet · medium.

- **Modèle · effort : Claude Haiku 5.5 · medium** (choix économe du banc v1) ; GPT-6 Luna · high si le quota GPT est ouvert.
- Ce que ça donne : aucune évaluation publique ne mesure ces tâches. Source des chiffres : banc v1 seulement, `ROUTAGE-IA.md (notes de banc de l’auteur)` section 9 (06/11/2026) : haiku-5-5 medium 0,905 à 0,0008 $ par essai ; gpt-6-luna high 0,937 à 0,0012 $.
- Alternative : Sonnet 5.5 · low (0,941, 0,011 $).
- À éviter : monter l'effort : au banc, Sonnet high (0,914) est moins bon que low (0,941). Terra low (0,886, fiabilité 0,115).

---

## Jusqu'où automatiser un projet

Constat public : **aucune évaluation publiée ne mesure la durée de travail autonome fiable de ces modèles.** METR n'a rien publié pour eux depuis le 08/09/2026 ; Vending-Bench 2 mesure une année *simulée* d'un commerce, pas un projet réel ; la limite de deux heures par tâche de Finance Agent est un plafond, pas une durée réussie (https://www.vals.ai/benchmarks/fabv2-1).

Ce que les chiffres autorisent :
- Les écarts de répétition comptent autant que la moyenne : sur Vending-Bench 2, Hydrogen tient ± 495 $, Sonnet 5.5 ± 1 585 $, Argon ± 3 100 $ (https://andonlabs.com/evals/vending-bench-2). Un agent à variance large échoue de temps en temps de façon complète : le contrôle ne s'économise pas.
- Les tâches publiques sont « propres et bien spécifiées » (METR, https://metr.org/time-horizons/) : un projet réel, flou, se comporte moins bien que son score.

**Règle de prudence (décision de cette session, non mesurée).** Automatiser par étapes de quelques minutes dont le critère de fin est vérifiable par un programme (tests, JSON valide, adresse qui répond) ; Claude contrôle chaque rendu avant l'étape suivante ; un humain valide les jalons qui engagent (publication, écriture chez un client, suppression). Ne pas lancer de chaîne de plusieurs heures sans point de contrôle : rien dans les sources publiques ne le justifie.

## Contradictions avec le banc v1

Le banc v1 est `bancv1/routage.txt` et `ROUTAGE-IA.md (notes de banc de l’auteur)` (06/11/2026). Lu le 13/11/2026.

| Sujet | Évaluations publiques | Banc v1 | Lecture |
|---|---|---|---|
| Effort chez Claude | Opus ARC-AGI-2 : low 70,1 → high 93,3 (+23 points) ; Sonnet WebDev : high 1715 → xhigh 1772 | « Claude : l'effort ne change presque rien » (4 crans sur 54) | Contradiction apparente : les tâches du banc sont faciles et saturées (code : 1,0 partout). L'effort rapporte sur le dur, pas sur le courant. |
| Plafond d'effort | Opus ARC-2 baisse après high ; Sonnet FrontierCode baisse de xhigh à max | Sonnet high moins bon que low sur perso | Concordance : ne pas monter au-delà du premier palier qui suffit. |
| Code, petit modèle | SWE-bench Pro V2 : Haiku 87,23, Sonnet 95,79 (8,6 points d'écart) | haiku-5-5 low = 1,0 comme Opus | Contradiction : le public départage Haiku, le banc non (banc saturé). Garder Haiku pour la petite modification, pas pour un dépôt entier. |
| Rédaction | Arena créatif : Opus 1517, Flash 1488 > Sonnet 1464 ; Argon premier | sonnet-5-5 medium en tête (0,948) ; Argon high 0,907 | Contradiction : préférence humaine contre grille de contraintes. Opus ressort aux deux ; trancher Sonnet ou Opus par un essai à l'aveugle. |
| GPT pour le style | GPT-6 à 1408–1451, derniers de la page | Sol et Luna corrects en rédaction | Mineure : écart de goût, pas de défaut de grille. |
| Données | Finance Agent : Luna 56,84, Terra 55,96, Haiku 65,37 | Luna high en tête sur la masse (0,991) | Contradiction : le banc masse est structuré (JSON, valeurs) ; Finance Agent est agentique et plus dur. Luna pour l'extraction propre, pas pour le raisonnement financier. |
| Images | GPT-Image Sunburst en tête (1429/1406) ; Nano Banana 2.1 7ᵉ | Sol medium 0,730, Opus SVG 0,730 ; Gemini 2 tâches sur 7 | Concordance : GPT premier. |
| Veille | GPT en tête sur Search Arena (1230) ; Gemini 4 absent des classements lus | Flash le plus lent et faible (0,633–0,819) | Concordance (par absence) ; le comparatif de cette session confirme. |
| Tâches longues | Hydrogen le plus stable (± 495) | non mesuré | Pas de contradiction ; à tester au banc avant de s'y fier. |
| Astra | Premier sur Vending-Bench, 2ᵉ de WebDev | Exclu : quota (1,6 point de limite 5 h par essai) | Pas de contradiction : bon score, coût de quota prohibitif. |

## Sources (hors blocs ci-dessus)

- Arena texte général : https://arena.ai/leaderboard/chat/text (non relu : valeurs Opus 1507, Sonnet 1473 etc. de GPT non reprises).
- Vals Index et modèles : https://www.vals.ai/models/anthropic_claude-sonnet-5-5 (non relu).
- Consignes du banc : `ROUTAGE-IA.md (notes de banc de l’auteur)`, `bancv1/routage.txt`.
