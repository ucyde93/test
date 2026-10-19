'use strict';
/* Small DOM and data helpers shared by every renderer script. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, val);
        else node.style[prop] = val;
      }
    }
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let _uid = 0;
const uid = (p = 'a') => `${p}${Date.now().toString(36)}${(++_uid).toString(36)}`;

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function hexToRgb01(hex) {
  const h = (hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function dataUrlToBytes(url) {
  const b64 = url.split(',')[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToDataUrl(bytes, mime) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return `data:${mime};base64,${btoa(s)}`;
}
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('This image could not be read.'));
    img.src = src;
  });
}
function canvasToBytes(canvas, type = 'image/png', quality) {
  return new Promise((res) => canvas.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), type, quality));
}
function baseName(name) {
  return (name || 'document').replace(/\.pdf$/i, '');
}
function todayString() {
  return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const isRtl = (s) => RTL_RE.test(s || '');

/** Parse "1-3, 5, 8-" into zero-based page indices. */
function parseRange(str, count) {
  const out = new Set();
  const s = (str || '').trim();
  if (!s || /^all$/i.test(s)) { for (let i = 0; i < count; i++) out.add(i); return [...out]; }
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    if (m) {
      const a = m[1] ? +m[1] : 1;
      const b = m[2] ? +m[2] : count;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= count) out.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = +part;
      if (n >= 1 && n <= count) out.add(n - 1);
    } else {
      throw new Error(`"${part}" is not a page number or range.`);
    }
  }
  return [...out].sort((a, b) => a - b);
}

// ---------- toasts ----------
function toast(message, kind = 'info', ms = 3200) {
  const host = $('#toasts');
  while (host.children.length >= 3) host.firstElementChild.remove();
  const t = el('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  host.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
  return t;
}

/** Shows a blocking progress overlay while `fn` runs. */
async function busy(label, fn) {
  const ov = $('#busy');
  $('#busyLabel').textContent = label;
  ov.hidden = false;
  await sleep(30);
  try { return await fn(); } finally { ov.hidden = true; }
}

function settingsGet(key, fallback) {
  try { const v = localStorage.getItem('sahifa.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function settingsSet(key, value) {
  try { localStorage.setItem('sahifa.' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
