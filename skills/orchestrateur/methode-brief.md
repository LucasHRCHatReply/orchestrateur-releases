# Méthode du brief — de la demande floue au travail confié

Complète le § 4 de `SKILL.md` (les 6 points du brief restent le squelette). Cette méthode dit **comment** les remplir.
Les numéros [n] renvoient à `references/veille-prompts-2026-11.md` (dépôt complet seulement). Rien n'est retenu sans mesure ou
sans explication du fonctionnement du modèle ; le reste est marqué *(opinion)*. Les hypothèses du § 5 ne sont **pas encore mesurées**.

## 0. Ce qui commande tout
Une session neuve ne voit ni la conversation, ni les fichiers déjà lus, ni la mémoire : le message de délégation est sa seule vue de la tâche [10].
Trois leviers pèsent plus que la rédaction : **le critère de fin vérifiable**, **les frontières de la tâche**, **la raison du travail**.
Un brief flou coûte deux fois : travail dupliqué ou hors sujet [7], puis un « terminé » que rien ne prouve [2, 9].

## 1. Questions à l'utilisateur avant de briefer

**Pourquoi demander, parfois.** Un modèle qui reçoit une demande incomplète invente la valeur manquante au lieu de la chercher [12] ;
une spécification qui arrive par morceaux fait perdre 39 % en moyenne, le modèle supposant tôt et s'accrochant à sa supposition [15].
Sur des tickets rendus incomplets, imposer la question quand il manque quelque chose donne 69,4 % de résolution contre 61,2 % avec un simple rappel,
pour un ticket complet à 70,8 % [14]. **Pourquoi pas toujours.** Plus de questions plafonne, voire nuit [13] ; chaque question coûte un tour
à l'utilisateur ; les guides vont aussi dans l'autre sens : documenter ses hypothèses plutôt que demander [11], ne
s'arrêter que si deux lectures mènent à des travaux très différents [4].

**Lire d'abord, trier ensuite.** Avant toute question : lire les notes, le dépôt, les règles de l'utilisateur. Puis ranger chaque inconnue :

| Inconnue | Traitement |
|---|---|
| Se lit dans un fichier, un historique, un message précédent | Lire. Ne pas demander. |
| Réversible et à faible coût de reprise (nom, ordre, mise en forme, quel test lancer) | Décider seule, le dire dans « décisions prises ». |
| Deux lectures mènent à des livrables différents (réécrire ou corriger ; une app ou toutes) | **Demander.** |
| Critère de fin, périmètre ou zone absents et non devinables | **Demander.** |
| Action irréversible, payante, envoyée à un tiers, ou écriture sur un système partagé | **Demander**, même si tout le reste est clair [11]. |
| Deux consignes de l'utilisateur se contredisent | **Demander** (un brief contradictoire fait dépenser du raisonnement à concilier [11]). |

**Déclencheurs, en bref :** verbe large sans objet (« améliore », « range », « regarde ») ; mot de périmètre manquant (« tout », « la doc ») ;
résultat attendu sans forme ; première fois qu'on travaille sur ce dépôt ou cette source. Une demande qui nomme son but, sa zone
et son critère de fin ne déclenche rien : briefer tout de suite.

**Forme.**
1. **Une phrase de reformulation** : « Compris : <but>, fini quand <critère>. » C'est la correction la moins chère : l'utilisateur
   corrige en cinq mots ou laisse passer.
2. **Au plus 3 questions, en un seul message, un seul tour.** Une ligne chacune, fermée si possible, avec le défaut recommandé :
   « Par défaut : corriger les écarts et marquer le périmé. OK, ou autre chose ? » Une question ouverte reste permise si elle est seule.
3. **Que des questions dont la réponse change le brief**, et auxquelles l'utilisateur peut répondre sans aller chercher [13].
4. Pas de questions au fil de l'eau : une fois les réponses reçues, une consolidation en un bloc, puis le brief [15]. Un second tour
   n'est permis que pour une réponse qui ouvre une inconnue bloquante.
5. **Si l'utilisateur a dit de ne pas être interrogé, ou n'est pas joignable** : prendre l'option la plus défendable, la nommer
   dans le brief (« Décision prise : … ») et dans le compte rendu final. Ne jamais attendre sans le dire.

**Décidé seule, jamais demandé :** modèle et effort, découpage, noms, ordre des filles, format du rapport, commande de test, zone par défaut.

## 2. Construire le brief

### 2.1 Ce qui pèse, dans l'ordre

1. **Critère de fin vérifiable, avec sa commande.** « Fini quand `<commande>` affiche `<attendu>` » ; ce qui ne compte pas
   (vérification de syntaxe seule, commande qui n'a pas démarré) ; que faire sinon (dire quelle vérification n'a pas pu tourner et pourquoi) [2, 3].
   Sans cela, un agent déclare la victoire trop tôt [9] et, à `low`, saute la vérification [2, 3].
