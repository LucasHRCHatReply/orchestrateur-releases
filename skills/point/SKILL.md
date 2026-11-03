---
name: point
description: Le point d'avancement condensé d'une tâche longue. `/point` donne un point tout de suite, une seule fois ; `/point 5` en donne un puis un toutes les 5 minutes jusqu'à la fin ; `/point stop` arrête la récurrence.
argument-hint: "[minutes | stop]"
allowed-tools: Monitor, TaskStop
version: 3
version_du: 2026-10-30
declencheurs:
  - 'toutes? les \d+ ?min'
  - 'on en est o[uù]'
  - "t'?en es o[uù]"
  - 'tiens[- ]moi au courant'
---
Argument reçu : `$ARGUMENTS`

## Ce qu'il faut faire selon l'argument

- **Vide** → émettre UN point maintenant, au format ci-dessous, et rien d'autre. Ne rien armer.
  Si une récurrence tourne déjà, c'est un point hors cycle : la minuterie n'est pas touchée.
- **Un nombre N** (minutes, ex. `5`) →
  1. Si une récurrence `/point` tourne déjà, l'arrêter (`TaskStop`) avant d'en armer une autre.
  2. Si les étapes de la tâche n'ont pas encore été annoncées, les annoncer numérotées.
  3. Émettre tout de suite le point n° 1.
  4. Armer un `Monitor` (description : `point toutes les N min — <nom de la tâche>`,
     `timeout_ms: 1800000`) avec la commande, N remplacé par sa valeur :
     ```
     i=1; while true; do sleep $((N*60)); i=$((i+1)); echo "point $i — $(date +%H:%M)"; done   # l'heure affichée vient d'ici
     ```
  5. Dire en une ligne : « Point toutes les N min, prochain à HH:MM. `/point stop` pour arrêter. »
  6. À chaque événement de la surveillance : émettre le point correspondant, puis reprendre le
     travail. À chaque expiration (30 min) : ré-armer la même surveillance, en reprenant la
     numérotation, tant que la tâche dure. Quand la tâche est finie : `TaskStop`, dernier point.
- **`stop`** → `TaskStop` sur la surveillance `/point`, émettre un dernier point, dire
  « Récurrence arrêtée. »

Pourquoi un `Monitor` et pas un cron : un cron ne se déclenche que quand la session est
inactive, donc jamais pendant une tâche longue ; la surveillance, elle, parle pendant le travail.
Ne jamais compter sur sa vigilance pour penser au point : c'est la minuterie qui le déclenche.

## Le format (modèle validé le 05/10/2026)

```
⏱ HH:MM · point n° k — Étape n sur N : <nom de l'étape>

Fait / en cours
- <ce qui est fini, ce qui tourne, et ce qu'on en a appris> (3 ou 4 puces au plus)

Échecs
- <échec en mots simples> (×nombre) — cause : … — ce que je fais : …
  (ou « aucun »)

Reste (recalé sur le rythme observé)
- Étape n — <nom> : ≈ t min (<le calcul : 710 documents, environ 25 par minute>)
- Étape n+1 — <nom> : ≈ t min
- Total : ≈ T min, fin vers HH:MM

En clair : <une phrase humaine, non technique, comme un collègue qui raconte ; le bloquant
s'il y en a un, et s'il attend une action de l'utilisateur>
```

Règles de forme :
- L'heure de l'en-tête se lit à l'horloge (`date +%H:%M`, ou l'heure portée par l'événement de la minuterie), jamais de tête ; l'heure de fin estimée part de cette heure lue.
- Le temps restant n'est jamais absent : c'est le chiffre qui sert le plus.
- Un point sans nouveauté s'émet quand même, réduit à l'en-tête, une ligne « Reste » et
  « En clair » : il prouve que ça avance.
- Les chiffres de la tâche (taux, score, compteur x sur X) vont dans « Fait / en cours ».
- Pas de tableau ni de détail technique : ils attendent le compte rendu de fin.
- Sous Codex (pas de `Monitor`) : le dire, et émettre le point à chaque étape franchie.

Source : règle « un point condensé toutes les cinq minutes », mesurée sur de vrais chantiers.
