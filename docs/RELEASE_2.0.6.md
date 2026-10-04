# Magistra 2.0.6 — notes de version

- Une notification dans l’application annonce les nouvelles versions stables.
- Dans Réglages → À propos, la vérification manuelle reste disponible et les notifications peuvent être désactivées.
- Le bouton « Télécharger et installer » récupère l’installateur officiel, contrôle sa taille et son empreinte SHA-256, puis lance l’installateur Windows après confirmation. Aucun document n’est transmis pour la vérification des versions.
- Les recherches académiques sont étendues à tous les niveaux lorsque cette option est activée. Les extraits institutionnels et scientifiques sont prioritaires ; les notices sans résumé restent identifiées comme telles.

## Installation

Depuis une ancienne version, installez une première fois Magistra-Setup-2.0.6.exe pour obtenir le nouveau bouton. Enregistrez votre travail et terminez les générations en cours avant de continuer. Les données enregistrées, réglages et modèles IA sont conservés. Le mode portable peut utiliser cet installateur pour passer à une installation Windows classique.

L’installateur n’est pas signé numériquement : Windows peut afficher un avertissement. Vérifiez sa provenance et, si nécessaire, son empreinte dans SHA256SUMS.txt.

## Publication

Le code reste dans le dépôt privé. Seuls les installateurs, l’archive portable, leurs empreintes et les notices applicables doivent être distribués dans le dépôt public Magistra-Downloads. La CI produit l’artefact `magistra-distribution-windows` après validation ; sa présence ne signifie pas qu’une release publique a été publiée.
