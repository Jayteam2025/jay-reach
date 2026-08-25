// Popup Jay Reach — LinkedIn : affiche l'état de connexion et de pause,
// permet un poll manuel et la reprise après pause.

const $ = (id) => document.getElementById(id);

function render(status) {
  const on = !!status.configured && !status.pausedUntil;
  $('dot').classList.toggle('on', on);
  $('conn').textContent = status.configured ? 'connecté' : 'non connecté';
  $('base').textContent = status.baseUrl || '—';
  $('hint').style.display = status.configured ? 'none' : '';

  if (status.pausedUntil) {
    const mins = Math.max(0, Math.round((status.pausedUntil - Date.now()) / 60000));
    $('state').textContent = `en pause (${mins} min)`;
    $('pausedBox').style.display = 'block';
  } else {
    $('state').textContent = status.configured ? 'actif' : '—';
    $('pausedBox').style.display = 'none';
  }
}

function refresh() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
    if (status) render(status);
  });
}

$('pollBtn').addEventListener('click', () => {
  $('pollBtn').textContent = '…';
  chrome.runtime.sendMessage({ type: 'POLL_NOW' }, () => {
    $('pollBtn').textContent = 'Vérifier maintenant';
    refresh();
  });
});

$('resetBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESET_PAUSE' }, () => refresh());
});

refresh();
