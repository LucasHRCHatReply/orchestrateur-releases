---
name: point
description: Le point d'avancement condensé d'une tâche longue, lu dans le tableau du suivi sans modèle. `/point` donne un point tout de suite, une seule fois ; `/point 5` ouvre le bureau (l'écran qui tient le point en continu) et règle sa cadence ; `/point stop` arrête la récurrence d'une ancienne version.
argument-hint: "[minutes | stop]"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/outils/suivi.mjs:*), Bash(${CLAUDE_PLUGIN_ROOT}/skills/sessiondesk/lancer.sh:*), TaskStop
version: 4
version_du: 2026-11-16
declencheurs:
  - 'toutes? les \d+ ?min'
  - 'on en est o[uù]'
  - "t'?en es o[uù]"
  - 'tiens[- ]moi au courant'
---
Argument reçu : `$ARGUMENTS`

## Point calculé avant ce tour, sans modèle

!`node ${CLAUDE_PLUGIN_ROOT}/outils/suivi.mjs point 2>&1 | head -40`

## Ce qu'il faut faire selon l'argument

Le point n'est plus un tour de modèle armé par une minuterie : les hooks (`hooks/etat.mjs`) et le démon `outils/suivi.mjs`
l'écrivent en continu dans `tableau.json`, le bandeau et le bureau l'affichent. *(mesuré le 16/11/2026 : 13 points de minuterie
en 76 min, 8 sans rien à juger, chacun relisant 200 000 à 300 000 jetons.)*

- **Vide** → recopier le point ci-dessus tel quel, compléter seulement « En clair » si un fait de la conversation l'éclaire.
  Ne rien armer. Si la sortie dit « aucun tableau », démarrer le suivi une fois
  (`node ${CLAUDE_PLUGIN_ROOT}/outils/suivi.mjs demarrer`) puis relancer `node ${CLAUDE_PLUGIN_ROOT}/outils/suivi.mjs point`.
- **Un nombre N** (minutes) → **n'arme aucune minuterie de modèle.**
  1. Démarrer le suivi s'il ne tourne pas (`suivi.mjs demarrer`, avec `--intervalle` au plus 5 s), ouvrir le bureau
     (`${CLAUDE_PLUGIN_ROOT}/skills/sessiondesk/lancer.sh`) et donner son lien une fois.
  2. Recopier le point ci-dessus.
  3. Dire en une ligne : « Le point se tient sur le bureau, rafraîchi toutes les 2 s, et dans le bandeau ; le téléphone sonne
     sur une attente de plus de 10 min, un seuil ou la fin. `/point` pour un point ici. »
  4. Si l'orchestratrice doit agir sur les événements : `Monitor` sur `suivi.mjs guetter` (`timeout_ms: 1800000`), réarmé à
     l'expiration : c'est le seul réveil, et le filet à 30 min.
- **`stop`** → arrêter toute surveillance `/point` d'une version précédente (`TaskStop`), recopier le point, dire « Récurrence arrêtée. »

## Le format (validé le 05/10/2026, produit par `suivi.mjs point`)

```
⏱ HH:MM · point n° k — Étape n sur N

Fait / en cours
- <session> : <état> (<fait>/<total>) — prochain : <action>

Échecs
- <session> : <seuil franchi> (ou « aucun »)

Reste
- <temps restant lu dans les journaux de fond> (ou n/a)

En clair : <qui travaille, qui vous attend, et où se trouve la phrase à coller>
```

L'heure vient du tableau (horloge du démon), jamais de tête. Un temps restant absent s'écrit `n/a`.
Sous Codex (pas de hooks Claude) : le dire, et émettre le point à chaque étape franchie.

Source : règle « un point condensé toutes les cinq minutes » ; exécutant changé le 16/11/2026 : l'écran, pas le modèle.
