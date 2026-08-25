// Content script sur /settings/linkedin de l'app Jay Reach. Reçoit le jeton
// d'extension publié par la page (window.postMessage) et l'enregistre dans le
// stockage de l'extension. Voie fiable en dev (sans ID d'extension stable) ;
// en production, externally_connectable prend le relais côté background.

(function () {
  const ALLOWED = ['http://localhost:3000', 'https://app.jay-reach.fr'];

  window.addEventListener('message', (event) => {
    if (!ALLOWED.includes(event.origin)) return;
    const msg = event.data;
    if (!msg || msg.type !== 'JAY_REACH_LINKEDIN_TOKEN' || typeof msg.token !== 'string') return;

    const patch = { extensionToken: msg.token, appBaseUrl: event.origin };
    chrome.storage.local.set(patch, () => {
      window.postMessage({ type: 'JAY_REACH_LINKEDIN_TOKEN_SAVED', success: true }, event.origin);
    });
  });

  // Signale à la page que l'extension est présente (pour l'UI de connexion).
  window.postMessage({ type: 'JAY_REACH_EXTENSION_PRESENT' }, '*');
})();
