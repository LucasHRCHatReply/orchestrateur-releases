#!/bin/bash
# Calcule le bureau de l'orchestration avant le tour du modèle (injection !`…` du skill), lance le serveur local et ouvre la page.
D="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
node "$D/outils/bureau.mjs" ouvrir "$@" --dossier "$PWD" 2>&1 | head -40
