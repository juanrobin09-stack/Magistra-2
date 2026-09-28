// Exemples de démonstration pré-rédigés pour les 11 outils (contenu réel et cohérent, pas de « lorem ipsum »).
// Chaque outil dispose d'un exemple scolaire et d'une variante pour l'enseignement supérieur.
// Règles de rédaction : contenu exact et vérifiable, aucune référence bibliographique inventée,
// Markdown riche (titres, listes, tableaux, citations) pour montrer le rendu, 250 à 700 mots par exemple.

import type { TypeContenu } from '../catalog.js';

export interface DemoExample {
  subject: string;
  level: string;
  markdown: string;
}

// ─── Cours ───────────────────────────────────────────────────────────────────

const COURS_SCOLAIRE: DemoExample = {
  subject: 'La respiration : des échanges gazeux avec le milieu',
  level: '5e — SVT',
  markdown: `
# La respiration : des échanges gazeux avec le milieu

> Question de départ : pourquoi respirons-nous plus vite lorsque nous courons ?

## Objectifs de la leçon

- Comparer la composition de l'air inspiré et celle de l'air expiré.
- Décrire le trajet de l'air et le lieu des échanges gazeux chez l'être humain.
- Relier la respiration aux besoins des organes en dioxygène.
- Identifier les organes respiratoires de quelques animaux.

## 1. L'air expiré n'a pas la même composition que l'air inspiré

À chaque inspiration, l'air entre dans les poumons ; à chaque expiration, il en ressort. Des mesures montrent que sa composition a changé :

| Gaz | Air inspiré | Air expiré |
|---|---|---|
| Diazote (N₂) | environ 78 % | environ 78 % |
| Dioxygène (O₂) | environ 21 % | environ 16 % |
| Dioxyde de carbone (CO₂) | environ 0,04 % | environ 4 % |
| Vapeur d'eau (H₂O) | variable | plus abondante |

L'organisme **prélève du dioxygène** et **rejette du dioxyde de carbone** ainsi que de la vapeur d'eau : ce sont les échanges gazeux respiratoires.

> Expérience : l'eau de chaux se trouble en présence de dioxyde de carbone. Si l'on souffle doucement avec une paille dans de l'eau de chaux, elle se trouble rapidement : l'air expiré est riche en CO₂.

## 2. Le trajet de l'air dans l'organisme

L'air entre par le nez ou la bouche, descend dans la trachée, puis dans les bronches et les bronchioles, jusqu'aux **alvéoles pulmonaires**.

- Les deux poumons contiennent plusieurs centaines de millions d'alvéoles.
- Mise à plat, leur surface totale atteindrait environ 70 à 100 m².
- La paroi d'une alvéole est extrêmement fine : moins d'un millième de millimètre.
- Chaque alvéole est entourée d'un réseau de capillaires sanguins.

## 3. Les échanges gazeux au niveau des alvéoles

Le dioxygène passe de l'air des alvéoles vers le sang ; le dioxyde de carbone passe du sang vers l'air des alvéoles, puis il est rejeté lors de l'expiration. Ces échanges sont efficaces grâce à trois caractéristiques :

1. une très grande surface d'échange ;
2. une paroi très fine entre l'air et le sang ;
3. un apport de sang important et permanent.

Le sang transporte ensuite le dioxygène jusqu'à tous les organes.

## 4. Pourquoi les organes ont-ils besoin de dioxygène ?

Les muscles, comme tous les organes, utilisent du dioxygène et des nutriments (par exemple le glucose) pour produire l'énergie nécessaire à leur fonctionnement. Cette activité rejette du dioxyde de carbone, que le sang ramène vers les poumons.

Pendant un effort, les muscles consomment beaucoup plus de dioxygène : la fréquence respiratoire et la fréquence cardiaque augmentent pour les approvisionner plus rapidement. C'est la réponse à la question de départ.

## 5. D'autres animaux, d'autres organes respiratoires

| Animal | Milieu de vie | Organe respiratoire |
|---|---|---|
| Être humain, chien | aérien | poumons |
| Truite | aquatique | branchies |
| Criquet | aérien | trachées |
| Ver de terre | sol humide | peau |
| Grenouille adulte | aérien et aquatique | poumons et peau |

Malgré leur diversité, tous ces organes présentent une surface d'échange fine, étendue et en contact avec le milieu de vie.

## Je retiens

> Les animaux prélèvent du dioxygène dans leur milieu de vie et y rejettent du dioxyde de carbone. Ces échanges gazeux se font à travers des surfaces fines et étendues : alvéoles pulmonaires, branchies, trachées ou peau. Le dioxygène est utilisé par les organes, avec les nutriments, pour produire de l'énergie.

## Vocabulaire

- **Alvéole pulmonaire** : petit sac situé au bout des bronchioles, où ont lieu les échanges gazeux.
- **Capillaire** : vaisseau sanguin très fin.
- **Fréquence respiratoire** : nombre de mouvements respiratoires par minute.

## Pour vérifier

1. Pourquoi l'eau de chaux se trouble-t-elle quand on y souffle ?
2. Citez deux caractéristiques des alvéoles qui facilitent les échanges gazeux.
3. Expliquez pourquoi la fréquence respiratoire augmente pendant un effort.
`,
};

const COURS_SUPERIEUR: DemoExample = {
  subject: "La gouvernance des systèmes d'information",
  level: "Master 1 — Systèmes d'information",
  markdown: `
# La gouvernance des systèmes d'information

> Problématique : comment une organisation s'assure-t-elle que ses investissements numériques servent sa stratégie, maîtrisent les risques et créent une valeur mesurable ?

**Format :** cours magistral de 3 heures. **Prérequis :** notions de stratégie d'entreprise et de gestion de projet.

## 1. Définir la gouvernance des SI

La gouvernance des SI désigne l'ensemble des structures, des processus et des mécanismes de décision par lesquels les dirigeants d'une organisation orientent, contrôlent et évaluent l'usage du numérique. Elle relève de la direction générale et des instances dirigeantes, et non du seul directeur des systèmes d'information (DSI).

| Critère | Gouvernance | Management |
|---|---|---|
| Question centrale | Faisons-nous les bonnes choses ? | Faisons-nous bien les choses ? |
| Horizon | stratégique, pluriannuel | opérationnel, annuel ou infra-annuel |
| Acteurs | conseil d'administration, comité de direction | DSI, chefs de projet, responsables de service |
| Productions | orientations, arbitrages, niveau de risque accepté | plans, projets, services, indicateurs de production |

## 2. Les cinq domaines de la gouvernance

1. **Alignement stratégique** : relier chaque projet numérique à un objectif de l'organisation.
2. **Création de valeur** : vérifier que les bénéfices attendus sont obtenus, y compris après la mise en service.
3. **Gestion des risques** : cybersécurité, continuité d'activité, dépendance aux fournisseurs, conformité (par exemple au RGPD pour les données personnelles).
4. **Gestion des ressources** : arbitrer les budgets, les compétences et l'infrastructure.
5. **Mesure de la performance** : suivre des indicateurs partagés entre métiers et DSI.

## 3. Les référentiels de bonnes pratiques

- **ISO/IEC 38500** : norme consacrée à la gouvernance du numérique par les dirigeants. Elle repose sur le cycle *Évaluer, Diriger, Surveiller* et sur six principes : responsabilité, stratégie, acquisition, performance, conformité et comportement humain.
- **COBIT**, référentiel publié par l'ISACA : il sépare un domaine de gouvernance (EDM : évaluer, diriger, surveiller) de quatre domaines de management (APO, BAI, DSS, MEA).
- **ITIL** : bonnes pratiques de gestion des services informatiques (incidents, changements, niveaux de service).
- **ISO/IEC 27001** : exigences d'un système de management de la sécurité de l'information.

> Aucun référentiel ne s'applique « clés en main » : il se choisit et s'adapte à la taille, au secteur et à la maturité de l'organisation.

## 4. Instances et outils de pilotage

- **Comité stratégique du numérique** (direction générale, directions métiers, DSI) : il arbitre le portefeuille de projets.
- **Comité d'architecture** : il veille à la cohérence technique et limite la dette technique.
- **RSSI** (responsable de la sécurité des SI) et **DPO** (délégué à la protection des données) : ils portent le risque cyber et la conformité.
- **Outils** : schéma directeur, gestion de portefeuille de projets, tableau de bord prospectif appliqué aux SI.

| Domaine | Indicateur | Cible indicative |
|---|---|---|
| Performance | disponibilité des applications critiques | ≥ 99,5 % |
| Risques | délai de correction des vulnérabilités critiques | ≤ 15 jours |
| Valeur | projets dont les bénéfices sont mesurés un an après | ≥ 80 % |
| Alignement | projets rattachés à un objectif stratégique | 100 % |

Une disponibilité de 99,5 % tolère encore environ 44 heures d'interruption par an (0,005 × 8 760 h = 43,8 h) : la cible se discute avec les métiers.

## 5. Limites et débats actuels

- **Bureaucratisation** : trop de comités ralentit les décisions ; la gouvernance doit rester proportionnée.
- **Agilité** : les méthodes agiles déplacent une partie des arbitrages vers les équipes produit.
- **Informatique fantôme** (*shadow IT*) : les outils adoptés hors du contrôle de la DSI révèlent souvent des besoins non couverts.
- **Données et intelligence artificielle** : la gouvernance s'étend à la qualité des données et à l'usage responsable des algorithmes.

## À retenir

> La gouvernance des SI n'est pas une affaire technique : c'est un dispositif de décision qui relie le numérique à la stratégie, à la valeur et au risque, sous la responsabilité des dirigeants.

## Pistes de lecture à constituer

- Textes normatifs : norme ISO/IEC 38500 et documentation de COBIT, consultables via la bibliothèque universitaire.
- Mots-clés : « IT governance », « alignement stratégique des SI », « gestion de portefeuille de projets ».
- Types de sources : revues académiques en management des SI, études de cas d'organisations publiques et privées.
`,
};

// ─── Exercices / TD ──────────────────────────────────────────────────────────

