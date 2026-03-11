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

INSTRUCTIONS SPÉCIFIQUES POUR LA GÉNÉRATION DE COURS :
- Commence par un titre clair et le niveau/matière
- Inclus les objectifs pédagogiques (ce que l'élève saura faire à la fin)
- Structure le cours en parties et sous-parties logiques
- Intègre des définitions encadrées, des exemples concrets et des illustrations textuelles
- Ajoute des "Points clés à retenir" en fin de chaque partie
- Termine par un résumé et une ouverture
- Indique la durée estimée
- Si c'est pour la maternelle ou le primaire, utilise un langage simple et ludique`,

    exercices: `${base}

INSTRUCTIONS SPÉCIFIQUES POUR LA GÉNÉRATION D'EXERCICES :
- Propose entre 5 et 10 exercices progressifs (du plus simple au plus complexe)
- Pour chaque exercice : numéro, consigne claire, espace pour la réponse
- Inclus des exercices de types variés (QCM, vrai/faux, rédaction, calcul, analyse, etc.)
- Ajoute un encadré "Coup de pouce" pour les élèves en difficulté
- Propose un "Exercice défi" pour les élèves avancés
- Fournis le corrigé complet à la fin, séparé clairement
- Adapte la difficulté au niveau scolaire`,

    evaluation: `${base}

INSTRUCTIONS SPÉCIFIQUES POUR LA GÉNÉRATION D'ÉVALUATIONS :
- Commence par un en-tête formel (nom de l'établissement : à compléter, date, durée, matière, niveau)
- Indique clairement le barème (/20 ou autre)
- Structure en parties avec points attribués
- Mélange les types de questions (restitution, compréhension, analyse, synthèse)
- Inclus les compétences évaluées pour chaque partie
- Fournis le corrigé détaillé avec le barème point par point
- Ajoute des critères de notation pour les questions ouvertes`,

    sequence: `${base}

INSTRUCTIONS SPÉCIFIQUES POUR LA GÉNÉRATION DE SÉQUENCES PÉDAGOGIQUES :
- Définis le fil conducteur et la problématique de la séquence
- Liste les objectifs de la séquence (savoirs, savoir-faire, compétences)
- Découpe en séances (3 à 6 séances selon le sujet)
- Pour chaque séance : titre, durée, objectif, déroulé détaillé, supports, activités élèves
- Inclus les modalités pédagogiques (travail individuel, en groupe, magistral)
- Prévois une évaluation diagnostique, formative et sommative
- Intègre la différenciation pédagogique
- Propose des prolongements et des liens interdisciplinaires`,

    fiche_prep: `${base}

INSTRUCTIONS SPÉCIFIQUES POUR LA FICHE DE PRÉPARATION :
- En-tête complet : niveau, matière, titre, durée, place dans la séquence
- Objectif précis avec verbe d'action
- Compétences du programme officiel
- Matériel nécessaire
- Déroulement en tableau minuté (phase, durée, activité enseignant, activité élève, modalité)
- Différenciation pour élèves en difficulté ET avancés
- Critères d'évaluation observables
- Trace écrite prévue
- Pour la maternelle : insister sur ateliers, manipulation, regroupements`,
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
