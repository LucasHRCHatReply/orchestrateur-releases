#!/bin/bash
# Calcule la sortie de /orch avant le tour du modèle (injection !`…` du skill).
D="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
if [ "$1" = ranger ]; then shift; node "$D/outils/ranger.mjs" "$@" --dossier "$PWD" 2>&1 | head -150; exit; fi
node "$D/outils/etat.mjs" "$@" --dossier "$PWD" 2>&1 | head -150
