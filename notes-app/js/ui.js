import { I, esc } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

let toastTimer;
export function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

// Bottom sheet. build(el, close) fills it. Returns close().
export function sheet(innerHtml, build) {
  const bd = h(`<div class="backdrop"><div class="sheet" role="dialog"><div class="grab"></div>${innerHtml}</div></div>`);
  document.body.appendChild(bd);
  const el = bd.firstElementChild;
  let closed = false;
  const close = () => { if (closed) return; closed = true; bd.remove(); };
  bd.addEventListener('click', (e) => { if (e.target === bd) close(); });
  if (build) build(el, close);
  const first = el.querySelector('input,textarea');
  if (first && !first.dataset.noautofocus) setTimeout(() => first.focus(), 250);
  return close;
}

export function askText({ title, label = '', value = '', placeholder = '', ok = 'Save', multiline = false }) {
  return new Promise((resolve) => {
    sheet(`<h3>${esc(title)}</h3><div class="field">${label ? `<label>${esc(label)}</label>` : ''}${multiline ? `<textarea rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input value="${esc(value)}" placeholder="${esc(placeholder)}">`}</div>
      <div class="row"><button class="btn big grow press" data-x>Cancel</button><button class="btn big acc grow press" data-ok>${esc(ok)}</button></div>`, (el, close) => {
      const inp = el.querySelector('input,textarea');
      const done = (v) => { close(); resolve(v); };
      el.querySelector('[data-x]').onclick = () => done(null);
      el.querySelector('[data-ok]').onclick = () => done(inp.value.trim() || null);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) done(inp.value.trim() || null); });
    });
  });
}

export function confirmSheet({ title, body = '', ok = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    sheet(`<h3>${esc(title)}</h3>${body ? `<p class="sub" style="margin:0">${esc(body)}</p>` : ''}
      <div class="row"><button class="btn big grow press" data-x>Cancel</button><button class="btn big grow press ${danger ? 'danger' : 'acc'}" data-ok>${esc(ok)}</button></div>`, (el, close) => {
      el.querySelector('[data-x]').onclick = () => { close(); resolve(false); };
      el.querySelector('[data-ok]').onclick = () => { close(); resolve(true); };
    });
  });
}

// Popup menu next to an element. items: [{label, icon, run, danger}] or 'hr'
export function menu(anchor, items) {
  document.querySelectorAll('.menu').forEach(m => m.remove());
  const m = h(`<div class="menu" role="menu"></div>`);
  items.forEach(it => {
    if (it === 'hr') { m.appendChild(document.createElement('hr')); return; }
    const b = h(`<button role="menuitem" ${it.danger ? 'style="color:var(--bad)"' : ''}>${it.icon || ''}<span>${esc(it.label)}</span></button>`);
    b.onclick = (e) => { e.stopPropagation(); m.remove(); it.run(); };
    m.appendChild(b);
  });
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.min(window.innerWidth - mw - 12, Math.max(12, r.right - mw));
  let top = r.bottom + 8;
  if (top + mh > window.innerHeight - 12) top = Math.max(12, r.top - mh - 8);
  m.style.left = left + 'px'; m.style.top = top + 'px';
  setTimeout(() => {
    const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
    document.addEventListener('pointerdown', off, true);
  }, 0);
  return m;
}

// Accent + light/dark, same rules as the mock-ups.
export function applyTheme(settings) {
  const root = document.documentElement;
  const dark = settings.theme === 'dark' || (settings.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  const accent = (settings.accent || '#111111').toUpperCase();
  const black = accent === '#111111';
  const acc = dark && black ? '#F5F5F7' : accent;
  root.style.setProperty('--acc', acc);
  root.style.setProperty('--on', dark && black ? '#111113' : '#FFFFFF');
  root.style.setProperty('--accSoft', acc + (dark ? '2E' : '14'));
  root.style.setProperty('--accText', dark ? (black ? '#F5F5F7' : '#FFFFFF') : acc);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#000000' : '#F4F4F6';
}

export function moveIndicator(container) {
  const on = container.querySelector('button.on'); const ind = container.querySelector('.ind');
  if (!on || !ind) return;
  ind.style.width = on.offsetWidth + 'px';
  ind.style.transform = `translateX(${on.offsetLeft - 4}px)`;
}

export { I, esc };