const EXERCICES_SCOLAIRE: DemoExample = {
  subject: 'Le théorème de Pythagore',
  level: '4e — Mathématiques',
  markdown: `
# Exercices — Le théorème de Pythagore

> Rappel : si un triangle ABC est rectangle en A, alors son hypoténuse est [BC] et BC² = AB² + AC².

**Durée conseillée :** 50 minutes. **Matériel :** calculatrice avec la touche √.

## Niveau 1 — Appliquer le théorème

**Exercice 1.** Le triangle DEF est rectangle en D, avec DE = 6 cm et DF = 8 cm. Calculer la longueur EF.

**Exercice 2.** Le triangle RST est rectangle en S, avec RT = 13 cm et RS = 5 cm. Calculer la longueur ST.

## Niveau 2 — Démontrer qu'un triangle est rectangle ou non

**Exercice 3.** Le triangle KLM a pour côtés KL = 9 cm, LM = 15 cm et KM = 12 cm. Ce triangle est-il rectangle ? Justifier.

**Exercice 4.** Le triangle UVW a pour côtés UV = 5 cm, VW = 9 cm et UW = 7 cm. Ce triangle est-il rectangle ? Justifier.

## Niveau 3 — Résoudre un problème

**Exercice 5.** Une échelle de 5 m est appuyée contre un mur vertical. Son pied est posé sur le sol horizontal, à 1,4 m du mur. À quelle hauteur le haut de l'échelle touche-t-il le mur ?

**Exercice 6.** Un écran rectangulaire mesure 80 cm de large et 45 cm de haut. Sa diagonale dépasse-t-elle 90 cm ? Sachant qu'un pouce mesure 2,54 cm, donner la diagonale en pouces, arrondie à l'unité.

## Corrigé

| Exercice | Calcul | Conclusion |
|---|---|---|
| 1 | EF² = DE² + DF² = 6² + 8² = 36 + 64 = 100 | EF = √100 = 10 cm |
| 2 | ST² = RT² − RS² = 13² − 5² = 169 − 25 = 144 | ST = √144 = 12 cm |
| 3 | LM² = 15² = 225 et KL² + KM² = 81 + 144 = 225 | égalité vérifiée : KLM est rectangle en K |
| 4 | VW² = 9² = 81 et UV² + UW² = 25 + 49 = 74 | 81 ≠ 74 : UVW n'est pas rectangle |
| 5 | h² = 5² − 1,4² = 25 − 1,96 = 23,04 | h = √23,04 = 4,8 m |
| 6 | d² = 80² + 45² = 6 400 + 2 025 = 8 425 | d = √8 425 ≈ 91,8 cm > 90 cm, soit environ 36 pouces |

## Rédaction attendue pour l'exercice 3

> Dans le triangle KLM, le plus grand côté est [LM].
>
> D'une part, LM² = 15² = 225. D'autre part, KL² + KM² = 9² + 12² = 81 + 144 = 225.
>
> Comme LM² = KL² + KM², d'après la réciproque du théorème de Pythagore, le triangle KLM est rectangle en K.

## Points de vigilance

- Repérer l'hypoténuse avant tout calcul : c'est le plus long côté, opposé à l'angle droit.
- Distinguer le théorème (calculer une longueur) de sa réciproque (prouver qu'un triangle est rectangle).
- Pour l'exercice 4, conclure avec la contraposée : si le triangle était rectangle, l'égalité serait vérifiée ; or elle ne l'est pas.
- Donner la valeur exacte (√8 425) avant la valeur approchée, en précisant l'arrondi choisi.
- Vérifier la vraisemblance du résultat : l'hypoténuse est toujours plus longue que chacun des deux autres côtés.
`,
};

const EXERCICES_SUPERIEUR: DemoExample = {
  subject: 'Statistique descriptive univariée',
  level: 'Licence 1 — Statistiques (TD)',
  markdown: `
# TD 2 — Statistique descriptive univariée

> Objectifs : calculer et interpréter les indicateurs de position et de dispersion, traiter des données regroupées en classes et mesurer l'effet d'une transformation affine.

**Durée :** 1 h 30. **Calculatrice autorisée.**

## Exercice 1 — Série brute

Notes sur 20 obtenues par dix étudiants à un contrôle :

| Étudiant | A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|---|
| Note | 8 | 10 | 12 | 12 | 13 | 14 | 9 | 15 | 11 | 16 |

1. Calculer la moyenne m, la médiane et l'étendue.
2. Calculer la variance et l'écart-type (division par n).
3. Déterminer le premier et le troisième quartile, puis l'écart interquartile.

## Exercice 2 — Données regroupées en classes

Durée du trajet domicile-université de 50 étudiants :

| Durée (min) | [0 ; 10[ | [10 ; 20[ | [20 ; 30[ | [30 ; 50[ |
|---|---|---|---|---|
| Effectif | 12 | 18 | 14 | 6 |

1. Déterminer la classe modale.
2. Calculer une valeur approchée de la moyenne à l'aide des centres de classes.
3. Déterminer la classe médiane, puis estimer la médiane par interpolation linéaire.
4. Pourquoi ne peut-on pas utiliser directement les effectifs comme hauteurs de l'histogramme ?

## Exercice 3 — Transformation affine

L'enseignant harmonise les notes de l'exercice 1 avec la formule y = 0,9x + 2.

1. Sans recalculer toutes les notes, donner la moyenne et l'écart-type de la nouvelle série.
2. Calculer les notes transformées des étudiants A et J, puis commenter l'effet de la transformation.

## Éléments de correction

**Exercice 1.**

- Somme des notes : 120, donc m = 120 / 10 = 12.
- Série ordonnée : 8, 9, 10, 11, 12, 12, 13, 14, 15, 16. Médiane = (12 + 12) / 2 = 12 ; étendue = 16 − 8 = 8.
- Carrés des écarts à la moyenne : 16, 4, 0, 0, 1, 4, 9, 9, 1, 16, de somme 60. Variance V = 60 / 10 = 6 ; écart-type σ = √6 ≈ 2,45.
- Q1 = 10 (3e valeur) et Q3 = 14 (8e valeur) ; écart interquartile = 4.

> Avec la division par n − 1 (estimation à partir d'un échantillon), on obtient s² = 60 / 9 ≈ 6,67 et s ≈ 2,58. Les logiciels utilisent aussi d'autres conventions pour les quartiles : toujours préciser la méthode retenue.

**Exercice 2.**

| Classe | Centre | Effectif | Effectifs cumulés | Densité (effectif / amplitude) |
|---|---|---|---|---|
| [0 ; 10[ | 5 | 12 | 12 | 1,2 |
| [10 ; 20[ | 15 | 18 | 30 | 1,8 |
| [20 ; 30[ | 25 | 14 | 44 | 1,4 |
| [30 ; 50[ | 40 | 6 | 50 | 0,3 |

- Classe modale : [10 ; 20[, qui a la plus forte densité.
- Moyenne ≈ (12 × 5 + 18 × 15 + 14 × 25 + 6 × 40) / 50 = 920 / 50 = 18,4 min.
- La 25e observation se situe dans [10 ; 20[ ; médiane ≈ 10 + (25 − 12) / 18 × 10 ≈ 17,2 min.
- Les classes n'ont pas la même amplitude : les hauteurs doivent être proportionnelles aux densités, sinon la classe [30 ; 50[ serait visuellement surreprésentée.

**Exercice 3.**

- Moyenne : 0,9 × 12 + 2 = 12,8. Écart-type : 0,9 × √6 ≈ 2,20, car l'ajout d'une constante ne modifie pas la dispersion.
- A : 0,9 × 8 + 2 = 9,2 (gain de 1,2 point) ; J : 0,9 × 16 + 2 = 16,4 (gain de 0,4 point).
- Toutes les notes inférieures à 20 augmentent, d'autant plus qu'elles sont faibles, et une note de 20 reste égale à 20 : la distribution se resserre.
`,
};

// ─── Évaluation / Examen ─────────────────────────────────────────────────────

const EVALUATION_SCOLAIRE: DemoExample = {
  subject: 'Les fractions simples',
  level: 'CM1 — Mathématiques',
  markdown: `
# Évaluation — Les fractions

**Durée :** 40 minutes. **Matériel :** crayon, règle, crayons de couleur, feuille à carreaux.

## Compétences évaluées

| Code | Compétence | Exercices |
|---|---|---|
| C1 | Utiliser une fraction simple pour exprimer un partage | 1 et 2 |
| C2 | Placer une fraction sur une demi-droite graduée | 3 |
| C3 | Comparer des fractions et les encadrer entre deux entiers | 4 et 5 |
| C4 | Résoudre un problème faisant intervenir une fraction d'une quantité | 6 |

## Sujet

### Exercice 1 — Colorier une fraction

- a) Trace un rectangle partagé en 4 parts égales et colorie les 3/4 du rectangle.
- b) Trace une bande partagée en 6 parts égales et colorie les 2/3 de la bande.

### Exercice 2 — Écrire une fraction

Une pizza est coupée en 8 parts égales. Léo en mange 3.

- a) Quelle fraction de la pizza Léo a-t-il mangée ?
- b) Quelle fraction de la pizza reste-t-il ?

### Exercice 3 — Placer des fractions

Trace une demi-droite graduée en prenant 4 carreaux pour une unité. Place les nombres 1/4 ; 3/4 ; 5/4 et 8/4.

### Exercice 4 — Comparer

Complète avec le signe qui convient (<, > ou =) : 3/5 … 4/5 ; 7/4 … 1 ; 2/2 … 1 ; 1/3 … 1/2.

### Exercice 5 — Encadrer

Encadre chaque fraction entre deux nombres entiers qui se suivent : 7/4 ; 9/2 ; 11/3.

### Exercice 6 — Problème

Dans une classe de 24 élèves, les 3/4 des élèves mangent à la cantine. Combien d'élèves mangent à la cantine ? Combien n'y mangent pas ?

## Corrigé et critères de réussite

| Exercice | Réponses attendues | Critère de réussite |
|---|---|---|
| 1 | a) 3 parts sur 4 coloriées ; b) 4 parts sur 6 coloriées | les deux coloriages sont justes |
| 2 | a) 3/8 ; b) 5/8 | les deux fractions sont justes |
| 3 | 1/4 à 1 carreau, 3/4 à 3 carreaux, 5/4 à 5 carreaux, 8/4 à 8 carreaux (c'est-à-dire 2) | au moins 3 placements justes sur 4 |
| 4 | 3/5 < 4/5 ; 7/4 > 1 ; 2/2 = 1 ; 1/3 < 1/2 | au moins 3 réponses justes sur 4 |
| 5 | 1 < 7/4 < 2 ; 4 < 9/2 < 5 ; 3 < 11/3 < 4 | au moins 2 encadrements justes sur 3 |
| 6 | 24 ÷ 4 = 6 ; 6 × 3 = 18 élèves mangent à la cantine ; 24 − 18 = 6 élèves n'y mangent pas | démarche lisible et résultats justes |

## Positionnement par compétence

| Niveau de maîtrise | Repère |
|---|---|
| Très bonne maîtrise | tous les critères de la compétence sont atteints, avec des explications claires |
| Maîtrise satisfaisante | les critères sont atteints malgré une erreur isolée |
| Maîtrise fragile | une partie seulement des critères est atteinte |
| Maîtrise insuffisante | les critères ne sont pas atteints |

> Remédiation : pour les élèves en maîtrise fragile ou insuffisante, reprendre la manipulation avec des bandes de papier pliées en 2, en 4 et en 8, puis faire verbaliser : « 3/4, ce sont 3 parts quand l'unité est partagée en 4 parts égales ».

## Erreur fréquente à anticiper

À l'exercice 4, certains élèves pensent que 1/3 est plus grand que 1/2 « parce que 3 est plus grand que 2 ». Faire comparer concrètement une part d'un gâteau coupé en 3 et une part du même gâteau coupé en 2 : plus on partage, plus chaque part est petite.
`,
};

