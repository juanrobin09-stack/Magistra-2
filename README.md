# 🎓 Magistra — L'IA qui prépare vos cours à votre place

Un projet [FutureAI](https://futurai.space) · Bordeaux, France · 2026

---

## 🚀 Déploiement rapide

### 1. Cloner et installer

```bash
git clone <votre-repo>
cd magistra-app
npm install
```

### 2. Configurer Clerk (authentification)

1. Crée un compte gratuit sur [clerk.com](https://clerk.com)
2. Crée une nouvelle application
3. Copie ta **Publishable Key**
4. Crée un fichier `.env` :

```bash
cp .env.example .env
```

5. Colle ta clé dans `.env` :

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_TA_CLE_ICI
```

> **Note :** Sans clé Clerk, l'app fonctionne en mode démo (sans authentification).

### 3. Connecter une base de données Postgres

L'historique, les favoris et le suivi du quota sont stockés dans Postgres, via [Neon](https://neon.com) (intégration native Vercel — pas de compte tiers à créer séparément) :

1. Dans ton projet Vercel : onglet **Storage** → **Marketplace Database Providers** → **Neon**
2. Connecte-la à ton projet : Vercel injecte automatiquement la variable `DATABASE_URL`
3. Ouvre l'éditeur SQL de la base (ou `psql "$DATABASE_URL"`) et exécute `vercel-postgres-schema.sql`

> **Note :** Sans `DATABASE_URL`, les appels de génération échouent avec une erreur claire (« Configuration serveur manquante »).

### 4. Lancer en local

```bash
npm run dev
```

→ Ouvre http://localhost:5173

> **Note :** `npm run dev` sert uniquement le front (Vite). Les routes `/api/*` ne
> répondent pas dans ce mode — pour tester la génération réelle en local, utilise
> `vercel dev` (après `vercel env pull` pour récupérer les variables serveur).

### 5. Déployer

**Sur Vercel :**
```bash
npm i -g vercel
vercel
```

**Sur Netlify :**
```bash
npm run build
# Upload le dossier dist/ sur Netlify
```

Ajoute `VITE_CLERK_PUBLISHABLE_KEY` dans les variables d'environnement de ton hébergeur.

---

## 🔑 Clé API Anthropic

Deux façons d'utiliser Magistra, deux façons de fournir la clé Anthropic :

- **Version web (Vercel)** : la clé est côté serveur — ajoute `ANTHROPIC_API_KEY` dans
  les variables d'environnement Vercel. Tous les comptes partagent cette clé.
- **Version desktop (Electron)** : chaque utilisateur saisit sa propre clé dans
  Réglages > Clés API, stockée localement sur son poste.

Sans clé API (dans les deux cas), l'app fonctionne en mode démonstration.

---

## ✨ Fonctionnalités

- Génération IA : Cours, exercices, évaluations, séquences pédagogiques
- Tous niveaux : Maternelle (PS/MS/GS) → Université (Licence/Master)
- Toutes matières : 17 matières dont Français, Maths, Histoire-Géo, Sciences, Langues, Philo, NSI...
- Export PDF et Markdown
- Historique et favoris
- Auth Clerk (Google, email)
- RGPD compliant
- Responsive mobile/desktop
- Open-source

---

## 🛠 Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · Clerk · Postgres (Neon) · API Anthropic Claude · jsPDF · Lucide

---

Open-source — Un projet FutureAI pour l'éducation publique.