2. **But et usage du résultat**, une phrase chacun. Donner la raison d'une consigne vaut mieux que l'ordre nu : le modèle généralise
   à partir d'elle [1]. « Lu à voix haute, donc pas de points de suspension » bat « jamais de points de suspension ».
3. **Frontières.** Fichiers permis, fichiers interdits, ce qui n'est pas demandé. Les modèles récents ajoutent des tests, de la doc,
   des abstractions que personne n'a demandés [1, 3, 4] ; une phrase de périmètre le coupe (§ 2.4).
4. **Contexte minimal suffisant** (§ 2.2).
5. **Format du rapport** (§ 2.5).
6. **Un exemple de sortie**, seulement si le format n'est pas évident (§ 2.3).

### 2.2 Donner le contexte sans tout recopier

Le contexte est un budget d'attention : chaque jeton superflu en retire à l'utile, et la précision baisse avec la longueur [5, 17].
Un seul document hors sujet dans le contexte suffit à faire perdre en exactitude [17].
- **Ce que la fille ne peut pas retrouver, on l'écrit** : décisions de l'utilisateur et leur raison, ce qui a été essayé et a échoué,
  contraintes non écrites. C'est la partie la plus chère à perdre [10, 20].
- **Ce qu'elle peut lire, on le pointe** : chemin exact et ce qu'on y cherche (« `docs/export/` : les pages qui citent l'option `--format` »).
  Pas de copie de fichier, pas de résumé de la conversation. Le chargement à la demande vaut mieux que le déversement [5].
- **Les décisions implicites qui engagent plusieurs filles s'écrivent une fois, dans un brief commun** : style, nommage, conventions,
  format des sorties. Deux filles qui écrivent sans les voir prennent des décisions contradictoires [19, 21].
- **Pas d'index de code à brancher pour une fille** (CodeGraph mesuré : +40 % de coût, mêmes réponses et mêmes tours, jusqu'à 738 fichiers, `CHANGELOG.md` 2.0.3). Si le dépôt en a déjà un, le brief nomme l'outil et colle son bloc d'instructions : le sous-agent n'hérite pas des instructions MCP.
- **Écriture : une seule fille par fichier.** La lecture parallèle se multiplie sans risque ; l'écriture parallèle non [20, 21].
- **Fork seulement si** la conversation est courte et tout y est utile ; sinon contexte neuf et brief écrit [10, 20].
- **Disposition.** But en tête ; si le brief dépasse une soixantaine de lignes, rappeler le critère de fin en dernier. Les sources se
  contredisent sur l'effet de la position [16 contre 17] : l'astuce coûte une ligne, la raccourcir vaut mieux que la déplacer.
- Une règle de l'utilisateur qui doit s'appliquer à la fille (ton, interdits, git) se **répète** dans le brief : le sous-agent n'hérite ni de la
  mémoire ni du style [10].

### 2.3 Dire le critère de fin, les exemples, les consignes

- **Ce qu'il faut faire, plutôt que ce qu'il ne faut pas.** Les modèles récents suivent la lettre : « sois conservateur » en revue fait rapporter
  moins [4] ; un préfixe « maximise » fait multiplier les appels d'outils sur de petites tâches [11]. Pas de majuscules d'alerte. Pour une revue :
  « rapporte tout », puis filtrer dans une seconde passe [4].
- **Relire le brief pour y chercher une contradiction** (« sois exhaustive » et « reste brève ») [11].
- **Exemples : zéro, un ou trois, jamais dix.** Trois à cinq exemples divers dans des balises `<example>` sont la méthode la plus fiable pour fixer
  une forme [1] ; mais des exemples tous pareils enferment dans un pli [18]. Un exemple montre la **sortie** attendue, pas le raisonnement.