const EVALUATION_SUPERIEUR: DemoExample = {
  subject: 'Algorithmique et structures de données',
  level: 'Licence 2 — Informatique (examen terminal)',
  markdown: `
# Examen — Algorithmique et structures de données

**Session 1. Durée :** 2 heures. **Documents :** non autorisés. **Barème :** sur 20 points.

> Toutes les réponses doivent être justifiées. Les algorithmes peuvent être écrits en Python ou dans le pseudo-langage du cours.

## Exercice 1 — Complexité (5 points)

1. (2 points) Donner la complexité dans le pire cas, en notation O, de : a) la recherche séquentielle dans un tableau de n éléments ; b) la recherche dichotomique dans un tableau trié ; c) le tri par insertion.
2. (3 points) Que calcule la fonction suivante ? Combien de comparaisons effectue-t-elle ? En déduire sa complexité.

\`\`\`python
def f(t):
    n = len(t)
    c = 0
    for i in range(n):
        for j in range(i + 1, n):
            if t[i] == t[j]:
                c = c + 1
    return c
\`\`\`

## Exercice 2 — Recherche dichotomique (6 points)

1. (3 points) Écrire une fonction itérative \`recherche(t, x)\` qui renvoie un indice de x dans le tableau trié t, ou −1 si x est absent.
2. (1 point) Pour un tableau de 1 000 éléments, combien de tours de boucle sont effectués au maximum ?
3. (2 points) Expliquer pourquoi la précondition « t est trié » est indispensable.

## Exercice 3 — Piles (5 points)

1. (1 point) Définir une pile et citer ses opérations élémentaires.
2. (4 points) Écrire un algorithme utilisant une pile pour vérifier qu'une expression est bien parenthésée (parenthèses et crochets). Exemples : \`[(a + b) * (c - d)]\` est correcte, \`[(a + b] * c)\` ne l'est pas.

## Exercice 4 — Synthèse (4 points)

Comparer le tri par insertion et le tri fusion (pire cas, meilleur cas, mémoire, stabilité). Dans quelle situation le tri par insertion reste-t-il un bon choix ?

## Éléments de corrigé

**Exercice 1.** a) O(n) ; b) O(log n) ; c) O(n²). La fonction f compte les paires d'indices (i, j), avec i < j, telles que t[i] = t[j]. Elle effectue n(n − 1)/2 comparaisons, d'où une complexité en O(n²).

**Exercice 2.**

\`\`\`python
def recherche(t, x):
    g, d = 0, len(t) - 1
    while g <= d:
        m = (g + d) // 2
        if t[m] == x:
            return m
        elif t[m] < x:
            g = m + 1
        else:
            d = m - 1
    return -1
\`\`\`

Au plus 10 tours, car chaque tour divise par deux la zone de recherche et 2¹⁰ = 1 024 > 1 000. Sans tri, rien ne permet d'écarter une moitié du tableau.

**Exercice 3.** Pile : structure « dernier entré, premier sorti » (empiler, dépiler, sommet, est_vide). On empile chaque symbole ouvrant ; pour un symbole fermant, l'expression est incorrecte si la pile est vide ou si le sommet ne correspond pas, sinon on dépile. À la fin, l'expression est correcte si et seulement si la pile est vide.

**Exercice 4.**

| Critère | Tri par insertion | Tri fusion |
|---|---|---|
| Pire cas | O(n²) | O(n log n) |
| Meilleur cas | O(n), tableau déjà trié | O(n log n) |
| Mémoire supplémentaire | O(1), tri en place | O(n) sur tableaux |
| Stabilité | stable | stable |

Le tri par insertion reste pertinent pour de petits tableaux ou des données presque triées.

## Grille de correction

| Critère | Points |
|---|---|
| Complexités exactes et justifiées | 5 |
| Recherche correcte : terminaison, cas absent, indices | 6 |
| Parenthésage correct, cas de la pile vide traité | 5 |
| Comparaison argumentée des tris | 4 |
| **Total** | **20** |
`,
};

// ─── Séquence / Plan de module ───────────────────────────────────────────────

const SEQUENCE_SCOLAIRE: DemoExample = {
  subject: "L'eau dans tous ses états",
  level: 'CE2 — Questionner le monde',
  markdown: `
# Séquence — L'eau dans tous ses états

> Problème de départ : où est passée l'eau de la flaque de la cour après une journée ensoleillée ?

**Domaine :** Questionner le monde, la matière. **Durée :** 6 séances de 45 minutes.

## Objectifs de la séquence

- Identifier les trois états de l'eau : solide, liquide et gazeux.
- Savoir que l'eau pure gèle à 0 °C et bout à 100 °C, à la pression atmosphérique normale.
- Comprendre qu'un changement d'état ne fait pas disparaître l'eau : elle passe d'un état à un autre.
- Pratiquer une démarche d'investigation : hypothèse, expérience, observation, conclusion.
- Lire une température sur un thermomètre.

## Déroulement

| Séance | Titre | Activités principales | Trace écrite |
|---|---|---|---|
| 1 | Nos idées de départ | Chaque élève dessine « où va l'eau de la flaque », puis confrontation des hypothèses | Affiche des hypothèses de la classe |
| 2 | Solide ou liquide ? | Observer et manipuler glaçons, eau, neige ou givre ; trier selon qu'ils ont une forme propre ou non | Tableau « solide / liquide » |
| 3 | Fusion et solidification | Placer des glaçons à différents endroits ; mettre un pot d'eau au congélateur ; peser un glaçon dans un sac fermé avant et après fusion | Schéma des deux transformations |
| 4 | Le thermomètre | Mesurer la température de l'eau glacée, de l'eau du robinet et de l'eau tiède ; repérer 0 °C | Fiche « Je lis un thermomètre » |
| 5 | L'évaporation | Deux assiettes avec la même quantité d'eau, l'une couverte, l'autre non ; observation sur plusieurs jours ; buée sur une vitre froide | Schéma des changements d'état |
| 6 | Retour au problème | Réponse argumentée à la question de départ ; évaluation individuelle | Carte mentale de la séquence |

## Les changements d'état à connaître

| Changement d'état | État de départ | État d'arrivée | Exemple du quotidien |
|---|---|---|---|
| Fusion | solide | liquide | un glaçon qui fond |
| Solidification | liquide | solide | l'eau qui gèle au congélateur |
| Vaporisation | liquide | gazeux | le linge qui sèche, l'eau qui bout |
| Liquéfaction | gazeux | liquide | la buée sur une vitre froide |

Dans le langage courant, la liquéfaction est souvent appelée « condensation ».

## Points scientifiques pour l'enseignant

- L'eau (H₂O) reste la même substance dans ses trois états : seules l'organisation et l'agitation de ses molécules changent.
- La vapeur d'eau est **invisible**. Le « nuage » blanc au-dessus d'une casserole est formé de fines gouttelettes d'eau liquide.
- Lors de la fusion, la masse se conserve : le glaçon pesé dans un sac fermé a la même masse une fois fondu.
- En gelant, l'eau augmente de volume d'environ 9 % : une bouteille pleine peut éclater au congélateur.
- L'évaporation se produit à toute température, alors que l'ébullition de l'eau pure a lieu à 100 °C sous la pression atmosphérique normale.

> Sécurité : l'ébullition est montrée uniquement par l'enseignant, avec une bouilloire, les élèves restant à distance.

## Évaluation (séance 6)

1. Relier chaque image (glaçon, flaque, buée, neige) à l'état de l'eau correspondant.
2. Compléter : « À 0 °C, l'eau liquide se transforme en … ; ce changement d'état s'appelle la … »
3. Expliquer en une ou deux phrases où est passée l'eau de la flaque.

## Différenciation

- **Aide** : étiquettes-mots et images pour compléter le schéma des changements d'état.
- **Approfondissement** : imaginer une expérience pour savoir si l'eau salée gèle à la même température que l'eau pure.
`,
};

