import type { GenerationRequest, TypeContenu, NiveauScolaire } from '@/types';
import { getNiveauLabel, getMatiereLabel, TYPE_CONTENU } from '@/types';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

function buildSystemPrompt(type: TypeContenu, niveau: NiveauScolaire): string {
  const niveauLabel = getNiveauLabel(niveau);
  
  const base = `Tu es Magistra, un assistant pédagogique IA expert du système éducatif français.
Tu connais parfaitement les programmes officiels de l'Éducation nationale.
Tu produis du contenu pédagogique de haute qualité, structuré, clair et directement exploitable par un enseignant.
Tu adaptes toujours le vocabulaire, la complexité et la longueur au niveau scolaire indiqué (${niveauLabel}).
Tu utilises le format Markdown pour structurer le contenu.
Tu es bienveillant, professionnel et rigoureux.`;

  const typeInstructions: Partial<Record<TypeContenu, string>> = {
    cours: `${base}

GÉNÉRATION DE COURS — Structure obligatoire :
1. En-tête : Titre, niveau, matière, durée, place dans la progression
2. Objectifs : Ce que l'élève saura faire (verbes d'action)
3. Compétences visées : Référence au programme officiel
4. Prérequis
5. Déroulé structuré : accroche (5-10 min), découverte (20-25 min), pratique (15-20 min), synthèse (5-10 min)
6. Encadrés : Définitions, "À retenir", "Attention piège"
7. Trace écrite
8. Prolongement vers la séance suivante`,

    exercices: `${base}

GÉNÉRATION D'EXERCICES — Structure obligatoire :
1. En-tête : Matière, niveau, thème, compétences travaillées
2. 8 à 12 exercices progressifs (facile → expert) de types variés (QCM, vrai/faux, rédaction, calcul, analyse)
3. 💡 "Coup de pouce" après les exercices difficiles
4. 🚀 "Défi" pour les élèves avancés
5. ♿ Adaptations possibles
6. Corrigé complet séparé avec explication de la démarche
7. Barème indicatif`,

    evaluation: `${base}

GÉNÉRATION D'ÉVALUATION — Structure obligatoire :
1. En-tête formel (établissement, nom, classe, date, durée, note /20)
2. Consignes générales (matériel autorisé, barème)
3. 3-4 parties : Connaissances → Compréhension → Application → Synthèse
4. Compétences évaluées mentionnées pour chaque partie
5. Corrigé détaillé avec barème point par point et critères pour questions ouvertes`,

    sequence: `${base}

GÉNÉRATION DE SÉQUENCE PÉDAGOGIQUE — Structure obligatoire :
1. Fiche de séquence : titre, problématique, objectifs, évaluation diagnostique
2. Tableau synoptique des séances
3. Détail de 4-6 séances : objectif, déroulé minuté, supports, différenciation, évaluation formative
4. Séance d'évaluation sommative
5. Prolongements interdisciplinaires`,

    fiche_prep: `${base}

GÉNÉRATION DE FICHE DE PRÉPARATION — Structure obligatoire :
1. En-tête : niveau, matière, titre, durée, place dans la séquence
2. Objectif précis avec verbe d'action
3. Compétences du programme officiel
4. Matériel nécessaire
5. Déroulement en tableau minuté : phase / durée / activité enseignant / activité élève / modalité / matériel
6. Différenciation pour élèves en difficulté ET avancés
7. Critères d'évaluation observables
8. Trace écrite
9. Bilan / Remarques post-séance`,

    appreciations: `${base}

GÉNÉRATION D'APPRÉCIATIONS DE BULLETINS SCOLAIRES :
- Génère le nombre d'appréciations demandé pour le profil indiqué
- Chaque appréciation : 2-3 phrases, commence par un point positif, mentionne les compétences, donne un conseil concret
- Ton professionnel et encourageant, évite les formules bateaux
- Numérote chaque appréciation
Profils : excellent → félicitations + approfondissement | bon → valoriser + piste d'amélioration | moyen → encourager + pistes concrètes | fragile → bienveillant + progrès minimes | décrocheur → alerter sans décourager`,

    progression: `${base}

GÉNÉRATION DE PROGRESSION ANNUELLE — Structure obligatoire :
1. En-tête : matière, niveau, heures annuelles estimées
2. Tableau en 5-6 périodes (entre chaque vacances) : période / semaines / thème / notions clés / compétences / évaluation prévue
3. Pour chaque période : 4-6 séquences/chapitres détaillés
4. Repères de progressivité
5. Liens interdisciplinaires et projets envisageables
6. Conforme au programme officiel du Bulletin Officiel`,

    differenciation: `${base}

GÉNÉRATION DE CONTENU DIFFÉRENCIÉ :
À partir du sujet fourni, produis les versions demandées parmi :
- Version "dys" — Accompagnement renforcé (DYS, allophones, ULIS) : consignes simplifiées et découpées, aides visuelles, vocabulaire adapté, QCM/texte à trous, quantité réduite, mêmes compétences
- Version "standard" : contenu de base donné à la classe entière
- Version "hpi" — Approfondissement (HPI, élèves avancés) : transfert, analyse, questions ouvertes, liens interdisciplinaires, défi/problème complexe
Chaque version travaille les MÊMES compétences, seul le chemin change.`,

    lettre_parents: `${base}

GÉNÉRATION DE COURRIER AUX PARENTS / RESPONSABLES LÉGAUX — Structure obligatoire :
1. En-tête : établissement, ville, date
2. Objet clair et factuel
3. Corps : formule d'appel, exposé factuel sans jugement, propositions concrètes, ouverture au dialogue, formule de politesse
4. Signature : nom de l'enseignant, fonction
Ton : TOUJOURS professionnel, factuel et bienveillant. Jamais accusateur.`,

    cahier_journal: `${base}

GÉNÉRATION DE CAHIER JOURNAL — Structure obligatoire :
Tableau horaire complet : Horaire / Domaine-Matière / Intitulé de la séance / Objectif / Déroulement résumé / Matériel / Modalité
- Respecter les horaires officiels selon le niveau (maternelle : accueil/regroupement/ateliers ; élémentaire : ~2h30 français, ~1h maths, récréations 15 min matin + 15 min AM)
- Inclure pour chaque créneau : objectif précis, déroulement en 1-2 phrases, matériel, modalité`,

    corrige: `${base}

CORRECTION ET ANNOTATION D'UN TRAVAIL D'ÉLÈVE — Structure obligatoire :
1. Analyse globale (2-3 phrases) : impression générale, niveau de maîtrise
2. Points positifs (toujours commencer par ça)
3. Erreurs identifiées avec catégories : contenu, méthode, langue, présentation
4. Pour chaque erreur : citation du passage, explication, correction proposée, règle à revoir
5. Conseils de progression : 3 axes prioritaires
6. Note indicative sur 20 avec justification du barème
7. Appréciation finale (2 phrases, bienveillant + exigeant)`,
  };

  return typeInstructions[type] ?? base;
}

