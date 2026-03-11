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

### 3. Lancer en local

```bash
npm run dev
```

→ Ouvre http://localhost:5173

### 4. Déployer

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

Les utilisateurs saisissent leur clé API dans Réglages > Clé API Anthropic.
Sans clé API, l'app fonctionne en mode démonstration.

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

React 19 · TypeScript · Vite · Tailwind CSS v4 · Clerk · API Anthropic Claude · jsPDF · Lucide

---

Open-source — Un projet FutureAI pour l'éducation publique.
