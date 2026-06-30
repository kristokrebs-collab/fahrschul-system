/* ════════════════════════════════════════════════════════════════════════
   Fahrschul-Cockpit · UI-Helfer
   Haptik-Engine, Toasts, Konfetti, Icons & Formatierung.
   ════════════════════════════════════════════════════════════════════════ */

/* ── Haptik-Engine (Navigator.vibrate · Abschnitt 8) ────────────────────── */
export const haptic = {
  light()    { try { navigator.vibrate?.(12); } catch (e) {} },
  confirm()  { try { navigator.vibrate?.([22, 40, 22]); } catch (e) {} },   // satter Doppel-Impuls
  block()    { try { navigator.vibrate?.(60); } catch (e) {} },             // dumpfer Widerstand
  success()  { try { navigator.vibrate?.([18, 30, 18, 30, 40]); } catch (e) {} },
};

/* ── Toast / Push ───────────────────────────────────────────────────────── */
let toastWrap;
function ensureWrap() {
  if (!toastWrap) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'toast-wrap';
    document.body.appendChild(toastWrap);
  }
  return toastWrap;
}
export function toast({ title, msg, icon = '🔔', tone = 'blue', express = false, duration = 4200, onTap }) {
  const wrap = ensureWrap();
  const el = document.createElement('div');
  el.className = 'toast' + (express ? ' express' : '');
  const bg = { green: 'rgba(16,185,129,.18)', amber: 'rgba(245,158,11,.18)', red: 'rgba(239,68,68,.18)',
               blue: 'rgba(59,130,246,.18)', purple: 'rgba(168,85,247,.18)' }[tone] || 'rgba(59,130,246,.18)';
  el.innerHTML = `<div class="ic" style="background:${express ? '' : bg}">${icon}</div>
    <div class="body"><div class="t">${title}</div>${msg ? `<div class="m">${msg}</div>` : ''}</div>`;
  if (onTap) { el.style.cursor = 'pointer'; el.addEventListener('click', () => { onTap(); dismiss(); }); }
  wrap.appendChild(el);
  function dismiss() { el.classList.add('out'); setTimeout(() => el.remove(), 360); }
  const t = setTimeout(dismiss, duration);
  el.addEventListener('click', () => clearTimeout(t));
  return dismiss;
}

/* ── Konfetti (edel, sparsam) ───────────────────────────────────────────── */
export function confetti(count = 60) {
  const colors = ['#FBBF24', '#34D399', '#818CF8', '#F8FAFC', '#A855F7'];
  for (let i = 0; i < count; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.opacity = '0';
    document.body.appendChild(c);
    const dx = (Math.random() - 0.5) * 240;
    const rot = Math.random() * 720;
    const dur = 1600 + Math.random() * 1400;
    c.animate([
      { transform: `translate(0,0) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${dx}px, 105vh) rotate(${rot}deg)`, opacity: 1 },
    ], { duration: dur, easing: 'cubic-bezier(.2,.6,.4,1)', delay: Math.random() * 250 });
    setTimeout(() => c.remove(), dur + 400);
  }
}

/* ── Formatierung ───────────────────────────────────────────────────────── */
export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short' });
}
export function fmtEuro(n) { return (n || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }); }
export function relTime(ts) {
  const d = Math.round((Date.now() - ts) / 1000);
  if (d < 60) return 'gerade eben';
  if (d < 3600) return `vor ${Math.floor(d / 60)} Min`;
  if (d < 86400) return `vor ${Math.floor(d / 3600)} Std`;
  return `vor ${Math.floor(d / 86400)} Tg`;
}

/* ── SVG-Icon-Set (Linien-Stil, edel) ───────────────────────────────────── */
export const icon = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="17" rx="3"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>`,
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 0 2 2h13"/></svg>`,
  grid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>`,
};

/* HTML-Escape gegen Injektion in dynamischen Texten */
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
