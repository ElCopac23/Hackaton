// One floating tooltip for every element with data-tip: shown on hover, keyboard focus or tap.
export function setupTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let current = null;

  function show(el) {
    current = el;
    tip.textContent = el.dataset.tip;
    tip.style.maxWidth = `${Math.min(300, window.innerWidth - 24)}px`;
    tip.classList.add('is-on');
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const left = Math.max(12, Math.min(r.left + r.width / 2 - t.width / 2, window.innerWidth - t.width - 12));
    const top = r.top - t.height - 8 < 8 ? r.bottom + 8 : r.top - t.height - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  function hide() {
    current = null;
    tip.classList.remove('is-on');
  }

  document.addEventListener('mouseover', (ev) => {
    const el = ev.target.closest?.('[data-tip]');
    if (el && el !== current) show(el);
    else if (!el && current) hide();
  });
  document.addEventListener('focusin', (ev) => { const el = ev.target.closest?.('[data-tip]'); if (el) show(el); });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest?.('[data-tip]');
    if (el && !el.closest('button, a, [data-parcel]')) show(el);
    else if (!el) hide();
  }, true);
}
