# Recherche documentaire : couverture et cohérence

Correctif du 4 octobre 2026, préparé après les améliorations de référencement et d’affichage des sources déjà reprises sur la branche commune.

## Comportement

- Les modes Internet et Documents + Internet interrogent HAL, Crossref et OpenAlex à tous les niveaux, si les recherches académiques sont activées. Le mode Documents uniquement reste sans recherche externe.
- Sans SearXNG, la découverte examine jusqu’à quatre pages Wikipédia et suit jusqu’à six liens institutionnels/scientifiques du catalogue, sur des hôtes distincts. Les articles Wikipédia utilisés comme complément restent limités à deux. Aucune nouvelle installation, clé ou instance publique ajoutée.
- Les textes institutionnels et scientifiques du catalogue passent avant les publications, puis les sources web éventuellement autorisées côté serveur, Wikipédia et les notices sans résumé. Les réglages et le filtre de domaines existants sont conservés.
- À DOI identique, un texte disponible passe avant une notice sans résumé, quel que soit le connecteur. Un DOI ne certifie pas la validité d’une étude.
- Les consignes demandent de vérifier le sujet, la période et le pays, de signaler les désaccords non résolus et les points non vérifiés par les extraits fournis. Elles restent courtes pour conserver la place des documents sur les petits modèles.
- La capacité optionnelle academicAllLevels permet à l’interface d’annoncer la couverture réelle sans attribuer ce comportement aux applications plus anciennes.

## Validation

377 tests ciblés passent dans 12 fichiers : recherche, erreurs réseau, redirections et filtrage avec le récupérateur réel sous transport simulé, interface des modes, compatibilité des capacités, pipeline et petits contextes. Les tests de couverture vérifient l’envoi de sujets de différentes disciplines aux connecteurs ; ils ne mesurent pas l’exactitude de réponses produites par un modèle réel.

Compilation TypeScript et interface (npm run build), compilation Electron (npm run electron:build), ESLint ciblé et git diff --check : réussis. Aucun installateur Windows publié.

La couverture reste tributaire des résultats des services, des quotas, du réseau et du contexte disponible. Le catalogue n’est pas une validation de chaque affirmation. L’élargissement n’assure ni une source pour chaque sujet ni l’absence d’erreur du modèle.

## Intégration et publication

Ce patch est incrémental : il ne remplace pas les corrections de référencement déjà reprises dans la branche commune. L’appliquer sur une copie à jour de la branche commune du dépôt Magistra-2, en conservant les changements plus récents.

L’accès au dépôt privé a été rétabli et ce correctif est intégré à la suite du commit commun afe862fd, en conservant les ajustements déjà intégrés. La vérification d’intégration a réussi : 273 tests supplémentaires exécutés dans neuf fichiers, incluant la recherche, les consignes, le pipeline, l’accueil et les règles du dépôt. Les métadonnées de la version restent à 2.0.5 tant que la publication n’est pas préparée sur la branche actualisée. Pour livrer ce changement aux utilisateurs, attribuer le prochain numéro de correctif disponible et publier un nouvel installateur Windows par le circuit habituel. La mise à jour du site seule ne modifie pas l’application installée.
