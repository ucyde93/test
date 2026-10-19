'use strict';
/* Page organizer: a grid of page thumbnails with multi-select and drag to reorder. */

const Organizer = { open: false, selected: new Set(), anchor: null, io: null, dragging: null };

function orgTargets() {
  const sel = [...Organizer.selected].sort((a, b) => a - b);
  return sel.length ? sel : [Viewer.current];
}

function openOrganizer() {
  if (!Viewer.doc) return;
  if (Annotations.editing) finishTextEdit();
  Organizer.open = true;
  Organizer.selected = new Set([Viewer.current]);
  $('#viewer').hidden = true;
  $('#organizer').hidden = false;
  renderOrganizer();
  document.dispatchEvent(new CustomEvent('organizer-toggled'));
}
function closeOrganizer(goTo = null) {
  Organizer.open = false;
  $('#organizer').hidden = true;
  $('#viewer').hidden = false;
  if (Organizer.io) Organizer.io.disconnect();
  const doc = Viewer.doc;
  if (doc) setZoom(doc.zoom.mode, doc.zoom.scale);
  if (goTo != null) requestAnimationFrame(() => goToPage(goTo));
  document.dispatchEvent(new CustomEvent('organizer-toggled'));
}

function orgButton(label, iconName, onClick, extra = {}) {
  return el('button', { class: 'tb-btn', title: extra.title || label, onclick: onClick, ...extra }, icon(iconName, 18), el('span', {}, label));
}

function renderOrganizer() {
  const doc = Viewer.doc;
  const root = $('#organizer');
  root.innerHTML = '';
  const count = Organizer.selected.size;
  const bar = el('div', { class: 'org-bar' },
    el('div', { class: 'org-title' }, el('strong', {}, 'Organize pages'), el('span', { class: 'muted' }, count ? `${count} selected of ${doc.pageCount}` : `${doc.pageCount} pages`)),
    el('div', { class: 'org-actions' },
      orgButton('Rotate left', 'rotateCcw', () => App.run('rotate-ccw')),
      orgButton('Rotate right', 'rotateCw', () => App.run('rotate-cw')),
      orgButton('Duplicate', 'copy', () => App.run('duplicate-page')),
      orgButton('Delete', 'trash', () => App.run('delete-page')),
      el('span', { class: 'tb-sep' }),
      orgButton('Blank page', 'blank', () => App.run('insert-blank')),
      orgButton('Insert PDF', 'merge', () => App.run('insert-pdf')),
      orgButton('Insert images', 'images', () => App.run('insert-images')),
      el('span', { class: 'tb-sep' }),
      orgButton('Extract', 'extract', () => App.run('extract-selected')),
      orgButton('Split', 'split', () => App.run('split')),
      el('span', { class: 'tb-sep' }),
      orgButton('Select all', 'organize', () => { Organizer.selected = new Set(doc.pageUids.map((_, i) => i)); renderOrganizer(); }),
      el('button', { class: 'btn btn-primary', onclick: () => closeOrganizer(orgTargets()[0]) }, 'Done')));
  const grid = el('div', { class: 'org-grid', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Pages' });
  if (Organizer.io) Organizer.io.disconnect();
  Organizer.io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const card = e.target;
      Organizer.io.unobserve(card);
      const c = card.querySelector('canvas');
      renderThumb(doc, +card.dataset.index, c, 150).catch(() => {});
    }
  }, { root, rootMargin: '400px' });

  doc.pageUids.forEach((uidKey, i) => {
    const s = doc.sizes[i];
    const h = Math.round((150 * s.h) / s.w);
    const card = el('div', {
      class: 'org-card' + (Organizer.selected.has(i) ? ' on' : ''),
      role: 'option', 'aria-selected': Organizer.selected.has(i) ? 'true' : 'false', tabindex: 0, draggable: 'true',
      dataset: { index: i },
    },
    el('div', { class: 'org-thumb', style: { height: h + 'px' } }, el('canvas', { style: { width: '150px', height: h + 'px' } })),
    el('div', { class: 'org-label' }, String(i + 1), (doc.annots.get(uidKey) || []).length ? el('span', { class: 'org-badge', title: 'Has your edits' }, '•') : null));
    card.addEventListener('click', (e) => {
      if (e.shiftKey && Organizer.anchor != null) {
        const [a, b] = [Math.min(Organizer.anchor, i), Math.max(Organizer.anchor, i)];
        if (!(e.ctrlKey || e.metaKey)) Organizer.selected.clear();
        for (let k = a; k <= b; k++) Organizer.selected.add(k);
      } else if (e.ctrlKey || e.metaKey) {
        if (Organizer.selected.has(i)) Organizer.selected.delete(i); else Organizer.selected.add(i);
        Organizer.anchor = i;
      } else {
        Organizer.selected = new Set([i]);
        Organizer.anchor = i;
      }
      renderOrganizer();
      $(`.org-card[data-index="${i}"]`)?.focus();
    });
    card.addEventListener('dblclick', () => closeOrganizer(i));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') closeOrganizer(i);
      if (e.key === 'Delete') App.run('delete-page');
      if (e.key === ' ') { e.preventDefault(); card.click(); }
    });
    card.addEventListener('dragstart', (e) => {
      const moving = Organizer.selected.has(i) ? [...Organizer.selected].sort((a, b) => a - b) : [i];
      Organizer.dragging = moving;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', moving.join(','));
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); $$('.org-card').forEach((c) => c.classList.remove('drop-before', 'drop-after')); });
    card.addEventListener('dragover', (e) => {
      if (!Organizer.dragging) return;
      e.preventDefault();
      const r = card.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      $$('.org-card').forEach((c) => c.classList.remove('drop-before', 'drop-after'));
      card.classList.add(after ? 'drop-after' : 'drop-before');
    });
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      const moving = Organizer.dragging;
      Organizer.dragging = null;
      if (!moving) return;
      const r = card.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      let target = i + (after ? 1 : 0);
      const rest = doc.pageUids.map((_, k) => k).filter((k) => !moving.includes(k));
      target -= moving.filter((k) => k < target).length;
      const order = [...rest.slice(0, target), ...moving, ...rest.slice(target)];
      if (order.every((v, k) => v === k)) return renderOrganizer();
      await App.guard(async () => {
        await busy('Moving pages…', () => PageOps.reorder(doc, order));
        Organizer.selected = new Set(moving.map((_, k) => target + k));
        App.afterStructureChange();
      });
    });
    grid.append(card);
    Organizer.io.observe(card);
  });
  root.append(bar, grid);
}
