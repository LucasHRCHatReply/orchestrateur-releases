---
name: pause
description: Met le travail en pause proprement — tout de suite, ou à une heure dite (`/pause 18h30`) — et laisse de quoi reprendre en un mot avec `/reprise` (note de pause, prochain pas, commit, sessions et processus arrêtés).
argument-hint: "[HH:MM]"
version: 1
---
Argument reçu : `$ARGUMENTS`

- **Une heure** (`18h30`) → armer une minuterie (`Monitor` ou `ScheduleWakeup`) qui déclenche la pause à cette
  heure ; le dire en une ligne. Jamais de mémoire.
- **Vide** → faire la pause maintenant :

1. **Finir l'étape en cours ou l'arrêter net** à un endroit d'où l'on peut repartir (pas au milieu d'une écriture).
2. **Arrêter ce qui tourne** : bancs, serveurs, `caffeinate`, surveillances, minuteries ; pour une orchestration,
   prévenir chaque session fille (`SendMessage`) de s'arrêter à la fin de son étape et d'écrire son état.
3. **Écrire la note de pause** dans `.claude/pauses/AAAA-MM-JJ-HHMM.md` du projet (≤ 80 lignes) :
   but et critère de fin · où on en est (compteurs avec leur source) · **la commande unique de reprise** ·
   décisions prises et « ne pas refaire » · fichiers touchés · sessions filles (id, modèle, effort, état) ·
   processus arrêtés · ce qui attend l'humain · **le prochain pas**, en une ligne.
4. **Commiter** le dépôt s'il a des changements : `<projet> : pause, <le prochain pas>`.
5. Répondre en trois lignes : ce qui est fait, le prochain pas, « `/reprise` pour repartir ».
