# Déléguer hors Claude : `outils/deleguer.mjs`

Un seul outil confie une tâche à GPT (`codex exec`), à Gemini (`agy`) ou à une fille Claude (`claude -p`), sur les abonnements,
et la journalise. Pour choisir le modèle : voir « manuel des modèles (SKILL.md § 3) ».

## Quand déléguer

- La tâche est autonome, bornée, avec un critère de fin vérifiable (un fichier, une réponse courte, une image).
- Un autre fournisseur est meilleur ou moins cher pour ce type de tâche d'après le banc intermodèle
  (`node outils/intermodele.mjs comparer`), ou le quota Claude est tendu.
- Ne pas déléguer : décider, orchestrer, juger. La qualité du rendu reste à juger par l'orchestratrice.

## Commande type

```
node outils/deleguer.mjs --a gpt|gemini|claude --modele <id> --effort low|medium|high|xhigh \
  --mode texte|lecture|fichiers|web|image --dossier <chemin> (--brief f.md | --prompt "…") \
  [--reference image.png] [--delai 600] [--tache <id>] [--type code|veille|image|donnees|relecture|redaction] [--a-sec]
```

| Fournisseur | Exemple | Particularités |
|---|---|---|
| GPT | `--a gpt --modele gpt-6.1-terra --effort low` | `codex exec` ; `--reference` passe par `--image` ; `web` ajoute `--search` |
| Gemini | `--a gemini --modele gemini-4-hydrogen --effort low` | `agy -p`, stdin fermé ; modèle et effort collés (`…-low`) ; `web` : recherche Google intégrée, sans `--mode` ; `--reference` copiée dans le dossier |
| Claude | `--a claude --modele claude-haiku-5-5 --effort low` | id complet obligatoire (jamais l'alias) ; outils réduits au mode ; pas d'image |

Toujours commencer par `--a-sec` : commande exacte (prompt réduit à sa longueur) et estimation, sans aucun appel.

Sortie : un JSON `{ok, texte, fichiers, jetons, duree_s, quota_avant, quota_apres, erreur}`.
Code de sortie : 0 réussi · 1 échec de la tâche · 2 mauvais arguments · 3 refus ou limite de quota.

## Refus

- **Quota**, lu avant l'appel : Codex semaine > 70 % consommée ou 5 h > 85 % ; Gemini 5 h < 25 % restant
  (ou semaine < 30 % si la jauge la donne). Code 3, `refus: true`, aucun appel. Jauge illisible : l'appel passe, `quota_avant: null`.
- **Limite chez le fournisseur** en cours d'appel : `erreur: "quota"`, code 3, rien au journal. Jamais un échec de la tâche :
  changer de fournisseur ou attendre la remise à zéro.
- **Astra** (tout id contenant « astra »), **effort `max`**, alias Claude, image par Claude : code 2.
- Les clés d'API de l'environnement sont retirées de l'appel : toujours l'abonnement, jamais la facturation à l'usage.

## Journal

Une ligne par appel abouti dans `~/.cache/orchestration/intermodele/<fournisseur>.jsonl` (`ORCH_INTERMODELE` pour déplacer),
au format de `outils/bancs/intermodele/README.md` : `voie: abonnement`, `cout_eur: 0`, jetons dans `quota_consomme`,
`conformite` (fichiers attendus livrés ou réponse non vide), `qualite.note: null` (à juger par l'orchestratrice).
Rien de privé : pas de chemin, pas de clé. Lecture : `node outils/intermodele.mjs lire|comparer`, et le bureau.

## Après l'appel

Vérifier le rendu contre le critère de fin avant de l'annoncer comme fait ; ouvrir les fichiers livrés.
Tests : `node outils/tests/deleguer.test.mjs` (faux binaires, sans réseau).