- **Étapes numérotées** si l'ordre compte ; **balises** (`<contexte>`, `<critere_de_fin>`) si le brief mêle consignes, données et exemples [1].
- **Condition d'arrêt dite deux fois** : quand finir (critère) et quand s'arrêter pour demander (« seulement si tu ne peux pas continuer
  sans l'utilisateur, ou avant une action risquée ») [3]. Sans la seconde, Sonnet et Haiku à effort bas interrompent pour confirmer [2, 3].
- **Pas de « réfléchis moins » ni de « vérifie deux fois »** : le premier ne réduit pas la réflexion (c'est le rôle de l'effort) [2, 3],
  le second fait sur-vérifier Opus [4].
- **Nombre de filles** : un fait, une fille ; une comparaison, 2 à 4 ; une recherche large, plus de 10, jamais 50 pour une question simple [7].
  Le multi-agent coûte environ 15× les jetons d'un échange : la valeur du résultat doit le justifier [7, 21].

### 2.4 Ce qui varie selon le modèle

| | Haiku 5.5 | Sonnet 5.5 | Opus 5 / 5.5 |
|---|---|---|---|
| Brief | Court, étapes numérotées, critère **mécanique** (commande, compte) | Court à moyen, but + raison | Spécification **complète d'un coup**, puis laisser courir [4] |
| Défaut à corriger | Arrêt précoce en long prompt à `low` ; vérification sautée [2] | Demande avant d'avoir fini à `low`/`medium` ; ajouts non demandés [3] | Sur-vérification, élargissement du périmètre, sous-agents, documents trop longs [4] |
| À ajouter | Bloc « continue jusqu'à fini, ne demande que si bloqué » ; bloc de vérification réelle (code) ; format exact avec un exemple | Même bloc ; « livre ce qui est demandé, signale le reste en fin de rapport » | Une phrase de périmètre ; « ne délègue pas ce que tu finis seule en quelques appels, pas de sous-agent pour vérifier » |
| À retirer | Jugement fin, nuance : confier à Sonnet | « Réfléchis moins » (inefficace) ; pour une réponse JSON qui exige du calcul : « Think the problem through » [3] | « Vérifie / double-check », « sous-agent relecteur » [4] |
| Effort | `medium` au moins pour extraire ou agir ; `low` double l'arrêt précoce [2] | `medium` si bien spécifié, `high` sinon [3] | `low`/`medium` suffisent souvent ; `xhigh` pour le dur [4] |

Ces écarts sont **documentés sur ces modèles** ; les rechecker au banc avant d'en faire une règle pour une autre famille [1].

### 2.5 Le rapport demandé

- **Cinq champs fixes** : fait ; preuve (commande + dernière ligne de sa sortie, collée telle quelle, pas paraphrasée) ;
  non fait ou non vérifié (avec la raison) ; décisions prises ; ce qui attend l'humain. Ouvrir par le résultat [4].
- Demander **ce qui contredit le brief** : une fille doit signaler une lacune, pas la combler en silence, et remonter ses trouvailles [20].
- Au-delà de cinq lignes, la fille écrit un fichier et rend son chemin : le résumé qui revient pèse 1 000 à 2 000 jetons au plus [5].

### 2.6 Erreurs fréquentes

1. But sans critère de fin (« améliore », « range ») : la fille s'arrête quand elle veut.
2. Critère non exécutable (« ça marche bien », « propre ») ou qui se contente d'un test syntaxique.
3. Brief nu d'une ligne : travail dupliqué entre filles, périmètre deviné [7, 19].
4. Brief encyclopédique : historique recopié, fichiers collés ; la fille noie l'essentiel [5, 17].
5. Consignes contradictoires ou en majuscules d'alerte [4, 11].
6. Décision de conception laissée implicite entre deux filles qui écrivent [19].
7. Brief d'Opus donné à Haiku, ou brief de Haiku (étapes, exemple) donné à Opus qui le suit trop à la lettre [4].
8. Questions de l'orchestratrice en cascade (un tour par inconnue) au lieu d'un seul message [15].
9. Fille lancée sans zone d'écriture disjointe de ses sœurs [20, 21].
10. Rapport accepté tel quel, sans relancer la commande de preuve (§ 5 de `SKILL.md`) [9].

## 3. Liste de vérification avant chaque envoi (une minute)
- [ ] Compris en une phrase (but + critère), et soit confirmé, soit sans enjeu ? Questions : 3 au plus, un seul message ?
- [ ] Critère de fin = une commande ou un comptage, avec la valeur attendue, et ce qui ne compte pas ?
- [ ] La raison du travail et l'usage du résultat sont écrits ?
- [ ] Zone d'écriture disjointe, fichiers interdits nommés, périmètre borné ?
- [ ] Le contexte n'a que ce que la fille ne peut pas lire ; le reste est un chemin ?
- [ ] Aucune contradiction, aucune majuscule d'alerte, aucun « vérifie deux fois » pour Opus ?
- [ ] Bloc d'arrêt (« ne demande que si bloquée ») et, pour du code, bloc de vérification réelle, à Haiku et Sonnet ?
- [ ] Format du rapport : 5 champs, preuve collée, « non vérifié » obligatoire ?
- [ ] Règles de l'utilisateur utiles répétées ? Processus de fond à arrêter listés ? Modèle · effort annoncés (§ 3 de `SKILL.md`) ?

## 4. Exemple de bout en bout

**Demande floue de l'utilisateur :** « Fais le ménage dans la doc de l'outil d'export, elle est illisible, et assure-toi qu'elle colle au code. »

**Lecture préalable :** la doc vit dans `docs/export/` (14 pages) ; le code dans `src/export/` ; il existe un test `npm test`.
Inconnues : « ménage » (réécrire ou corriger ?), sort des pages périmées (suppression irréversible), lecteur visé. Le reste se décide seule.

**Questions posées (un message) :**
> Compris : mettre la doc de l'export d'accord avec le code, fini quand chaque option citée existe vraiment. Trois points :
> 1. « Ménage » : corriger les écarts et retirer le périmé, ou réécrire les pages ? *Par défaut : corriger, pas de réécriture.*
> 2. Pages périmées : les supprimer ou les marquer « périmé » ? *Par défaut : marquer.*
> 3. Qui lit cette doc : l'équipe ou des clients ? *(change le ton des corrections.)*

**Réponses :** corriger sans réécrire ; marquer ; l'équipe.

| Brief naïf | Brief construit (Haiku · medium, lecture et relevé) |
|---|---|
| `Fais le ménage dans la doc de l'export et vérifie qu'elle correspond au code.` | *But* : relever les écarts entre `docs/export/` et `src/export/`, sans rien modifier. Usage : l'équipe corrigera ensuite à partir de ton relevé. |
| | *Fini quand* : le relevé couvre les 14 pages (`ls docs/export | wc -l` = 14 lignes de couverture) ; chaque écart cite page, ligne et fichier du code. Une page non lue est dite « non lue », jamais omise. |
| | *Zone* : lecture seule. N'écris que `relevé-ecarts.md`. Ne touche ni `src/` ni `docs/`. |
| | *Décidé* : on ne réécrit pas ; une page périmée se marque « périmé », on ne supprime rien. Lecteurs : l'équipe, ton neutre. |
| | *Contexte* : les options vivent dans `src/export/options.js` (`OPTIONS`) ; la doc les nomme avec `--`. Ne recopie pas les fichiers. |
| | *S'arrêter* : seulement si une page est illisible ou si deux écarts se contredisent ; sinon continue jusqu'aux 14 pages. |
| | *Rapport (5 champs)* : fait ; preuve (commande + dernière ligne collée) ; non lu ou douteux ; décisions prises ; ce qui attend l'humain. |

**Lecture du côté à côté.** Le naïf laisse la fille choisir entre réécrire et corriger, supprimer ou garder, et conclure « c'est bon » sans
preuve. Le construit ramène une demande de jugement à un relevé que Haiku sait faire, borne l'écriture et exige une preuve collée ;
la correction, qui demande du jugement, part ensuite sur Sonnet · low avec le relevé pour seul contexte.

## 5. À mesurer — trois hypothèses pour un banc A/B

Banc : mêmes tâches, même modèle, même effort ; bras A = brief naïf (une ou deux phrases), bras B = brief construit selon cette méthode ;
au moins 20 essais par bras ; juge = script, pas modèle ; coût aux prix publics. **Aucune n'est encore mesurée.**

| # | Hypothèse | Tâche type | Critère objectif |
|---|---|---|---|
| H1 | Un critère de fin exécutable et une preuve collée **divisent par deux au moins** les « terminé » faux, sur Haiku medium et Sonnet low [2, 3, 9] | Dépôt de test avec 20 bogues localisés, un test cassé par bogue ; la fille corrige et annonce « fait » | Part des rapports « fait » dont la commande de test, relancée par le banc, échoue. Infirmée si l'écart est sous 10 points. |
| H2 | Une phrase de périmètre et une zone d'écriture explicite **réduisent d'au moins moitié** les fichiers modifiés hors liste sur Sonnet medium et Opus medium [3, 4] | 15 petites corrections demandées sur un dépôt de 30 fichiers, liste de fichiers permis connue du banc | Nombre moyen de fichiers hors liste (`git diff --name-only` contre la liste) ; qualité de la correction contrôlée par test (ne doit pas baisser de plus de 5 points). |
| H3 | Un tour de ≤ 3 questions avant le brief **améliore d'au moins 15 points** la conformité sur les demandes ambiguës, sans en poser sur les demandes claires [12, 14, 15] | 10 demandes à deux lectures plausibles + 10 demandes complètes ; réponses de l'utilisateur scriptées selon la lecture voulue | Part de livrables conformes à la lecture voulue (grille binaire fixée avant) ; taux de demandes claires où l'orchestratrice a posé une question (cible ≤ 10 %) ; coût total par livrable conforme (le bras B ne doit pas coûter plus du double). |

Après le banc : chiffres et source au `CHANGELOG.md` ; une hypothèse infirmée retire la règle correspondante de ce fichier.