const SEQUENCE_SUPERIEUR: DemoExample = {
  subject: 'Contrôle de gestion : des coûts au pilotage de la performance',
  level: 'Licence 3 — Gestion (UE de 6 ECTS)',
  markdown: `
# Plan de module — Contrôle de gestion

**Public :** Licence 3 Gestion, semestre 5. **Crédits :** 6 ECTS. **Volume :** 18 h de CM (9 × 2 h) et 24 h de TD (12 × 2 h).

> Fil conducteur : passer du calcul des coûts au pilotage de la performance, à partir d'une même entreprise fictive étudiée de la première à la dernière séance.

## Objectifs d'apprentissage

À l'issue de l'UE, l'étudiant sera capable de :

1. distinguer les catégories de charges et calculer des coûts complets ;
2. calculer des coûts partiels, une marge sur coût variable et un seuil de rentabilité ;
3. construire des budgets et analyser les écarts entre prévisions et réalisations ;
4. concevoir un tableau de bord adapté à un centre de responsabilité.

## Organisation des séances

| Semaine | CM (2 h) | TD (2 h) |
|---|---|---|
| 1 | Missions et évolution du contrôle de gestion | Présentation du cas fil rouge |
| 2 | Charges directes et indirectes, fixes et variables | Classement des charges du cas |
| 3 | Coûts complets : centres d'analyse, unités d'œuvre | Répartition des charges indirectes |
| 4 | Coût de revient et résultat analytique | Résultat par produit |
| 5 | Méthode ABC (coûts par activités) | Comparaison centres d'analyse et ABC |
| 6 | Coûts partiels : coût variable, marge sur coût variable | Compte de résultat différentiel |
| 7 | Seuil de rentabilité, levier opérationnel | Exercices de seuil (voir exemple) |
| 8 | Gestion budgétaire : ventes, production, trésorerie | Budget de trésorerie |
| 9 | Contrôle budgétaire et analyse des écarts | Écarts sur chiffre d'affaires et sur charges |
| 10 | — | Tableau de bord : choisir des indicateurs |
| 11 | — | Atelier dossier en binôme |
| 12 | — | Révision : cas de synthèse |

## Exemple travaillé en TD (semaine 7)

> Une entreprise supporte 120 000 € de charges fixes annuelles ; son taux de marge sur coût variable est de 40 %.
>
> - Seuil de rentabilité : 120 000 / 0,40 = 300 000 € de chiffre d'affaires.
> - Pour un chiffre d'affaires prévu de 400 000 €, la marge de sécurité est de 100 000 €, soit un indice de sécurité de 25 %.
> - Point mort : (300 000 / 400 000) × 360 = 270 jours, soit fin septembre si l'activité est régulière.
> - Levier opérationnel : marge sur coût variable / résultat = 160 000 / 40 000 = 4 ; une hausse de 1 % du chiffre d'affaires entraîne une hausse de 4 % du résultat.

## Modalités d'évaluation

| Épreuve | Forme | Poids |
|---|---|---|
| Contrôle continu | deux tests écrits d'une heure en TD (semaines 5 et 9) | 30 % |
| Dossier | étude de cas en binôme : diagnostic des coûts et tableau de bord | 20 % |
| Examen terminal | épreuve écrite de 2 heures, cas pratique | 50 % |

## Compétences transversales

- Utiliser un tableur pour automatiser un calcul de coûts et simuler des scénarios.
- Présenter des résultats chiffrés de façon synthétique à un public non spécialiste.
- Travailler en équipe sur un livrable commun.

## Ressources

- Espace de cours en ligne : diaporamas, énoncés et corrigés, fichiers tableur.
- Pistes de lecture à constituer : manuels de contrôle de gestion de niveau licence disponibles à la bibliothèque universitaire, fiches méthodologiques, études de cas d'entreprises. Mots-clés : « coût complet », « méthode ABC », « seuil de rentabilité », « contrôle budgétaire ».
`,
};

// ─── Fiche de préparation / Fiche de séance ──────────────────────────────────

const FICHE_PREP_SCOLAIRE: DemoExample = {
  subject: 'La masse volumique',
  level: '4e — Physique-Chimie',
  markdown: `
# Fiche de préparation — La masse volumique

| Rubrique | Contenu |
|---|---|
| Niveau | 4e |
| Durée | 55 minutes |
| Thème | Organisation et transformations de la matière |
| Prérequis | mesurer une masse avec une balance et un volume avec une éprouvette graduée ; savoir que 1 mL = 1 cm³ |
| Matériel par groupe | balance électronique, éprouvette graduée de 100 mL, eau, huile de tournesol, calculatrice |

## Objectifs

- Définir la masse volumique d'une substance : ρ = m / V.
- Calculer une masse volumique et l'exprimer en g/cm³ ou en kg/m³.
- Utiliser la masse volumique pour identifier une substance et prévoir si un objet flotte.

## Déroulement

| Phase | Durée | Activité des élèves | Rôle de l'enseignant |
|---|---|---|---|
| 1. Situation déclenchante | 5 min | Question : « Pourquoi l'huile reste-t-elle au-dessus de l'eau ? » Hypothèses orales | Note les hypothèses sans les valider |
| 2. Mesures | 20 min | Mesurer la masse de 20, 40 et 60 mL d'eau, puis de 40 mL d'huile | Vérifie la tare et la lecture au bas du ménisque |
| 3. Exploitation | 10 min | Calculer m / V pour chaque mesure et comparer | Fait constater que le quotient est constant pour une même substance |
| 4. Institutionnalisation | 10 min | Copier la trace écrite | Formalise la définition et les unités |
| 5. Réinvestissement | 10 min | Identifier un métal à partir de sa masse et de son volume | Différencie selon les besoins |

## Résultats attendus

| Liquide | Volume V | Masse m | m / V |
|---|---|---|---|
| Eau | 20 mL | 20 g | 1,0 g/mL |
| Eau | 40 mL | 40 g | 1,0 g/mL |
| Eau | 60 mL | 60 g | 1,0 g/mL |
| Huile de tournesol | 40 mL | environ 37 g | environ 0,92 g/mL |

L'huile a une masse volumique plus faible que celle de l'eau : elle flotte, ce qui répond à la question de départ.

## Trace écrite

> La masse volumique ρ (lettre grecque « rhô ») d'une substance est le quotient de sa masse par son volume : ρ = m / V. À température donnée, elle est caractéristique de la substance. Pour l'eau liquide, ρ = 1 g/cm³ = 1 kg/L = 1 000 kg/m³. Un objet plein, fait d'une seule substance, flotte sur un liquide si sa masse volumique est inférieure à celle de ce liquide.

## Exercice de réinvestissement

Un cylindre métallique a une masse de 54 g et un volume de 20 cm³. De quel métal s'agit-il ?

| Métal | Masse volumique (g/cm³) |
|---|---|
| Aluminium | 2,7 |
| Fer | 7,9 |
| Cuivre | 8,96 |
| Plomb | 11,3 |
| Or | 19,3 |

Corrigé : ρ = 54 / 20 = 2,7 g/cm³ ; le cylindre est en aluminium.

## Points de vigilance

- Ne pas confondre « lourd » (masse) et « dense » (masse volumique) : 1 kg de plomb et 1 kg de plumes ont la même masse, mais pas le même volume.
- Mesurer la masse du liquide seul : tarer la balance avec l'éprouvette vide.
- Vérifier la cohérence des unités avant de calculer.

## Différenciation

- **Aide** : fiche méthode avec un exemple de calcul entièrement rédigé.
- **Approfondissement** : la glace (ρ ≈ 0,92 g/cm³) flotte-t-elle sur l'eau liquide ? Sachant que la masse se conserve lors de la solidification, expliquer pourquoi une bouteille pleine d'eau peut éclater au congélateur.
`,
};

const FICHE_PREP_SUPERIEUR: DemoExample = {
  subject: 'Équilibre de marché, taxe et élasticité-prix',
  level: 'Licence 1 — Économie (séance de TD)',
  markdown: `
# Fiche de séance — TD 4 : équilibre de marché et élasticités

| Rubrique | Contenu |
|---|---|
| Public | Licence 1 Économie-Gestion, groupe de TD de 35 étudiants au plus |
| Durée | 1 h 30 |
| Prérequis | CM 3 et 4 : fonctions d'offre et de demande, surplus |
| Supports | feuille d'exercices, tableau, fichier tableur de simulation |

## Objectifs de la séance

- Déterminer algébriquement et graphiquement un équilibre de marché.
- Analyser l'effet d'une taxe unitaire sur le prix, la quantité et la répartition de la charge fiscale.
- Calculer et interpréter une élasticité-prix de la demande.

## Énoncé de travail

> Sur un marché concurrentiel, la demande est Qd = 100 − 2p et l'offre Qo = 20 + 2p (p en euros, Q en milliers d'unités).

1. Déterminer le prix et la quantité d'équilibre.
2. L'État instaure une taxe de 4 € par unité, versée par les producteurs. Déterminer le nouvel équilibre.
3. Calculer la recette fiscale, la perte sèche et la répartition de la charge de la taxe.
4. Calculer l'élasticité-prix de la demande à l'équilibre initial et l'interpréter.

## Déroulé

| Temps | Phase | Modalité | Rôle de l'enseignant |
|---|---|---|---|
| 0 – 10 min | Rappels ciblés | questions flash à main levée | vérifie les prérequis, distingue « offre » et « quantité offerte » |
| 10 – 30 min | Questions 1 et 2 | binômes | circule et relance : « que devient l'offre, exprimée en fonction du prix payé par l'acheteur ? » |
| 30 – 45 min | Correction des questions 1 et 2 | un binôme au tableau | construit le graphique |
| 45 – 65 min | Questions 3 et 4 | individuel, puis confrontation | repère les erreurs de signe |
| 65 – 80 min | Correction et généralisation | collectif | fait formuler la règle d'incidence |
| 80 – 90 min | Synthèse et ticket de sortie | individuel | recueille les tickets pour ajuster le TD suivant |

## Éléments de correction pour l'enseignant

1. 100 − 2p = 20 + 2p, donc 4p = 80 : p* = 20 € et Q* = 60 milliers d'unités.
2. En fonction du prix payé par l'acheteur, l'offre devient Qo = 20 + 2(p − 4) = 12 + 2p. D'où p = 22 € et Q = 56 ; le producteur reçoit 22 − 4 = 18 €.
3. Recette fiscale : 4 × 56 = 224 milliers d'euros. Perte sèche : 4 × (60 − 56) / 2 = 8 milliers d'euros. Les acheteurs paient 2 € de plus et les vendeurs reçoivent 2 € de moins : la charge est partagée à égalité, car les pentes sont égales en valeur absolue.
4. e = (dQ/dp) × (p/Q) = −2 × 20 / 60 ≈ −0,67. Comme |e| < 1, la demande est inélastique en ce point : une hausse de 1 % du prix réduit la quantité demandée d'environ 0,67 %.

## Erreurs fréquentes à anticiper

- Croire que l'incidence économique dépend de celui qui verse légalement la taxe : taxer les acheteurs conduirait au même équilibre.
- Confondre la pente d'une droite de demande et l'élasticité, qui varie le long de cette droite.
- Oublier les unités (milliers d'unités, euros) dans les réponses.

## Ticket de sortie

1. En une phrase, pourquoi une taxe réduit-elle la quantité échangée ?
2. Une élasticité-prix de −1,5 correspond-elle à une demande élastique ou inélastique ?

## Prolongement sur tableur

Pour une taxe t quelconque, Q = 60 − t : la recette fiscale t × (60 − t) est maximale pour t = 30 €, tandis que la perte sèche t² / 2 croît avec le carré de la taxe. Faire tracer ces deux courbes pour t de 0 à 60 €.
`,
};

// ─── Progression / Syllabus ──────────────────────────────────────────────────