function buildUserPrompt(request: GenerationRequest): string {
  const niveau = getNiveauLabel(request.niveau);
  const matiere = getMatiereLabel(request.matiere);
  
  let prompt = `Génère un contenu de type "${request.type}" pour le niveau ${niveau} en ${matiere}.

**Sujet :** ${request.sujet}`;

  if (request.duree) {
    prompt += `\n**Durée :** ${request.duree}`;
  }
  if (request.objectifs) {
    prompt += `\n**Objectifs pédagogiques :** ${request.objectifs}`;
  }
  if (request.difficulte) {
    const diffLabels = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile', differencie: 'Différencié (plusieurs niveaux)' };
    prompt += `\n**Niveau de difficulté :** ${diffLabels[request.difficulte]}`;
  }
  if (request.trimestre) {
    prompt += `\n**Trimestre :** ${request.trimestre}`;
  }
  if (request.profilsEleves) {
    prompt += `\n**Profil des élèves :** ${request.profilsEleves}`;
  }
  if (request.nombreEleves) {
    prompt += `\n**Nombre d'appréciations à générer :** ${request.nombreEleves}`;
  }
  if (request.typeLettre) {
    const lettreLabels: Record<string, string> = {
      comportement: 'Signalement de comportement',
      absence: 'Absences répétées',
      felicitations: 'Félicitations',
      reunion: 'Convocation réunion',
      incident: "Signalement d'incident",
      orientation: 'Information orientation',
    };
    prompt += `\n**Type de courrier :** ${lettreLabels[request.typeLettre] ?? request.typeLettre}`;
  }
  if (request.texteEleve) {
    prompt += `\n\n**Travail de l'élève à corriger :**\n\`\`\`\n${request.texteEleve}\n\`\`\``;
  }
  if (request.consignesSupplementaires) {
    prompt += `\n**Consignes supplémentaires :** ${request.consignesSupplementaires}`;
  }

  prompt += `\n\nProduis le contenu complet, structuré en Markdown, prêt à l'emploi. Sois exhaustif et professionnel.`;

  return prompt;
}

