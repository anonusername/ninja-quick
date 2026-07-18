// Renderer for the web-request debug window. No Node here — events arrive over the debugBridge
// preload. Each request produces a 'start' event (row created, pending) and later an 'end' event
// (status/duration/size or error filled in), correlated by id.

const rowsEl = document.getElementById('rows');
const wrapEl = document.getElementById('wrap');
const countEl = document.getElementById('count');
const emptyEl = document.getElementById('empty');
const filterEl = document.getElementById('filter');
const autoscrollEl = document.getElementById('autoscroll');
const clearBtn = document.getElementById('clear');

const MAX_ROWS = 3000;
const AT_BOTTOM_THRESHOLD = 6; // px slack so sub-pixel rounding still counts as "at the bottom"
const byId = new Map(); // request id -> { tr, seq }
let seq = 0;
let pending = 0;
let filterText = '';
// Tail-follow: autoscroll is driven by scroll position, not a manual toggle. It's on while the view
// is at the bottom; scrolling up pauses it (rows keep logging, the view stays put); scrolling back
// to the bottom re-engages it. Starts on (empty view is "at the bottom").
let autoscroll = true;

function isAtBottom() {
  return wrapEl.scrollHeight - wrapEl.scrollTop - wrapEl.clientHeight <= AT_BOTTOM_THRESHOLD;
}
function scrollToBottom() {
  wrapEl.scrollTop = wrapEl.scrollHeight;
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function statusClass(evt) {
  if (evt.error) return 'status-err';
  const s = evt.status;
  if (s == null) return 'status-pending';
  return `status-${Math.floor(s / 100)}`;
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}

function updateCount() {
  countEl.textContent = pending > 0 ? `${seq} requests (${pending} pending)` : `${seq} requests`;
  emptyEl.style.display = seq > 0 ? 'none' : '';
}

function matchesFilter(tr) {
  if (!filterText) return true;
  return (tr.dataset.search || '').includes(filterText);
}

function applyFilterToRow(tr) {
  tr.classList.toggle('hidden', !matchesFilter(tr));
}

function handleStart(evt) {
  seq += 1;
  pending += 1;
  const tr = document.createElement('tr');
  tr.dataset.id = String(evt.id);

  const host = hostOf(evt.url);
  const cells = [
    { text: String(seq), cls: 'num' },
    { text: fmtTime(evt.startedAt), cls: '' },
    { text: evt.method || '', cls: 'method' },
    { text: '…', cls: 'status status-pending' },
    { text: evt.resourceType || '', cls: 'type' },
    { text: '', cls: 'duration num' },
    { text: '', cls: 'size num' },
    { text: host, cls: 'host' },
    { text: evt.url || '', cls: 'url' },
  ];
  for (const c of cells) {
    const td = document.createElement('td');
    td.className = c.cls;
    td.textContent = c.text;
    tr.appendChild(td);
  }
  tr.dataset.search = `${evt.method || ''} ${evt.url || ''}`.toLowerCase();
  applyFilterToRow(tr);
  rowsEl.appendChild(tr);
  byId.set(evt.id, { tr });

  // Cap DOM growth — drop oldest rows (their end events, if any, simply no-op).
  while (rowsEl.children.length > MAX_ROWS) {
    const first = rowsEl.firstChild;
    const fid = Number(first.dataset.id);
    byId.delete(fid);
    rowsEl.removeChild(first);
  }

  updateCount();
  if (autoscroll) scrollToBottom();
}

function handleEnd(evt) {
  const entry = byId.get(evt.id);
  if (!entry) return; // its row was capped away
  if (pending > 0) pending -= 1;
  const tds = entry.tr.children;
  const statusTd = tds[3];
  const durTd = tds[5];
  const sizeTd = tds[6];

  statusTd.className = `status ${statusClass(evt)}`;
  if (evt.error) {
    statusTd.textContent = evt.error;
  } else {
    statusTd.textContent = evt.fromCache ? `${evt.status} (cache)` : String(evt.status);
  }
  durTd.textContent = fmtDuration(evt.durationMs);
  sizeTd.textContent = fmtSize(evt.size);

  // Fold the resolved status into the searchable text so filtering by e.g. "404" works.
  entry.tr.dataset.search += ` ${statusTd.textContent.toLowerCase()}`;
  applyFilterToRow(entry.tr);
  updateCount();
}

function handleEvent(evt) {
  if (evt.phase === 'start') handleStart(evt);
  else if (evt.phase === 'end') handleEnd(evt);
}

filterEl.addEventListener('input', () => {
  filterText = filterEl.value.trim().toLowerCase();
  for (const tr of rowsEl.children) applyFilterToRow(tr);
});

// Scrolling up pauses autoscroll; returning to the bottom resumes it. The checkbox is a live
// indicator of that state, and also a manual override (check = jump to bottom + follow).
wrapEl.addEventListener('scroll', () => {
  autoscroll = isAtBottom();
  autoscrollEl.checked = autoscroll;
});
autoscrollEl.addEventListener('change', () => {
  autoscroll = autoscrollEl.checked;
  if (autoscroll) scrollToBottom();
});

clearBtn.addEventListener('click', () => {
  rowsEl.innerHTML = '';
  byId.clear();
  seq = 0;
  pending = 0;
  updateCount();
  window.debugBridge.clear();
});

// Seed replays everything captured before this window finished loading, in order.
window.debugBridge.onSeed((events) => {
  for (const evt of events) handleEvent(evt);
  if (autoscroll) scrollToBottom();
});
window.debugBridge.onRequest(handleEvent);

updateCount();
