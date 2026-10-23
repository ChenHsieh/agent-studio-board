// Play queue: verdicts stay on this device until a person pastes them into the chat.
const SOURCES = [
  'data/status.json',
  'https://raw.githubusercontent.com/ChenHsieh/agent-studio-board/main/docs/data/status.json',
];
const CHOICES_KEY = 'play.choices';
const VERDICTS = ['ship', 'revise', 'shelf'];
const cards = document.getElementById('play-cards');
const fresh = document.getElementById('play-fresh');
const footer = document.getElementById('play-footer');
const copyAll = document.getElementById('copy-all');
const allStatus = document.getElementById('all-status');
let rows = [];
let choices = {};

function ago(iso) {
  const time = Date.parse(iso || '');
  if (Number.isNaN(time)) return 'unknown';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function addedDay(added) {
  const date = new Date(`${added}T12:00:00`);
  return Number.isNaN(date.getTime()) ? String(added) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function keyFor(row) { return `${row.id}@${row.added}`; }
function cleanNote(note) { return String(note || '').replace(/[|\r\n]+/g, ' ').trim().slice(0, 120); }
function lineFor(row) {
  const choice = choices[keyFor(row)];
  return `${String(row.id).toLowerCase()}|${choice.verdict}|${cleanNote(choice.note)}`;
}

function readChoices() {
  try {
    const value = JSON.parse(localStorage.getItem(CHOICES_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function saveChoices() {
  try { localStorage.setItem(CHOICES_KEY, JSON.stringify(choices)); } catch { /* Browsing without storage still works. */ }
}

function pruneChoices() {
  const live = new Set(rows.map(keyFor));
  choices = Object.fromEntries(Object.entries(readChoices()).filter(([key, choice]) =>
    live.has(key) && choice && VERDICTS.includes(choice.verdict)).map(([key, choice]) =>
    [key, { verdict: choice.verdict, note: cleanNote(choice.note) }]));
  saveChoices();
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch { /* Older browsers use the selection fallback. */ }
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.left = '-9999px';
  document.body.appendChild(field);
  field.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { /* Show the line below. */ }
  field.remove();
  return copied;
}

function showCopyResult(status, fallback, value, copied) {
  fallback.replaceChildren();
  fallback.hidden = copied;
  if (copied) {
    status.textContent = `Copied: ${value}. Paste it into the chat with the agent.`;
  } else {
    status.textContent = 'Copy this line';
    const code = document.createElement('code');
    code.textContent = value;
    fallback.appendChild(code);
  }
}

function updateCopyAll() {
  copyAll.disabled = !rows.some((row) => choices[keyFor(row)]);
}

function makeCard(row) {
  const article = document.createElement('article');
  article.className = 'play-card';
  const titleRow = document.createElement('div');
  titleRow.className = 'play-title-row';
  const thumb = row.image ? document.createElement('img') : document.createElement('span');
  thumb.className = `play-thumb${row.image ? '' : ' blank'}`;
  if (row.image) {
    thumb.src = row.image;
    thumb.alt = '';
    thumb.loading = 'lazy';
  } else {
    thumb.textContent = String(row.title || '?').charAt(0);
    thumb.setAttribute('aria-hidden', 'true');
  }
  const titleText = document.createElement('div');
  titleText.className = 'play-title-text';
  const title = document.createElement('h2');
  title.textContent = row.title;
  titleText.appendChild(title);
  if (row.busy) {
    const busy = document.createElement('span');
    busy.className = 'busy-tag';
    busy.textContent = 'being changed now';
    titleText.appendChild(busy);
  }
  titleRow.append(thumb, titleText);

  const tryHeading = document.createElement('h3');
  tryHeading.textContent = 'Try this';
  const tryLine = document.createElement('p');
  tryLine.className = 'try-line';
  tryLine.textContent = row.try || '';
  const waiting = document.createElement('p');
  waiting.className = 'waiting';
  waiting.textContent = `waiting since ${addedDay(row.added)}`;
  const play = document.createElement('a');
  play.className = 'play-action';
  play.href = row.url;
  play.target = '_blank';
  play.rel = 'noopener noreferrer';
  play.textContent = 'Play';

  const verdicts = document.createElement('div');
  verdicts.className = 'verdicts';
  verdicts.setAttribute('role', 'group');
  verdicts.setAttribute('aria-label', `Verdict for ${row.title}`);
  const noteLabel = document.createElement('label');
  noteLabel.className = 'note-label';
  noteLabel.textContent = 'Note (optional, one line)';
  const note = document.createElement('input');
  note.className = 'note-input';
  note.type = 'text';
  note.maxLength = 120;
  note.autocomplete = 'off';
  note.value = choices[keyFor(row)]?.note || '';
  noteLabel.appendChild(note);
  const again = document.createElement('button');
  again.className = 'copy-again';
  again.type = 'button';
  again.textContent = 'Copy again';
  const status = document.createElement('p');
  status.className = 'copy-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const fallback = document.createElement('div');
  fallback.className = 'copy-fallback';
  fallback.hidden = true;

  const buttons = VERDICTS.map((verdict) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = verdict[0].toUpperCase() + verdict.slice(1);
    button.setAttribute('aria-pressed', String(choices[keyFor(row)]?.verdict === verdict));
    button.addEventListener('click', async () => {
      choices[keyFor(row)] = { verdict, note: cleanNote(note.value) };
      saveChoices();
      buttons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      again.hidden = false;
      updateCopyAll();
      showCopyResult(status, fallback, lineFor(row), await copyText(lineFor(row)));
    });
    verdicts.appendChild(button);
    return button;
  });
  again.hidden = !choices[keyFor(row)];
  note.addEventListener('input', () => {
    const clean = cleanNote(note.value);
    if (clean !== note.value) note.value = clean;
    const choice = choices[keyFor(row)];
    if (choice) {
      choice.note = clean;
      saveChoices();
      status.textContent = 'Note changed. Copy again to include it.';
      fallback.hidden = true;
    }
  });
  again.addEventListener('click', async () => {
    const value = lineFor(row);
    showCopyResult(status, fallback, value, await copyText(value));
  });
  article.append(titleRow, tryHeading, tryLine, waiting, play, verdicts, noteLabel, again, status, fallback);
  return article;
}

function render(data) {
  rows = Array.isArray(data.playQueue) ? data.playQueue.slice(0, 3) : [];
  pruneChoices();
  fresh.textContent = `${rows.length} games · updated ${ago(data.generated)}`;
  cards.replaceChildren();
  if (rows.length) rows.forEach((row) => cards.appendChild(makeCard(row)));
  else {
    const empty = document.createElement('p');
    empty.className = 'play-empty';
    empty.textContent = 'Nothing to play today. A game arrives here after a stranger review says ship.';
    cards.appendChild(empty);
  }
  footer.hidden = !rows.length;
  updateCopyAll();
}

copyAll.addEventListener('click', async () => {
  const value = rows.filter((row) => choices[keyFor(row)]).map(lineFor).join('\n');
  if (!value) return;
  let fallback = document.getElementById('all-fallback');
  if (!fallback) {
    fallback = document.createElement('div');
    fallback.id = 'all-fallback';
    fallback.className = 'copy-fallback';
    allStatus.after(fallback);
  }
  showCopyResult(allStatus, fallback, value, await copyText(value));
});

async function load() {
  for (const source of SOURCES) {
    try {
      const response = await fetch(`${source}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) continue;
      render(await response.json());
      return;
    } catch { /* Try the next source. */ }
  }
  fresh.textContent = 'Could not reach the play queue. Try again later.';
}

load();