export async function generateContent(
  request: GenerationRequest,
  apiKey: string,
  onStream?: (chunk: string) => void
): Promise<string> {
  const systemPrompt = buildSystemPrompt(request.type, request.niveau);
  const userPrompt = buildUserPrompt(request);

  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      stream: !!onStream,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erreur API: ${response.status} — ${err}`);
  }

  if (onStream && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              fullText += parsed.delta.text;
              onStream(fullText);
            }
          } catch {
            // skip
          }
        }
      }
    }
    return fullText;
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? 'Aucun contenu généré.';
}

// Demo mode - generates realistic placeholder content without API
export function generateDemoContent(request: GenerationRequest): string {
  const niveau = getNiveauLabel(request.niveau);
  const matiere = getMatiereLabel(request.matiere);

  const demos: Partial<Record<TypeContenu, string>> = {
    cours: `# ${request.sujet}

**Niveau :** ${niveau} · **Matière :** ${matiere} · **Durée estimée :** ${request.duree || '55 minutes'}

---

## Objectifs pédagogiques

À la fin de cette séance, l'élève sera capable de :
- Comprendre les concepts fondamentaux liés à **${request.sujet}**
- Identifier et expliquer les éléments clés du sujet
- Appliquer les connaissances dans des situations concrètes

---

## I. Introduction — Contextualisation

${request.sujet} est un thème central du programme de ${matiere} en ${niveau}. Cette notion permet de comprendre des enjeux importants et de développer un regard critique sur le monde qui nous entoure.

> **💡 Point clé :** Ce cours est un exemple de démonstration. Avec votre clé API Anthropic, Magistra génèrera un vrai cours complet, structuré et adapté à vos élèves.

## II. Les concepts fondamentaux

### A. Premier concept clé

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

**Définition :**
> *Le terme désigne l'ensemble des phénomènes liés à ce domaine d'étude.*

### B. Deuxième concept clé

Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

**Exemple concret :**
Dans la vie quotidienne, on retrouve cette notion lorsque...

---

## III. Application et exemples

| Concept | Exemple | Application |
|---------|---------|-------------|
| Concept A | Exemple 1 | Situation réelle |
| Concept B | Exemple 2 | Situation réelle |
| Concept C | Exemple 3 | Situation réelle |

---

## Points clés à retenir

1. **Premier point essentiel** à maîtriser
2. **Deuxième point essentiel** pour la suite du programme
3. **Troisième point** qui fera l'objet d'un approfondissement

---

## Résumé

Ce cours a permis de découvrir les bases de ${request.sujet}. Les notions abordées seront approfondies dans les prochaines séances et feront l'objet d'exercices pratiques.

*Ce contenu est une démonstration. Connectez votre clé API pour générer du contenu pédagogique réel avec l'IA.*`,

    exercices: `# Exercices — ${request.sujet}

**Niveau :** ${niveau} · **Matière :** ${matiere}

---

## Exercice 1 — Restitution de connaissances *(2 points)*

Complétez les phrases suivantes avec les termes appropriés :

a) Le concept principal de ${request.sujet} est défini comme _______________

b) Les trois éléments fondamentaux sont : _______________, _______________ et _______________

---

## Exercice 2 — QCM *(3 points)*

Pour chaque question, cochez la bonne réponse :

**1.** Quel est l'élément central de cette notion ?
- ☐ Réponse A
- ☐ Réponse B
- ☐ Réponse C
- ☐ Réponse D

**2.** Dans quel contexte s'applique cette notion ?
- ☐ Contexte 1
- ☐ Contexte 2
- ☐ Contexte 3

---

## Exercice 3 — Application *(5 points)*

À partir du document ci-dessous, répondez aux questions :

*[Document d'exemple]*

a) Identifiez les éléments clés présents dans ce document. *(2 pts)*

b) Expliquez le lien avec la notion étudiée. *(3 pts)*

---

## 💡 Coup de pouce

> Si tu as du mal avec l'exercice 3, relis la partie II du cours et cherche les mots-clés.

## 🚀 Exercice défi

Rédigez un paragraphe argumenté de 10 lignes expliquant en quoi ${request.sujet} est pertinent dans le monde contemporain.

---

## Corrigé

### Exercice 1
a) [Réponse attendue]
b) [Éléments attendus]

### Exercice 2
1. Réponse B · 2. Réponse C

### Exercice 3
a) [Éléments de correction détaillés]
b) [Barème détaillé]

*Ce contenu est une démonstration. Connectez votre clé API pour générer de vrais exercices.*`,

    evaluation: `# Évaluation — ${request.sujet}

**Établissement :** _______________  
**Classe :** ${niveau} · **Matière :** ${matiere}  
**Date :** _______________  
**Durée :** ${request.duree || '1 heure'}  
**Barème :** /20

---

**Nom :** _______________ **Prénom :** _______________

---

## Partie 1 — Connaissances *(6 points)*

**Question 1** *(2 pts)* — Définissez le concept central de ${request.sujet}.

**Question 2** *(2 pts)* — Citez deux exemples illustrant cette notion.

**Question 3** *(2 pts)* — Vrai ou Faux ? Justifiez.
- a) Affirmation 1 : ___
- b) Affirmation 2 : ___

---

## Partie 2 — Compréhension et analyse *(8 points)*

**Question 4** *(4 pts)* — À partir du document fourni, identifiez et expliquez les éléments en lien avec le sujet.

**Question 5** *(4 pts)* — Comparez les deux situations présentées et montrez en quoi elles illustrent des aspects différents de la notion.

---

## Partie 3 — Synthèse *(6 points)*

**Question 6** *(6 pts)* — Rédigez un développement construit d'une vingtaine de lignes montrant l'importance de ${request.sujet}. Votre argumentation devra s'appuyer sur des exemples précis.

---

## Corrigé et barème détaillé

### Partie 1
- Q1 : Définition précise attendue (1pt formulation + 1pt contenu)
- Q2 : 1pt par exemple pertinent
- Q3 : 0.5pt par réponse + 0.5pt par justification

### Partie 2
- Q4 : Identification (2pts) + Explication (2pts)
- Q5 : Comparaison structurée avec au moins 2 critères

### Partie 3
Grille d'évaluation :
| Critère | Points |
|---------|--------|
| Introduction et problématique | 1 |
| Arguments pertinents | 2 |
| Exemples précis | 2 |
| Conclusion | 1 |

*Contenu de démonstration — Connectez votre clé API Anthropic pour générer une vraie évaluation.*`,

    sequence: `# Séquence pédagogique — ${request.sujet}

**Niveau :** ${niveau} · **Matière :** ${matiere}  
**Durée totale :** ${request.duree || '4 séances de 55 minutes'}

---

## Fil conducteur

**Problématique :** En quoi ${request.sujet} constitue-t-il un enjeu majeur ?

## Objectifs de la séquence

**Savoirs :** Connaître les notions clés de ${request.sujet}
**Savoir-faire :** Analyser, comparer, argumenter
**Compétences :** Esprit critique, travail collaboratif, expression écrite

---

## Séance 1 — Découverte *(55 min)*

| Phase | Durée | Activité | Modalité |
|-------|--------|----------|----------|
| Accroche | 10 min | Document déclencheur + questionnement | Collectif |
| Découverte | 20 min | Analyse de documents en groupe | Groupe (3-4) |
| Mise en commun | 15 min | Synthèse au tableau | Collectif |
| Trace écrite | 10 min | Copie du cours | Individuel |

**Supports :** Document iconographique, texte source

---

## Séance 2 — Approfondissement *(55 min)*

| Phase | Durée | Activité | Modalité |
|-------|--------|----------|----------|
| Rappel | 5 min | Quiz oral | Collectif |
| Cours dialogué | 25 min | Notions clés + exemples | Collectif |
| Exercices | 20 min | Application directe | Individuel |
| Correction | 5 min | Correction rapide | Collectif |

---

## Séance 3 — Mise en pratique *(55 min)*

**Activité différenciée :**
- 🟢 Groupe 1 (accompagnement) : exercices guidés avec fiches d'aide
- 🟡 Groupe 2 (autonomie) : exercices standards
- 🔴 Groupe 3 (approfondissement) : exercice complexe + recherche

---

## Séance 4 — Évaluation *(55 min)*

Évaluation sommative sur l'ensemble de la séquence (voir évaluation générée séparément).

---

## Prolongements possibles

- Lien avec [matière interdisciplinaire]
- Projet de classe
- Sortie pédagogique

*Ce contenu est une démonstration. Connectez votre clé API pour générer une vraie séquence.*`,

    fiche_prep: `# Fiche de préparation — ${request.sujet}

**Niveau :** ${niveau} · **Matière :** ${matiere}  
**Durée :** ${request.duree || '45 minutes'} · **Date :** _______________

---

## Objectif de la séance

À la fin de la séance, l'élève sera capable de comprendre et appliquer les notions fondamentales liées à ${request.sujet}.

## Compétences visées

- Compétence 1 du programme officiel
- Compétence 2 du socle commun

## Matériel

- Manuel p. ___
- Fiche élève photocopiée
- Tableau / vidéoprojecteur

## Prérequis

Les élèves doivent déjà maîtriser les bases de la notion précédente dans la progression.

---

## Déroulement

| Phase | Durée | Activité enseignant | Activité élève | Modalité |
|-------|-------|-------------------|----------------|----------|
| Mise en route | 5 min | Rappel de la séance précédente, question ouverte | Répondent, participent | Collectif |
| Découverte | 15 min | Présentation du document, guidage | Observent, questionnent, manipulent | Collectif |
| Recherche | 10 min | Circule, aide, différencie | Travaillent sur la fiche | Individuel/Binôme |
| Mise en commun | 10 min | Anime la correction, fait verbaliser | Proposent leurs réponses, comparent | Collectif |
| Trace écrite | 5 min | Dicte/affiche la leçon | Copient dans le cahier | Individuel |

## Différenciation

- 💡 **Élèves en difficulté :** fiche simplifiée, aide de l'enseignant, travail en binôme tutoré
- 🚀 **Élèves avancés :** exercice supplémentaire, rôle de tuteur, approfondissement

## Évaluation

Observation directe pendant la phase de recherche. Critère de réussite : [à compléter].

## Trace écrite

[Contenu de la leçon à coller/copier dans le cahier]

## Bilan / Remarques post-séance

_Espace réservé aux notes après la séance :_

---

*Ce contenu est une démonstration. Connectez-vous pour générer une vraie fiche de préparation.*`,
  };

  return demos[request.type] ?? `# ${TYPE_CONTENU.find(t => t.value === request.type)?.label ?? request.type}

**Niveau :** ${niveau} · **Matière :** ${matiere}

---

Ce type de contenu sera généré par l'IA lorsque vous connecterez votre clé API ou que le backend sera actif.

*Mode démonstration — Connectez-vous pour accéder à la génération IA complète.*`;
}
