# Questions visuelles : présenter l'attente d'une session fille

Quand une session fille attend l'utilisateur (une question, une autorisation d'outil), l'orchestratrice le voit,
le lui présente en une carte lisible, puis transmet sa réponse. Ce fichier dit quand, comment, et ce qui reste
interdit.

## Voir l'attente

- Hook `hooks/attente.mjs` (événements Notification et Stop) : écrit `~/.cache/orchestration/attentes/<session>.json`
  avec `{ session, app, projet, type, message, depuis }`, l'efface quand la session repart. `app` est l'id
  `local_…` de la session fille dans l'app : c'est l'adresse pour lui répondre. Le hook s'installe dans les
  réglages de l'utilisateur, jamais seul.
- Types : `autorisation` (permission_prompt), `question` (question posée par la session), `inactive`
  (idle_prompt, la session a fini et attend).
- Complément : `list_sessions` donne seulement `isRunning` (pas d'état « en attente ») ; `list_events` montre le
  dernier message de la session, par exemple `(called AskUserQuestion)`, sans le texte de la question. Le fichier
  d'attente est donc la source ; `list_events` sert à lire le contexte de la question.
- Relever les attentes à chaque tour de l'orchestratrice : `ls ~/.cache/orchestration/attentes/`.

## Carte ou texte

Carte quand : la question est technique (l'utilisateur ne connaît pas le terme), ou elle oppose 2 à 4 options aux
conséquences différentes, ou plusieurs filles attendent en même temps (une carte par fille).
Texte quand : réponse oui/non évidente, une seule ligne suffit, ou la fille demande une valeur libre (un nom,
un chemin). Une carte pour une question d'une ligne gaspille des jetons et du regard.

## Traduire en choix

1. La question en une phrase simple, avec un verbe : « Reprendre ou tout refaire ? ».
2. Le contexte en deux lignes : ce qui s'est passé, ce qui est déjà acquis. Chiffres avec leur source.
3. Les options (2 à 4) : un titre de deux ou trois mots, la conséquence en une ligne (durée, ce qui est réécrit,
   ce qui se perd). Une seule option « recommandé », celle de la fille ou de l'orchestratrice si elle diffère
   (le dire).
4. Le jargon se garde et s'explique une fois : « rebase (rejouer ses commits sur une base plus récente) ».
5. Aucune option cachée : si la fille en proposait cinq, garder les trois utiles et nommer « autre » en texte.

## Le schéma

Un seul, 3 à 5 éléments, qui montre l'état à trancher (une frise acquis / arrêt / reste ; trois boîtes
fille → commande → décision). Classes de couleur du widget (`c-teal`, `c-gray`, `c-amber`, `c-red`) : deux
familles au plus, la couleur porte un sens. Pas de légende longue, pas de flèches décoratives. Pas de schéma si
rien ne se montre : supprimer l'emplacement.

## Fabriquer la carte

Partir de `outils/question-carte.html` (squelette fixe : style, schéma, cartes, un seul script), remplacer les
`{{…}}`, ajouter des boutons au besoin (4 au plus), puis appeler `mcp__visualize__show_widget` (appeler
`read_me` avec le module « mockup » une fois par session). Chaque bouton porte dans `data-r` la phrase exacte
à transmettre à la fille, écrite à l'impératif et complète (elle ne verra pas la carte). Deux exemples remplis :
`outils/exemples-cartes/`.

## Transmettre la réponse

Quand l'utilisateur clique, `sendPrompt` renvoie la phrase à l'orchestratrice. Elle la transmet telle quelle, sans
reformuler : `SendMessage` avec `to` = l'id `local_…` de la fille. Pour une question (type `question` ou
`inactive`), cela suffit. Dire ensuite en une ligne : « Réponse envoyée à <nom> ».

## Autorisation d'outil : ce qui est possible et impossible

- Possible : montrer la commande demandée, expliquer ce qu'elle fait et ce qu'elle risque, proposer à
  l'utilisateur de l'accorder dans la session fille (lien `claude://…` de `list_sessions`), dire à la fille de
  procéder autrement (SendMessage), préparer une règle d'autorisation que l'utilisateur valide.
- Impossible : répondre à l'invite à sa place. Un SendMessage arrive comme un message, pas comme un clic sur
  « Autoriser » ; l'orchestratrice n'approuve jamais, ne contourne pas l'invite, ne change pas le mode de
  permission d'une fille pour la faire taire. Constat du 03/11 : des filles refusent même un accord relayé pour
  une écriture partagée, et ont raison : seul l'utilisateur, dans leur conversation, autorise.
- En amont, pour que les invites reviennent moins : liste d'autorisations du projet (skill
  `fewer-permission-prompts`, validée par l'utilisateur) ou mode de permission choisi par lui au lancement.
- Une autorisation ne se transforme pas en « oui à tout » : la carte propose « autoriser là-bas », « refuser » et
  « préparer une règle à valider », jamais « autoriser pour moi ».

## Budget de jetons

Mesure du 03/11 (caractères / 3,5), voir les exemples : une carte remplie sur le squelette pèse 553 à 639
jetons ; la même question écrite librement 707 (-22 % à -10 %). Le gain vient moins de la taille que de la
réflexion évitée : plus de choix de mise en page. Règles : une carte par attente (jamais de redite en texte
autour), texte de l'orchestratrice en une ligne avant ou après, pas de carte de suivi si la réponse est évidente.
Si plusieurs filles attendent, regrouper en une seule carte à sections plutôt que trois appels.
