// Content script sur /settings/linkedin de l'app Jay Reach. Reçoit le jeton
// d'extension publié par la page (window.postMessage) et l'enregistre dans le
// stockage de l'extension. Voie fiable en dev (sans ID d'extension stable) ;
// en production, externally_connectable prend le relais côté background.

(function () {
  // Origines autorisees a dialoguer avec l'extension. Elles doivent rester
  // alignees sur `externally_connectable` et sur les `matches` du manifeste :
  // une origine ajoutee ici mais absente la-bas ne verrait jamais ce script
  // s'injecter, et l'ecran afficherait « l'extension n'a pas repondu » sans
  // que rien n'explique pourquoi.
  const ALLOWED = [
    'http://localhost:3000',
    'https://jay-reach.vercel.app',
    'https://app.jay-reach.fr',
  ];

  window.addEventListener('message', (event) => {
    if (!ALLOWED.includes(event.origin)) return;
    const msg = event.data;
    if (!msg || msg.type !== 'JAY_REACH_LINKEDIN_TOKEN' || typeof msg.token !== 'string') return;

    const patch = { extensionToken: msg.token, appBaseUrl: event.origin };
    chrome.storage.local.set(patch, () => {
      window.postMessage({ type: 'JAY_REACH_LINKEDIN_TOKEN_SAVED', success: true }, event.origin);
      // Le background lit le profil LinkedIn et le remonte a l'application :
      // l'ecran peut alors dire a quel compte il est connecte. Ce script-ci ne
      // peut pas le faire lui-meme, il tourne sur l'origine de l'application et
      // non sur celle de LinkedIn.
      chrome.runtime.sendMessage({ type: 'JAY_REACH_REMONTER_PROFIL' }, () => void chrome.runtime.lastError);
    });
  });

  // Signale à la page que l'extension est présente (pour l'UI de connexion).
  // L'annonce spontanée ne suffit pas : ce script tourne à `document_start`,
  // donc avant que React ait monté son écouteur — le message se perdait, et
  // l'écran affichait « extension pas détectée » alors qu'elle l'était. La page
  // redemande donc quand elle est prête, et on lui répond.
  window.addEventListener('message', (event) => {
    if (!ALLOWED.includes(event.origin)) return;
    if (event.data?.type !== 'JAY_REACH_EXTENSION_PING') return;
    window.postMessage({ type: 'JAY_REACH_EXTENSION_PRESENT' }, event.origin);
  });
  window.postMessage({ type: 'JAY_REACH_EXTENSION_PRESENT' }, '*');
})();
