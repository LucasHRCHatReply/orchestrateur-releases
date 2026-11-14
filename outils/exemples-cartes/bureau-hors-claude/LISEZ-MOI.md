# Captures du bureau avec des essais hors Claude (12/11/2026)

**Données d'exemple, fictives** : produites par `outils/tests/mac-exemple.mjs` (source « exemple-fictif »), jamais une mesure. Le bureau les marque « exemple ».
Refaire : `node outils/tests/mac-exemple.mjs <dossier>` puis `HOME=<dossier> ORCH_BUREAU_PORT=45931 node outils/bureau.mjs serveur`, puis `node outils/tests/capturer.mjs "http://127.0.0.1:45931/?s=local_chef&moi=local_chef&mode=bureau" bureau.png 1440 900 --pleine-page`.

- `bureau-*.png` : le pôle « Hors Claude » à côté des sessions Claude, fournisseur en pastille.
- `temps-*.png` : une rangée par fournisseur dans la frise.
- `liste-*.png` : le tableau des essais.
- `comparer-*.png` : la comparaison par type de tâche, les deux comptes côte à côte.
Largeurs : 1440 px et 390 px.