const PROGRESSION_SCOLAIRE: DemoExample = {
  subject: 'Progression annuelle de philosophie',
  level: 'Terminale générale — Philosophie',
  markdown: `
# Progression annuelle — Philosophie, Terminale générale (2025-2026)

> Principe directeur : regrouper les 17 notions du programme autour de cinq questions directrices, et travailler chaque semaine les deux exercices de l'épreuve écrite, la dissertation et l'explication de texte.

**Horaire :** 4 heures par semaine. **Épreuve :** écrit de 4 heures, au choix entre deux sujets de dissertation et une explication de texte.

## Vue d'ensemble

| Période | Dates indicatives | Question directrice | Notions | Méthode travaillée |
|---|---|---|---|---|
| 1 | septembre – octobre | Que puis-je savoir de moi-même ? | la conscience, l'inconscient, le temps | analyser un sujet, formuler un problème |
| 2 | novembre – décembre | Sommes-nous libres ? | la liberté, le devoir, le bonheur | rédiger une introduction de dissertation |
| 3 | janvier – février | Que pouvons-nous connaître ? | la raison, la vérité, la science, le langage | expliquer un texte : thèse, structure, enjeux |
| 4 | mars – avril | Que fait l'être humain de la nature ? | la nature, la technique, le travail, l'art | construire une dissertation complète |
| 5 | mai – juin | Comment vivre ensemble ? | l'État, la justice, la religion | révisions transversales, sujets croisés |

Les dates sont à ajuster selon le calendrier de la zone et la date de l'épreuve.

## Détail de la période 2 : « Sommes-nous libres ? »

| Semaine | Contenu | Exercice |
|---|---|---|
| 1 | La liberté comme absence de contrainte : une définition suffisante ? | Analyse du sujet « Être libre, est-ce faire ce que l'on veut ? » |
| 2 | Déterminismes et libre arbitre | Explication d'un court texte classique |
| 3 | Le devoir : obligation ou contrainte ? | Travail sur le repère « obligation / contrainte » |
| 4 | Agir par devoir ou conformément au devoir : la morale de Kant | Problématiser un sujet |
| 5 | Le bonheur : idéal de l'imagination ou but accessible ? | Introduction rédigée en classe |
| 6 | Bonheur et vertu chez Épicure et les stoïciens | Plan détaillé |
| 7 | Devoir sur table | Dissertation ou explication de texte (2 heures) |

## Repères du programme mobilisés

- légal / légitime (périodes 2 et 5) ;
- croire / savoir (périodes 3 et 5) ;
- persuader / convaincre (période 3) ;
- obligation / contrainte (période 2) ;
- origine / fondement (période 5).

## Évaluations

| Période | Évaluation | Durée |
|---|---|---|
| 1 | analyse de sujet notée, questions de cours | 1 heure |
| 2 | première dissertation sur table | 2 heures |
| 3 | baccalauréat blanc | 4 heures |
| 4 | explication de texte sur table | 2 heures |
| 5 | second baccalauréat blanc | 4 heures |

> Conseil : proposer à chaque devoir au moins un sujet de dissertation et un texte, afin que les élèves s'exercent au choix qu'ils devront faire le jour de l'épreuve.

## Lecture suivie

Le professeur choisit une œuvre d'un auteur classique, étudiée en fil rouge de janvier à avril en lien avec les périodes 3 et 4. Chaque séance commence par dix minutes de reprise des lectures de la semaine.
`,
};

const PROGRESSION_SUPERIEUR: DemoExample = {
  subject: "Réseaux et protocoles de l'Internet",
  level: 'Licence 3 — Informatique (syllabus semestriel)',
  markdown: `
# Syllabus — Réseaux et protocoles de l'Internet

| Rubrique | Détail |
|---|---|
| Formation | Licence 3 Informatique, semestre 5 |
| Crédits | 6 ECTS |
| Volume horaire | 18 h de CM (12 × 1 h 30), 18 h de TD (6 × 3 h), 12 h de TP (6 × 2 h) |
| Travail personnel estimé | environ 100 à 130 heures |
| Prérequis | programmation (Python ou C), bases du système Linux, numération binaire |

## Objectifs d'apprentissage

- Expliquer l'architecture en couches (modèles OSI et TCP/IP) et le rôle de chaque couche.
- Calculer un plan d'adressage IPv4 avec découpage en sous-réseaux.
- Configurer et diagnostiquer un petit réseau (ping, traceroute, capture et analyse de trames).
- Comparer TCP et UDP et justifier le choix d'un protocole de transport.
- Décrire le fonctionnement de DNS et de HTTP, ainsi que les principes de sécurisation (TLS, filtrage).

## Calendrier

| Semaine | Cours magistral | TD ou TP |
|---|---|---|
| 1 | Commutation de paquets, modèles en couches | TD 1 : encapsulation, délais de transmission et de propagation |
| 2 | Couche liaison : Ethernet, adresses MAC | TP 1 : observation de trames Ethernet |
| 3 | Commutateurs et réseaux locaux virtuels | TD 2 : détection d'erreurs, commutation |
| 4 | IPv4 : adressage, masques, notation CIDR | TP 2 : configuration d'adresses et diagnostic |
| 5 | ARP, ICMP, DHCP | TD 3 : découpage en sous-réseaux |
| 6 | Routage : vecteur de distance, état de liens | TP 3 : routage entre sous-réseaux (évalué) |
| 7 | Traduction d'adresses (NAT) | TD 4 : tables de routage, algorithme de Dijkstra |
| 8 | Couche transport : UDP, TCP | TP 4 : programmation de sockets |
| 9 | TCP : contrôle de flux et de congestion | TD 5 : ouverture de connexion en trois temps, numéros de séquence |
| 10 | DNS et HTTP | TP 5 : requêtes DNS et HTTP en ligne de commande (évalué) |
| 11 | Sécurité : chiffrement, TLS, pare-feu | TD 6 : chiffrement et règles de filtrage |
| 12 | IPv6 et synthèse | TP 6 : mini-projet |

## Exemple d'exercice type (TD 3)

> Le réseau 192.168.10.0/24 doit être découpé en 4 sous-réseaux de même taille. Chacun reçoit un préfixe /26, soit 2⁶ = 64 adresses, dont 62 attribuables à des hôtes (on retire l'adresse du réseau et l'adresse de diffusion). Sous-réseaux obtenus : 192.168.10.0/26, 192.168.10.64/26, 192.168.10.128/26 et 192.168.10.192/26.

## Modalités d'évaluation

| Épreuve | Poids | Détail |
|---|---|---|
| Comptes rendus de TP | 25 % | TP 3 et TP 5, en binôme |
| Contrôle continu | 25 % | écrit d'une heure en semaine 7 |
| Examen terminal | 50 % | écrit de 2 heures, documents non autorisés |

Les règles de seconde session suivent les modalités de contrôle des connaissances adoptées par l'établissement.

## Engagements réciproques

- Présence obligatoire en TP ; toute absence doit être justifiée auprès de la scolarité.
- Les comptes rendus sont personnels au binôme : tout emprunt doit être cité.
- Les supports de cours et les corrigés de TD sont publiés sur l'espace en ligne dans la semaine.

## Pistes de lecture à constituer

- Manuels de réseaux informatiques de niveau licence disponibles à la bibliothèque universitaire.
- Spécifications officielles des protocoles étudiés (documents RFC de l'IETF pour IP, TCP, DNS et HTTP).
- Mots-clés : « modèle TCP/IP », « sous-réseaux CIDR », « contrôle de congestion TCP ».
`,
};

// ─── Appréciations / Commentaires ────────────────────────────────────────────

const APPRECIATIONS_SCOLAIRE: DemoExample = {
  subject: 'Appréciations du 2e trimestre — profil « bon élève »',
  level: '4e — Mathématiques',
  markdown: `
# Appréciations — 2e trimestre, profil « bon élève »

> Dix formulations variées pour un élève de bon niveau en mathématiques. Chacune suit la même logique : un constat positif et précis, une compétence nommée, un conseil pour progresser. À personnaliser avec un exemple tiré du trimestre.

## Appréciations

1. Très bon trimestre. Les connaissances sur le théorème de Pythagore sont solides et les raisonnements rédigés avec rigueur. Pour aller plus loin, oser prendre davantage la parole lors des recherches collectives.
2. Un travail sérieux et régulier qui porte ses fruits : le calcul sur les nombres relatifs et les fractions est désormais sûr. Il faut maintenant soigner la justification de chaque étape dans les problèmes.
3. De bons résultats, obtenus grâce à une réelle implication en classe. La démarche est rigoureuse ; attention toutefois aux étourderies en calcul littéral, qui coûtent encore quelques points.
4. Un trimestre solide. Les notions nouvelles sont comprises rapidement et l'entraide avec les camarades est appréciable. Viser l'excellence en s'attaquant aux exercices de recherche proposés en fin de chapitre.
5. De bons acquis et une participation pertinente. Les puissances et le développement d'expressions sont bien maîtrisés. Continuer à relire ses copies pour éviter les erreurs de signe.
6. Un ensemble satisfaisant et constant. Les méthodes sont connues et appliquées avec efficacité. Gagner en autonomie face aux problèmes ouverts : essayer, schématiser, puis vérifier.
7. Une très bonne attitude de travail et des résultats en progrès par rapport au premier trimestre. La rédaction est claire et soignée. Poursuivre l'entraînement aux démonstrations en géométrie.
8. Bon trimestre, marqué par une belle réussite au devoir sur la proportionnalité. Les exercices sont toujours faits avec soin. Il reste à fiabiliser la résolution d'équations, encore hésitante.
9. Sérieux, curiosité et investissement caractérisent ce trimestre. Les compétences « raisonner » et « communiquer » sont bien développées. Pour progresser encore, employer un vocabulaire mathématique plus précis, à l'oral comme à l'écrit.
10. Des résultats bons et réguliers, signe d'un travail personnel efficace. La participation orale, encore discrète, gagnerait à s'affirmer : les idées proposées sont souvent justes et utiles au groupe.

## Structure commune

| Élément | Rôle | Exemples de formulations |
|---|---|---|
| Constat | situer le niveau global | « Très bon trimestre », « Un ensemble solide » |
| Point fort précis | valoriser un acquis identifiable | « Le calcul sur les fractions est désormais sûr » |
| Compétence | s'appuyer sur les six compétences du cycle 4 : chercher, modéliser, représenter, raisonner, calculer, communiquer | « La démarche est rigoureuse » |
| Conseil | proposer une action concrète | « Relire ses copies », « Oser prendre la parole » |

## Conseils d'usage

- Varier les débuts d'appréciation d'un élève à l'autre pour éviter l'effet « copier-coller ».
- Porter un jugement sur le travail et les compétences, jamais sur la personne.
- Rester cohérent avec la moyenne obtenue et avec les appréciations des autres disciplines.
`,
};

