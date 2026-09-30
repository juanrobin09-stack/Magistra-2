// Préchargement des tests E2E (« -r » sur la ligne de commande d'Electron, APRÈS le chargeur de Playwright) dans le
// processus principal de l'application lancée par Playwright.
//
// Le chargeur Electron de Playwright impose « --password-store=basic » (aucun trousseau du système), si bien que
// safeStorage est indisponible sous Linux et que l'application garderait les autorisations du site en mémoire
// seulement. Ce préchargement retire UNIQUEMENT ce réglage et remet celui du lancement (--password-store=… passé par
// le test) : l'application utilise alors le trousseau privé démarré par le test (gnome-keyring), comme sur le poste
// d'un enseignant (DPAPI sous Windows). Aucun autre réglage n'est touché ; le code de l'application n'est pas modifié.

'use strict';

const { app } = require('electron');

const PREFIX = '--password-store=';
const requested = process.argv.find(arg => arg.startsWith(PREFIX));
if (requested && app && app.commandLine) {
  app.commandLine.removeSwitch('password-store');
  app.commandLine.appendSwitch('password-store', requested.slice(PREFIX.length));
}
