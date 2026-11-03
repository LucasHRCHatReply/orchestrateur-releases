---
name: reprise
description: Reprend le projet courant là où la dernière pause l'a laissé — relit la note de pause, remet debout ce qui doit tourner, vérifie que rien n'a bougé, dit le prochain pas en une ligne.
version: 1
---
Dernière note de pause de ce projet :

!`ls -t .claude/pauses/*.md 2>/dev/null | head -1 | xargs cat 2>/dev/null || echo "Aucune note de pause dans .claude/pauses/ : reprendre depuis git log et le plan du projet."`

1. **Vérifier que rien n'a bougé** depuis la note : `git status`, `git log -3`, compteurs de la note relancés
   (même commande, même source). Un écart se dit en une ligne avant toute chose.
2. **Remettre debout** ce que la note liste (serveur, surveillance, `caffeinate`, sessions filles à relancer avec
   leur modèle et leur effort, annoncés en tableau comme le veut le skill orchestrateur).
3. **Dire le prochain pas** en une ligne, puis le faire — sauf s'il attend l'humain : alors le dire et s'arrêter.