const APPRECIATIONS_SUPERIEUR: DemoExample = {
  subject: "Commentaires d'évaluation — dossier d'étude de cas",
  level: "Master 1 — Systèmes d'information",
  markdown: `
# Commentaires d'évaluation — Dossier « Gouvernance du SI d'une PME industrielle »

> Six commentaires correspondant à des copies de niveaux différents. Chacun suit la même structure : points forts, point prioritaire à retravailler, conseil concret pour le prochain travail.

## Grille de référence

| Critère | Poids |
|---|---|
| Diagnostic de la situation (acteurs, enjeux, risques) | 30 % |
| Mobilisation des référentiels (ISO/IEC 38500, COBIT) | 25 % |
| Pertinence et faisabilité des recommandations | 30 % |
| Structure et qualité rédactionnelle | 15 % |

## Commentaires

**1. Copie excellente (17/20).** Votre diagnostic est précis et hiérarchise clairement les risques, en particulier la dépendance à un prestataire unique. Le recours à ISO/IEC 38500 est pertinent et dépasse la simple citation. Pour aller encore plus loin, chiffrez le coût de vos recommandations et proposez un calendrier de mise en œuvre réaliste.

**2. Très bonne copie (15/20).** Le dossier est bien construit et les recommandations découlent logiquement du diagnostic. L'analyse des parties prenantes reste toutefois rapide : la direction financière et les utilisateurs métiers sont peu présents. Dans votre prochain travail, reliez explicitement chaque recommandation au risque qu'elle réduit.

**3. Copie solide mais descriptive (13/20).** Vous présentez correctement le contexte de l'entreprise et les référentiels. En revanche, la partie consacrée à ces référentiels ressemble à un résumé de cours : elle n'est pas appliquée au cas. Demandez-vous systématiquement : « Qu'est-ce que ce référentiel change concrètement pour cette PME ? »

**4. Copie correcte, recommandations fragiles (11/20).** Le diagnostic identifie les principaux problèmes, notamment l'absence de plan de continuité d'activité. Les recommandations restent trop générales (« renforcer la sécurité ») pour être mises en œuvre. Formulez chacune avec un responsable, une échéance et un indicateur de réussite.

**5. Copie insuffisante (8/20).** Le travail témoigne d'une lecture attentive du cas, mais il confond gouvernance et gestion opérationnelle : la plupart des propositions concernent le support informatique quotidien. Reprenez la distinction entre « faire les bonnes choses » et « bien faire les choses », puis réorganisez votre plan autour des décisions de la direction.

**6. Copie partiellement hors sujet (6/20).** Votre dossier traite surtout du choix d'un nouveau progiciel de gestion intégré, sans lien avec la gouvernance du SI. Certaines analyses techniques sont pourtant justes et réutilisables. Je vous invite à venir en permanence : nous reprendrons ensemble la consigne et la construction d'une problématique.

## Principes suivis

- Commencer par un point fort réel, même pour une copie faible.
- Limiter les axes de progrès à un ou deux, formulés comme des actions.
- Relier chaque remarque à un critère de la grille, afin que la note soit compréhensible.
- S'adresser à l'étudiant au vouvoiement, sur un ton professionnel et bienveillant.
`,
};

// ─── Différenciation / Adaptations ───────────────────────────────────────────

const DIFFERENCIATION_SCOLAIRE: DemoExample = {
  subject: 'Proportionnalité : adapter une recette',
  level: '6e — Mathématiques',
  markdown: `
# Différenciation — Adapter une recette de crêpes

> Objectif commun : résoudre un problème de proportionnalité. Les trois versions portent sur la même situation et la même notion ; seuls le guidage et le niveau d'exigence changent.

**Recette pour 4 personnes :** 250 g de farine, 4 œufs, 500 mL de lait, 50 g de beurre fondu, une pincée de sel.

## Version 1 — Accompagnement renforcé

**Consigne :** complète le tableau pour préparer des crêpes pour 8 personnes, puis pour 2 personnes.

> Coup de pouce : pour 8 personnes, il y a deux fois plus de personnes que dans la recette, donc il faut deux fois plus de chaque ingrédient. Exemple : farine pour 8 personnes = 250 × 2 = 500 g.

| Ingrédient | 4 personnes | 8 personnes (× 2) | 2 personnes (÷ 2) |
|---|---|---|---|
| Farine | 250 g | 500 g | … g |
| Œufs | 4 | … | … |
| Lait | 500 mL | … mL | … mL |
| Beurre | 50 g | … g | … g |

Aides possibles : calculatrice, tableau déjà commencé, travail en binôme.

## Version 2 — Standard

**Consigne :** calcule les quantités d'ingrédients nécessaires pour 6 personnes, puis pour 10 personnes. Explique ta méthode en une phrase.

## Version 3 — Approfondissement

**Consigne :**

1. Quelle quantité de farine faut-il prévoir par personne ?
2. Léa ne dispose que de 3 œufs. Pour combien de personnes peut-elle préparer la pâte ? Quelles quantités des autres ingrédients doit-elle utiliser ?
3. Tom a 1 L de lait, 600 g de farine et 12 œufs. Pour combien de personnes au maximum peut-il cuisiner ? Justifie.

## Corrigé

| Personnes | Farine | Œufs | Lait | Beurre |
|---|---|---|---|---|
| 2 | 125 g | 2 | 250 mL | 25 g |
| 3 | 187,5 g | 3 | 375 mL | 37,5 g |
| 6 | 375 g | 6 | 750 mL | 75 g |
| 8 | 500 g | 8 | 1 000 mL | 100 g |
| 10 | 625 g | 10 | 1 250 mL | 125 g |

- **Version 2** : pour 6 personnes, on additionne les quantités pour 4 et pour 2 personnes, ou l'on multiplie par 1,5 ; pour 10 personnes, on multiplie par 2,5.
- **Version 3** : 250 ÷ 4 = 62,5 g de farine par personne. Avec 3 œufs, Léa cuisine pour 3 personnes. Pour Tom, le lait suffit pour 8 personnes (1 000 ÷ 125 = 8), la farine pour 9 personnes (600 ÷ 62,5 = 9,6) et les œufs pour 12 personnes : le lait est l'ingrédient limitant, Tom peut donc cuisiner pour 8 personnes au maximum.

## Repères pour l'enseignant

| Critère | Version 1 | Version 2 | Version 3 |
|---|---|---|---|
| Procédure visée | multiplier ou diviser par 2 | combiner des colonnes ou utiliser un coefficient | passer par l'unité, repérer un facteur limitant |
| Guidage | exemple résolu, tableau commencé | aucun, calculatrice possible | aucun |
| Production attendue | tableau complété | tableau et phrase d'explication | raisonnement rédigé |

> Les groupes ne sont pas figés : un élève qui réussit la version 1 passe à la version 2. La mise en commun finale compare les procédures et montre qu'elles mènent aux mêmes résultats.
`,
};

const DIFFERENCIATION_SUPERIEUR: DemoExample = {
  subject: 'Lire et interpréter un tableau croisé',
  level: 'Licence 1 — Sociologie (méthodes quantitatives)',
  markdown: `
# Parcours différenciés — Lire et interpréter un tableau croisé

> Un même exercice décliné en trois parcours, suivi des aménagements possibles pour les étudiants bénéficiant d'un plan d'accompagnement (situation de handicap, régime spécial d'études).

## Données communes

Enquête auprès de 200 étudiants d'un campus : mode de transport principal selon le lieu de résidence (données fictives à usage pédagogique).

| Résidence | Transports en commun | Voiture | Vélo ou marche | Total |
|---|---|---|---|---|
| Centre-ville | 40 | 8 | 32 | 80 |
| Périphérie | 60 | 48 | 12 | 120 |
| Ensemble | 100 | 56 | 44 | 200 |

## Parcours 1 — Accompagnement renforcé

- Rappel : pourcentage en ligne = effectif de la case / total de la ligne × 100.
- Exemple résolu : 40 / 80 × 100 = 50 % des étudiants du centre-ville utilisent les transports en commun.
- Compléter le tableau des pourcentages en ligne (squelette fourni).
- Compléter la phrase : « Parmi les étudiants qui habitent en périphérie, … % utilisent la voiture. »

## Parcours 2 — Standard

1. Calculer les pourcentages en ligne.
2. Rédiger trois phrases d'interprétation rigoureuses.
3. Expliquer pourquoi les rapports 48 / 56 et 48 / 120 ne répondent pas à la même question.

## Parcours 3 — Approfondissement

1. Calculer les effectifs théoriques sous l'hypothèse d'indépendance, puis la statistique du khi-deux.
2. Conclure au seuil de 5 % (2 degrés de liberté, valeur critique 5,99).
3. Le lieu de résidence « cause »-t-il le mode de transport ? Proposer une variable à contrôler.

## Éléments de correction

| Résidence | Transports en commun | Voiture | Vélo ou marche | Total |
|---|---|---|---|---|
| Centre-ville | 50 % | 10 % | 40 % | 100 % |
| Périphérie | 50 % | 40 % | 10 % | 100 % |
| Ensemble | 50 % | 28 % | 22 % | 100 % |

- 48 / 56 ≈ 85,7 % des automobilistes habitent en périphérie (pourcentage en colonne), alors que 48 / 120 = 40 % des étudiants de périphérie utilisent la voiture (pourcentage en ligne).
- Effectif théorique pour « centre-ville et voiture » : 80 × 56 / 200 = 22,4. Le khi-deux vaut environ 35,1, bien au-delà de 5,99 : on rejette l'hypothèse d'indépendance.
- Une association statistique n'établit pas une causalité : la possession d'un véhicule, les revenus du foyer ou la desserte en transports peuvent expliquer une partie du lien.

## Aménagements possibles

| Besoin | Aménagement |
|---|---|
| Trouble spécifique des apprentissages | énoncé aéré en police agrandie, calculatrice, temps majoré si prévu par le plan |
| Déficience visuelle | tableau fourni dans un format numérique compatible avec un lecteur d'écran |
| Étudiant salarié | corrigé commenté en ligne, dépôt différé du travail |
| Difficultés d'attention | consignes découpées en étapes, salle à effectif réduit selon le plan |

> Les aménagements d'examen relèvent d'une décision de l'établissement, prise sur avis médical ; l'enseignant met en œuvre ceux qui lui sont notifiés et peut proposer librement les adaptations pédagogiques en TD.
`,
};

// ─── Courrier aux familles / Message aux étudiants ───────────────────────────

