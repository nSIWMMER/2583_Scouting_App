// ------------------------------------------------------------------
// FRC Scouting — offline-first app logic
// Data flow: form submit -> IndexedDB queue -> attempt sync when online
// ------------------------------------------------------------------

const DB_NAME = 'frc-scouting-db';
const STORE_NAME = 'queue';
const SETTINGS_KEY = 'frc-scouting-settings';

let db;
let selected = {
  alliance: null,
  startingPosition: null,
  autoClimb: null,
  defenseRating: null,
  endgameStatus: null
};
let photoBase64 = null;

// ---------- IndexedDB setup ----------

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function queueAdd(entry) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function queueGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function queueRemove(sessionId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(sessionId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Settings ----------

function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ---------- UI helpers ----------

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2200);
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function setActiveToggle(groupEl, value) {
  groupEl.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

async function updateQueueUI() {
  const items = await queueGetAll();
  const el = document.getElementById('queueCount');
  el.textContent = items.length;
  el.classList.toggle('zero', items.length === 0);
}

function updateConnectionUI() {
  const online = navigator.onLine;
  document.getElementById('statusDot').classList.toggle('online', online);
  document.getElementById('statusText').textContent = online ? 'Online' : 'Offline';
}

// ---------- Sync ----------

async function attemptSync() {
  const settings = getSettings();
  if (!settings.apiUrl || !navigator.onLine) return;

  const items = await queueGetAll();
  for (const item of items) {
    try {
      const res = await fetch(settings.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' }, // avoids CORS preflight w/ Apps Script
        body: JSON.stringify({ ...item, secret: settings.apiSecret })
      });
      const json = await res.json();
      if (json.status === 'ok') {
        await queueRemove(item.sessionId);
      }
    } catch (err) {
      // still offline or server unreachable — stop trying, we'll retry later
      break;
    }
  }
  await updateQueueUI();
}

// ---------- Form wiring ----------

function initToggleGroup(id, key) {
  const group = document.getElementById(id);
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    selected[key] = btn.dataset.value;
    setActiveToggle(group, btn.dataset.value);
  });
}


function resetForm() {
  document.getElementById('scoutForm').reset();
  document.getElementById('autoScoreVal').value = '0';
  document.getElementById('teleopScoreVal').value = '0';
  document.getElementById('cyclesPerMatchVal').value = '0';
  selected = {
    alliance: null,
    startingPosition: null,
    autoClimb: null,
    defenseRating: null,
    endgameStatus: null
  };
  document.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
  photoBase64 = null;
  document.getElementById('photoPreview').style.display = 'none';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- Init ----------

window.addEventListener('DOMContentLoaded', async () => {
  db = await openDB();
  updateConnectionUI();
  await updateQueueUI();
  attemptSync();

  initToggleGroup('allianceGroup', 'alliance');
  initToggleGroup('startingPositionGroup', 'startingPosition');
  initToggleGroup('autoClimbGroup', 'autoClimb');
  initToggleGroup('defenseGroup', 'defenseRating');
  initToggleGroup('endgameGroup', 'endgameStatus');


  document.getElementById('photoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    photoBase64 = await fileToBase64(file);
    const preview = document.getElementById('photoPreview');
    preview.src = photoBase64;
    preview.style.display = 'block';
  });

  document.getElementById('scoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const settings = getSettings();

    const entry = {
      sessionId: uuid(),
      scouterName: settings.scouterName || '',
      eventKey: settings.eventKey || '',
      matchType: document.getElementById('matchType').value,
      matchNumber: document.getElementById('matchNumber').value,
      teamNumber: document.getElementById('teamNumber').value,
      alliance: selected.alliance || '',
      startingPosition: selected.startingPosition || '',
      autoScore: document.getElementById('autoScoreVal').value,
      autoClimb: selected.autoClimb || '',
      teleopScore: document.getElementById('teleopScoreVal').value,
      cyclesPerMatch: document.getElementById('cyclesPerMatchVal').value,
      endgameStatus: selected.endgameStatus || '',
      defenseRating: selected.defenseRating || '',
      brokeDown: document.getElementById('brokeDown').checked,
      notes: document.getElementById('notes').value,
      photoBase64: photoBase64,
      clientTimestamp: new Date().toISOString()
    };

    if (!settings.scouterName) {
      showToast('Please enter your name in Settings first');
      document.getElementById('scouterName').value = '';
      document.getElementById('settingsModal').classList.add('show');
      return;
    }

    if (!entry.teamNumber || !entry.matchNumber) {
      showToast('Team number and match number are required');
      return;
    }

    await queueAdd(entry);
    await updateQueueUI();
    showToast('Saved locally. Will sync when online.');
    resetForm();
    attemptSync();
  });

  // Settings modal
  const modal = document.getElementById('settingsModal');
  document.getElementById('settingsBtn').addEventListener('click', () => {
    const s = getSettings();
    document.getElementById('scouterName').value = s.scouterName || '';
    document.getElementById('eventKey').value = s.eventKey || '';
    document.getElementById('apiUrl').value = s.apiUrl || '';
    document.getElementById('apiSecret').value = s.apiSecret || '';
    modal.classList.add('show');
  });
  document.getElementById('settingsCancel').addEventListener('click', () => {
    modal.classList.remove('show');
  });
  document.getElementById('settingsSave').addEventListener('click', () => {
    saveSettings({
      scouterName: document.getElementById('scouterName').value.trim(),
      eventKey: document.getElementById('eventKey').value.trim(),
      apiUrl: document.getElementById('apiUrl').value.trim(),
      apiSecret: document.getElementById('apiSecret').value.trim()
    });
    modal.classList.remove('show');
    showToast('Settings saved');
    attemptSync();
  });

  window.addEventListener('online', () => {
    updateConnectionUI();
    attemptSync();
  });
  window.addEventListener('offline', updateConnectionUI);

  // periodic retry in case 'online' event doesn't fire reliably on some devices
  setInterval(attemptSync, 30000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});
