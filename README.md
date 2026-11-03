# orchestrateur — plugin Claude Code

Un skill qui orchestre un chantier dans Claude Code : il découpe le travail en étapes, lance de vraies sessions avec
le modèle et l'effort les plus bas qui suffisent, suit leur poids, les relance quand elles deviennent trop lourdes
et rend un résultat qu'on peut ouvrir. Version 2.0.0.

## Installer

Dans Claude Code :

```
/plugin marketplace add LucasHRCHatReply/orchestrateur-releases
/plugin install orchestrateur@orchestration
```

Puis `/reload-plugins` (ou une nouvelle session). Le skill se déclenche seul dès qu'on demande de lancer ou de
déléguer du travail ; `/orchestrateur:orch` donne le tableau de bord, `/orchestrateur:sessiondesk` le bureau des sessions.

## Ce que le plugin pose

- 6 skills : `orchestrateur`, `orch`, `sessiondesk`, `pause`, `reprise`, `point`.
- 4 hooks : rappel de relance quand le contexte d'une session devient lourd, annonce « modèle · effort » à chaque
  lancement, verdict de fin de tour, fichier d'attente quand une session attend une réponse.
- Des fichiers de travail dans `~/.cache/orchestration/` (verdicts, attentes, pages locales). Rien n'est écrit dans
  vos réglages Claude Code.

## Ce qu'il ne fait pas

- Aucun envoi réseau, aucune télémétrie, aucun partage de statistiques : tout se calcule sur ce Mac, à partir des
  transcriptions de vos sessions. Le bureau (`/orchestrateur:sessiondesk`) ouvre une page sur `127.0.0.1` seulement.
- Aucune tâche planifiée, aucun script qui modifie vos réglages.

## Retirer

```
/plugin uninstall orchestrateur@orchestration
```

Les fichiers de `~/.cache/orchestration/` restent ; supprimez le dossier si vous n'en voulez plus.

Si vous aviez installé l'ancien zip, lancez d'abord `~/orchestration-claude/desinstaller.sh` : il retire ses hooks et ses
liens de skills, qui feraient doublon avec le plugin.