const LETTRE_SCOLAIRE: DemoExample = {
  subject: "Sortie scolaire au muséum d'histoire naturelle",
  level: 'CM1 — Courrier aux familles',
  markdown: `
# Courrier aux familles — Sortie au muséum d'histoire naturelle

**École [Nom de l'école]**, classe de CM1 de [Nom de l'enseignant]

[Ville], le [Date]

**Objet :** sortie pédagogique au muséum d'histoire naturelle le [Date de la sortie]

Madame, Monsieur,

Dans le cadre de notre travail en sciences sur la diversité du vivant et la classification des animaux, la classe de CM1 se rendra au muséum d'histoire naturelle de [Ville] le [Date de la sortie]. Les élèves participeront à un atelier animé par un médiateur du muséum et observeront des collections de squelettes, d'insectes et de fossiles. Cette visite prolonge directement le travail mené en classe depuis le début de la période.

## Informations pratiques

| Rubrique | Détail |
|---|---|
| Date | [Date de la sortie] |
| Départ | [Heure de départ] devant l'école |
| Retour prévu | [Heure de retour] devant l'école |
| Transport | autocar |
| Repas | pique-nique fourni par la famille |
| Coût | [Montant] € par élève, [pris en charge par la coopérative scolaire ou demandé aux familles] |
| Encadrement | l'enseignant et [Nombre] parents accompagnateurs |

> Important : cette sortie dépassant les horaires habituels de la classe, la participation de votre enfant nécessite votre autorisation écrite. Merci de retourner le coupon ci-dessous avant le [Date limite].

## À prévoir pour la journée

- un sac à dos avec le pique-nique et une gourde (pas de bouteille en verre) ;
- des vêtements adaptés à la météo et des chaussures confortables ;
- si votre enfant bénéficie d'un projet d'accueil individualisé (PAI), son traitement nous accompagnera : merci de vérifier la date de validité des médicaments.

## Parents accompagnateurs

Nous recherchons [Nombre] parents pour encadrer les groupes, sous réserve de l'accord de la direction de l'école. Si vous êtes disponible, merci de l'indiquer sur le coupon ; je vous recontacterai pour confirmer votre participation.

Je reste à votre disposition pour toute question, par le cahier de liaison ou à l'adresse [Adresse électronique de l'école].

Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.

[Prénom et nom de l'enseignant]

---

## Coupon-réponse à retourner avant le [Date limite]

Je soussigné(e) [Nom et prénom du responsable légal], responsable légal(e) de l'élève [Nom de l'élève], en classe de CM1 :

- [ ] autorise mon enfant à participer à la sortie au muséum le [Date de la sortie] ;
- [ ] n'autorise pas mon enfant à participer à cette sortie ;
- [ ] suis disponible pour accompagner la classe.

Téléphone joignable le jour de la sortie : [Numéro de téléphone]

Date et signature : [Date], [Signature]
`,
};

const LETTRE_SUPERIEUR: DemoExample = {
  subject: "Organisation de l'examen et du dossier de l'UE",
  level: "Master 1 — Systèmes d'information (message aux étudiants)",
  markdown: `
# Message aux étudiants — Évaluations de l'UE « Gouvernance des systèmes d'information »

**Objet :** modalités de l'examen terminal et du dossier d'étude de cas

Bonjour à toutes et à tous,

Les enseignements de l'UE arrivent à leur terme. Ce message rassemble les informations utiles pour les deux évaluations : merci de le lire attentivement et de le conserver.

## 1. Calendrier

| Évaluation | Date | Modalité | Poids |
|---|---|---|---|
| Dossier d'étude de cas, en binôme | dépôt avant le [Date] à [Heure] | sur l'espace de cours en ligne, au format PDF | 40 % |
| Examen terminal | [Date], de [Heure] à [Heure] | écrit de 2 heures, salle [Numéro de salle] | 60 % |

## 2. Consignes pour le dossier

- **Longueur :** 12 pages au maximum hors annexes, police de 11 ou 12 points.
- **Nom du fichier :** NOM1_NOM2_Dossier.pdf.
- **Structure attendue :** diagnostic de la situation, référentiels mobilisés et appliqués au cas, recommandations hiérarchisées, plan de mise en œuvre.
- **Sources :** toute source doit être citée, et toute citation placée entre guillemets. L'usage d'un outil d'intelligence artificielle générative doit être signalé en annexe, conformément à la charte de la formation.
- **Retard :** les pénalités prévues par le règlement des études de la formation s'appliquent, sauf justificatif transmis à la scolarité.

> Rappel : le plagiat, même partiel, constitue une fraude susceptible d'entraîner des poursuites disciplinaires.

## 3. Examen terminal

- Documents et appareils connectés non autorisés ; carte d'étudiant obligatoire.
- Programme : ensemble des séances de CM et des cas étudiés en TD.
- Structure : une question de cours (6 points) et une étude de cas courte (14 points).
- Présentez-vous 15 minutes avant le début de l'épreuve.

## 4. Aménagements

Si vous bénéficiez d'un aménagement d'examen (temps majoré, salle particulière, matériel adapté), vérifiez auprès de la scolarité que la décision a bien été transmise avant le [Date limite].

## 5. Questions et permanences

- Permanence : [Jour], de [Heure] à [Heure], bureau [Numéro de bureau].
- Forum de l'UE sur l'espace de cours : je réponds sous 48 heures ouvrées. Les questions d'intérêt général y sont préférables aux messages individuels, pour que la réponse profite à tous.

Bon courage pour cette dernière ligne droite,

[Prénom Nom], [fonction, par exemple : maître de conférences, responsable de l'UE] — [adresse électronique institutionnelle]
`,
};

// ─── Cahier journal / Planning de séances ────────────────────────────────────

const CAHIER_JOURNAL_SCOLAIRE: DemoExample = {
  subject: 'Journée de classe détaillée',
  level: 'CE1 — Cahier journal',
  markdown: `
# Cahier journal — CE1, [Jour] [Date]

> Période 3, semaine [Numéro]. Effectif : [Nombre] élèves. Horaires : 8 h 30 – 11 h 30 et 13 h 30 – 16 h 30.

## Matinée

| Horaire | Domaine | Objectif | Déroulement | Matériel |
|---|---|---|---|---|
| 8 h 30 – 8 h 45 | Rituels | Se repérer dans le temps | Date du jour, appel, présentation du programme de la journée | Calendrier, emploi du temps affiché |
| 8 h 45 – 9 h 30 | Français, lecture | Comprendre un texte narratif | Lecture silencieuse du chapitre 4 de l'album étudié, questions de compréhension à l'oral, relecture à voix haute en petits groupes | Album, fiche de questions |
| 9 h 30 – 10 h 00 | Français, étude de la langue | Marquer le pluriel du nom | Tri de groupes nominaux (un chat, des chats), formulation de la règle, exercice d'application | Étiquettes, cahier d'exercices |
| 10 h 00 – 10 h 15 | Récréation | | | |
| 10 h 15 – 10 h 30 | Calcul mental | Compléments à 10 et à 100 | Questions flash sur ardoise : 7 + … = 10 ; 60 + … = 100 | Ardoises |
| 10 h 30 – 11 h 15 | Mathématiques | Soustraction posée avec retenue | Manipulation avec le matériel de numération, puis calcul posé de 52 − 27 = 25 ; entraînement différencié | Barres de dix et cubes, fiche d'exercices |
| 11 h 15 – 11 h 30 | Écriture | Copier un texte court sans erreur | Copie de la poésie de la semaine en écriture cursive | Cahier de poésie |

## Après-midi

| Horaire | Domaine | Objectif | Déroulement | Matériel |
|---|---|---|---|---|
| 13 h 30 – 13 h 45 | Lecture offerte | Écouter et apprécier un texte | Lecture d'un conte par l'enseignant, bref échange sur les personnages | Recueil de contes |
| 13 h 45 – 14 h 30 | Questionner le monde | Identifier les besoins des végétaux | Observation des plantations de la semaine précédente (avec et sans lumière), mesure et relevé de la taille des pousses | Plantations, règles, tableau de relevés |
| 14 h 30 – 15 h 15 | EPS | Lancer loin et avec précision | Ateliers de lancers (balles, anneaux), mesure des distances atteintes | Balles, cerceaux, plots |
| 15 h 15 – 15 h 30 | Récréation | | | |
| 15 h 30 – 16 h 00 | Anglais | Se présenter | Comptine, puis jeu de rôle : « What's your name? », « My name is… » | Cartes-personnages |
| 16 h 00 – 16 h 30 | Bilan | Verbaliser ce qui a été appris | Chaque élève cite une chose apprise ; lecture à préparer notée dans le cahier de liaison | Cahier de liaison |

## Différenciation prévue

- **Mathématiques** : le groupe de [Prénoms] garde le matériel de numération jusqu'à la fin de la séance ; le groupe de [Prénoms] passe aux soustractions de nombres à trois chiffres.
- **Lecture** : questions à choix multiples pour [Prénoms] ; question d'inférence supplémentaire pour les lecteurs les plus à l'aise.

## Bilan de la journée (à compléter)

| Séance | Ce qui a fonctionné | À reprendre |
|---|---|---|
| Lecture | … | … |
| Soustraction posée | … | … |
| EPS | … | … |

> Élèves à revoir demain : [Prénoms], sur la notion de retenue.
`,
};

