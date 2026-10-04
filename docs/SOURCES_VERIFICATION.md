# Sources de Magistra : vérification et affichage

Vérification du 4 octobre 2026. Base examinée : `2c7c9af89b57acd97b105549e5c14dc442b997fa`, branche commune du dépôt `juanrobin09-stack/Magistra-2`.

## Fonctionnement constaté

- `shared/research/providers.ts` interroge HAL, Crossref et OpenAlex. Les résumés disponibles sont récupérés ; une publication sans résumé est explicitement limitée à une notice bibliographique, jamais présentée au modèle comme un article lu.
- `shared/research/trusted.ts` reconnaît les domaines institutionnels et scientifiques, notamment Éduscol, les ministères, l’UNESCO et le CNRS. Il distingue les institutions, les plateformes scientifiques et les plateformes ouvertes. Cette classification porte sur l’hôte, pas sur la validation scientifique individuelle de chaque document.
- `shared/research/index.ts` recherche les pages institutionnelles par un moteur SearXNG configuré, ou par les références externes d’articles Wikipédia. Dans ce dernier cas, c’est la page institutionnelle elle-même qui doit être récupérée pour devenir une source institutionnelle.
- Le mode « Sources académiques » recherche les publications et les pages institutionnelles pour tous les niveaux ; il n’utilise pas le texte des articles Wikipédia. Le correctif de couverture étend les publications aux modes Internet pour tous les niveaux, si la recherche académique est activée. Wikipédia peut rester un complément identifié.
- Le mode « Mes documents uniquement » ne déclenche aucune recherche externe. Les réglages désactivés sont respectés.
- `shared/pipeline.ts` transmet les extraits retenus au modèle avec leurs références. Les consignes donnent priorité aux documents de l’enseignant, puis aux sources officielles et aux publications, devant Wikipédia. La quantité transmise reste bornée par le contexte disponible.
- Les avertissements existants signalent une absence de source ou une indisponibilité. La recherche, les citations et les protections des requêtes ne sont pas remplacées par ce correctif d’affichage.

## Vérifications effectuées

| Vérification | Résultat | Portée |
| --- | --- | --- |
| HAL, recherche réelle « photosynthèse » | 3 résultats | Réponse réelle du service au moment du test |
| Crossref, même recherche | 3 résultats | Notices ; aucun résumé dans cet échantillon |
| OpenAlex, même recherche | 3 résultats | Accès anonyme fonctionnel lors de ce test |
| Références externes de Wikipédia | 2 pages trouvées ; 3 liens du catalogue sur la première | Découverte réelle de liens NIH et CNRS |
| Récupération directe des pages institutionnelles | Non validée en réseau réel dans cet environnement | Résolution DNS directe du CNRS en erreur `EAI_AGAIN` ; aucun extrait institutionnel prétendu récupéré |
| Recherche institutionnelle, redirections et restrictions | Tests automatisés réussis | Réponses réseau simulées, filtrage des domaines et erreurs |
| Transmission au modèle | Test de pipeline réussi | Présence du résumé HAL et de l’extrait UNESCO dans les messages effectivement transmis au fournisseur simulé |
| Site, métadonnées, sources, pipeline et affichage | 713 tests réussis | 21 fichiers de tests ciblés, comprenant les vérifications du HTML |
| Navigation du site | 28 tests Chromium réussis | Mobile, sans JavaScript, hydratation sous la CSP de production, FAQ, liens et métadonnées |
| Compilation | Site, interface de l’application et Electron réussis | Aucun nouvel installateur Windows publié |

Le test du pipeline vérifie ce qui est transmis au modèle ; il ne démontre pas qu’un modèle local suivra parfaitement toutes les consignes. L’enseignant doit relire les contenus. Les résultats des services varient selon le sujet, le réseau, les quotas et leur disponibilité.

## Textes modifiés

- Accueil partagé site/application : « Sources officielles et académiques », avec fonctionnement conditionné à la recherche activée, au mode et aux résultats disponibles.
- Sélecteur de l’application : sources institutionnelles mises en avant et « Recherche prévue » avant exécution, pour ne pas annoncer à tort une consultation déjà effectuée.
- FAQ du site : exemples du catalogue, distinction extrait/notice, et place complémentaire de Wikipédia. Le nom Wikipédia reste visible lorsqu’il explique une source réellement utilisée.

## Disponibilité des services

L’accès anonyme OpenAlex a répondu pendant la vérification. Sa documentation distingue l’usage anonyme limité de l’accès avec clé, et le paramètre historique `mailto` n’y procure plus d’accès prioritaire. Le commentaire du code a été corrigé ; aucune clé n’a été ajoutée ou publiée. HAL et Crossref restent également soumis à leurs politiques d’accès.

- HAL : https://api.archives-ouvertes.fr/docs/search/
- Crossref : https://www.crossref.org/documentation/retrieve-metadata/rest-api/
- OpenAlex : https://help.openalex.org/api/authentication/
- Dépréciations OpenAlex : https://help.openalex.org/api/deprecations/

## Publication de l’application

L’accès au dépôt a été rétabli. Les améliorations d’affichage déjà reprises sur la branche commune sont conservées ; le correctif de couverture est décrit dans `SOURCES_COVERAGE_PATCH.md`. La publication d’un nouvel installateur Windows reste nécessaire pour transmettre les changements de recherche aux applications installées.