const CAHIER_JOURNAL_SUPERIEUR: DemoExample = {
  subject: "Planning d'une journée d'enseignement",
  level: 'Licence 1 — Économie-Gestion (planning de séances)',
  markdown: `
# Planning de séances — [Jour] [Date]

> Journée type d'un enseignant intervenant en Licence 1 Économie-Gestion : un cours magistral, deux TD, une permanence et une réunion d'équipe pédagogique.

## Déroulé de la journée

| Horaire | Activité | Public et lieu | Contenu | Préparation |
|---|---|---|---|---|
| 8 h 00 – 9 h 30 | CM 5 : élasticités et surplus | promotion de L1 (environ 250 étudiants), amphithéâtre [Nom] | élasticité-prix, surplus du consommateur et du producteur | diaporama vérifié, trois questions interactives, micro testé |
| 9 h 45 – 11 h 15 | TD 4, groupe A | 35 étudiants, salle [Numéro] | équilibre de marché et taxe (fiche de séance du TD 4) | énoncés imprimés, tickets de sortie |
| 11 h 30 – 13 h 00 | TD 4, groupe B | 35 étudiants, salle [Numéro] | même TD, ajusté d'après les difficultés du groupe A | relecture des tickets du groupe A |
| 13 h 00 – 14 h 00 | Pause déjeuner | | | |
| 14 h 00 – 15 h 00 | Permanence | bureau [Numéro] ou visioconférence | questions sur le CM, suivi des étudiants repérés en difficulté | liste des étudiants à relancer |
| 15 h 15 – 16 h 30 | Réunion d'équipe pédagogique | salle de réunion | harmonisation du corrigé du partiel, calendrier des contrôles continus | grille d'harmonisation |
| 16 h 30 – 18 h 00 | Correction | bureau | 35 copies de contrôle continu, environ 2 min 30 par copie | barème et commentaires types |

## Décompte du service

Selon les règles usuelles de décompte (1 h de CM = 1,5 h équivalent TD ; 1 h de TD = 1 h équivalent TD) :

| Activité | Heures présentielles | Heures équivalent TD |
|---|---|---|
| CM | 1,5 | 2,25 |
| TD (deux groupes) | 3 | 3 |
| **Total** | **4,5** | **5,25** |

La permanence, la réunion et les corrections relèvent des obligations liées au service et ne sont pas comptées ici.

## Points d'attention

- Prévoir 15 minutes entre l'amphithéâtre et la salle de TD pour le déplacement et l'installation.
- Noter, après le groupe A, les questions qui ont posé problème afin d'adapter les relances pour le groupe B.
- Vérifier que les étudiants bénéficiant d'aménagements disposent des supports adaptés.

## Après la journée

1. Publier le diaporama du CM et le corrigé du TD 4 sur l'espace de cours.
2. Répondre aux questions déposées sur le forum de l'UE.
3. Consigner les ajustements à apporter pour l'année suivante.
`,
};

// ─── Corrigé annoté / Correction de copie ────────────────────────────────────

const CORRIGE_SCOLAIRE: DemoExample = {
  subject: "Rédaction : une péripétie de récit d'aventure",
  level: '5e — Français',
  markdown: `
# Corrigé annoté — Rédaction : une tempête en mer

**Consigne donnée à la classe :** « Tu es à bord d'un navire pris dans une tempête. Raconte la scène en une quinzaine de lignes, au passé simple et à l'imparfait, en employant au moins trois mots du vocabulaire de la mer. »

## Texte de l'élève (transcrit sans correction)

> Ce jour la, le ciel devint noir d'un coup. Les vagues frappait la coque et le bateau penchait dangereusement. Le capitaine cria : « Tout le monde sur le pont ! ». Nous somme monté en courant, j'avais très peur. Un matelot glissa et tomba prés du mât, je l'ai aidé a se relever. La pluie tombait si fort qu'on voyait plus rien. Soudain une énorme vague arriva sur nous, le bateau se couchat sur le côté. J'ai crue que nous allions couler. Puis le vent se calma petit a petit et le soleil revint. Nous étions sauvé.

## Points forts

- Le récit est bien construit : situation initiale, montée du danger, point culminant, résolution.
- Le vocabulaire de la mer est présent et juste : coque, pont, matelot, mât, capitaine.
- L'alternance imparfait (description) et passé simple (actions) est souvent réussie.
- Le discours direct est correctement introduit par deux points et des guillemets ; seule la ponctuation finale est à revoir.

## Erreurs relevées

| Code | Écrit par l'élève | Correction | Règle |
|---|---|---|---|
| ORT | Ce jour la | Ce jour-là | « là » se rattache au nom par un trait d'union après « ce » |
| ACC | Les vagues frappait | Les vagues frappaient | le verbe s'accorde avec son sujet pluriel |
| PONCT | « Tout le monde sur le pont ! ». | « Tout le monde sur le pont ! » | pas de point final après une réplique terminée par un point d'exclamation |
| CONJ | Nous somme monté | Nous montâmes | passé simple attendu ; terminaison -âmes avec « nous » |
| ORT | prés du mât | près du mât | « près » (proximité) ne s'écrit pas comme « pré » (prairie) |
| CONJ | je l'ai aidé a se relever | je l'aidai à se relever | passé simple ; « à » préposition prend un accent |
| SYN | on voyait plus rien | on ne voyait plus rien | la négation comporte deux éléments |
| CONJ | se couchat | se coucha | passé simple des verbes en -er : -a à la 3e personne du singulier |
| CONJ | J'ai crue | Je crus | passé simple du verbe croire |
| ORT | petit a petit | petit à petit | « à » préposition |
| ACC | Nous étions sauvé | Nous étions sauvés | le participe employé avec « être » s'accorde avec le sujet |

## Évaluation

| Critère | Barème | Points obtenus |
|---|---|---|
| Respect de la consigne (situation, longueur, première personne) | 4 | 3,5 |
| Organisation du récit et connecteurs | 4 | 3,5 |
| Vocabulaire de la mer et expression des émotions | 4 | 3 |
| Emploi des temps du récit | 4 | 1,5 |
| Orthographe et accords | 4 | 1,5 |
| **Total** | **20** | **13/20** |

> Appréciation : un récit vivant et bien construit, qui fait ressentir le danger. Le texte est un peu court : développe davantage tes émotions et les sensations (bruit du vent, froid de l'eau). Tes principales difficultés concernent le passé simple et les accords : ce sont elles qu'il faut travailler en priorité.

## Pour progresser

1. Relire trois fois : une fois pour les verbes (temps et accords), une fois pour les homophones (a / à, la / là), une fois pour la ponctuation.
2. Revoir le passé simple des verbes en -er et de quelques verbes fréquents (croire, voir, faire, prendre).
3. Réécrire les deux phrases suivantes en les corrigeant : « Nous somme monté en courant » et « J'ai crue que nous allions couler ».
`,
};

const CORRIGE_SUPERIEUR: DemoExample = {
  subject: 'Politique monétaire et inflation',
  level: 'Licence 2 — Économie (correction de copie)',
  markdown: `
# Correction de copie — Politique monétaire et inflation

**Question posée (partiel, 8 points) :** « Expliquez par quels mécanismes une hausse des taux directeurs de la banque centrale peut contribuer à réduire l'inflation. »

## Réponse de l'étudiant (transcrite sans correction)

> L'inflation c'est quand tous les prix augmentent. Pour la combattre, la BCE augmente ses taux directeurs, ce qui augmente la masse monétaire en circulation. Les banques prêtent plus cher donc les ménages empruntent moins et consomment moins, alors les entreprises baissent leurs prix. L'objectif de la BCE est d'avoir une inflation nulle, c'est pour ça qu'elle a monté ses taux fortement ces dernières années. En conclusion la hausse des taux est toujours efficace contre l'inflation.

## Annotations

| Passage | Commentaire | Nature |
|---|---|---|
| « quand tous les prix augmentent » | Définition imprécise : l'inflation est une hausse générale et durable du niveau général des prix ; certains prix peuvent baisser pendant ce temps. | imprécision |
| « ce qui augmente la masse monétaire » | Contresens : la hausse des taux renchérit le refinancement des banques et freine la distribution de crédit, donc ralentit la création monétaire. | erreur majeure |
| « les ménages empruntent moins et consomment moins » | Mécanisme juste (canal du crédit), mais incomplet : l'investissement des entreprises est aussi freiné. | à compléter |
| « les entreprises baissent leurs prix » | Formulation excessive : le ralentissement de la demande réduit surtout le rythme de hausse des prix (désinflation), sans baisse générale. | nuance attendue |
| « une inflation nulle » | Erreur : la BCE vise une inflation de 2 % à moyen terme, objectif symétrique. | erreur factuelle |
| « toujours efficace » | Généralisation abusive : les effets sont décalés dans le temps et moins directs face à une inflation d'origine énergétique. | nuance attendue |

## Barème

| Critère | Points | Obtenu |
|---|---|---|
| Définition rigoureuse de l'inflation | 1 | 0,5 |
| Canal du crédit : coût du refinancement, taux des crédits, demande | 3 | 2 |
| Autres canaux : anticipations, taux de change, prix des actifs | 2 | 0 |
| Mandat de la banque centrale | 1 | 0 |
| Limites et nuances | 1 | 0 |
| **Total** | **8** | **2,5** |

Note : 2,5/8, soit 6,25/20.

## Éléments de réponse attendus

1. La hausse des taux directeurs renchérit le refinancement des banques, qui relèvent les taux de leurs crédits.
2. Le crédit devient plus coûteux : la consommation à crédit et l'investissement ralentissent, la demande globale se modère et les tensions sur les prix diminuent.
3. D'autres canaux renforcent cet effet : ancrage des anticipations d'inflation, appréciation de la monnaie qui réduit le prix des importations, baisse du prix des actifs qui limite les effets de richesse.
4. Ces effets se manifestent avec un décalage, souvent estimé à un ou deux ans, et comportent un risque de ralentissement de l'activité.

> Commentaire à l'étudiant : vous avez identifié le mécanisme central du crédit, ce qui constitue une bonne base. En revanche, l'affirmation selon laquelle la hausse des taux augmente la masse monétaire est un contresens à corriger impérativement. Pour le prochain partiel, structurez votre réponse en canaux de transmission et terminez par les limites de la politique monétaire.
`,
};

// ─── Table des exemples ──────────────────────────────────────────────────────

export const DEMO_CONTENT: Record<TypeContenu, { scolaire: DemoExample; superieur?: DemoExample }> = {
  cours: { scolaire: COURS_SCOLAIRE, superieur: COURS_SUPERIEUR },
  exercices: { scolaire: EXERCICES_SCOLAIRE, superieur: EXERCICES_SUPERIEUR },
  evaluation: { scolaire: EVALUATION_SCOLAIRE, superieur: EVALUATION_SUPERIEUR },
  sequence: { scolaire: SEQUENCE_SCOLAIRE, superieur: SEQUENCE_SUPERIEUR },
  fiche_prep: { scolaire: FICHE_PREP_SCOLAIRE, superieur: FICHE_PREP_SUPERIEUR },
  progression: { scolaire: PROGRESSION_SCOLAIRE, superieur: PROGRESSION_SUPERIEUR },
  appreciations: { scolaire: APPRECIATIONS_SCOLAIRE, superieur: APPRECIATIONS_SUPERIEUR },
  differenciation: { scolaire: DIFFERENCIATION_SCOLAIRE, superieur: DIFFERENCIATION_SUPERIEUR },
  lettre_parents: { scolaire: LETTRE_SCOLAIRE, superieur: LETTRE_SUPERIEUR },
  cahier_journal: { scolaire: CAHIER_JOURNAL_SCOLAIRE, superieur: CAHIER_JOURNAL_SUPERIEUR },
  corrige: { scolaire: CORRIGE_SCOLAIRE, superieur: CORRIGE_SUPERIEUR },
};
