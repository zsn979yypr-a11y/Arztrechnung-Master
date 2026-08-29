'use strict';

/* Arztrechnung Splitter — läuft komplett lokal im Browser (pdf.js + pdf-lib via CDN). */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const HISTORY_KEY = 'arztrechnung-splitter-verlauf-v1';
const THUMB_WIDTH = 64;

const els = {
  fileInput: document.getElementById('fileInput'),
  uploadBtn: document.getElementById('uploadBtn'),
  uploadStatus: document.getElementById('uploadStatus'),
  uploadSection: document.getElementById('upload-section'),
  cameraInput: document.getElementById('cameraInput'),
  scanBtn: document.getElementById('scanBtn'),
  captureSection: document.getElementById('capture-section'),
  captureList: document.getElementById('captureList'),
  addPageBtn: document.getElementById('addPageBtn'),
  finishCaptureBtn: document.getElementById('finishCaptureBtn'),
  pagesSection: document.getElementById('pages-section'),
  pagesList: document.getElementById('pagesList'),
  groupsSection: document.getElementById('groups-section'),
  groupsList: document.getElementById('groupsList'),
  generateBtn: document.getElementById('generateBtn'),
  resultsSection: document.getElementById('results-section'),
  resultsList: document.getElementById('resultsList'),
  shareAllBtn: document.getElementById('shareAllBtn'),
  resetBtn: document.getElementById('resetBtn'),
  historyList: document.getElementById('historyList'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),
};

const state = {
  pdfBytes: null,
  pdfDocForRender: null,
  numPages: 0,
  pages: [],
  groupFields: new Map(),
  currentGroups: [],
  results: [],
  capturedPages: [],
};

init();

function init() {
  els.uploadBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', onFileChosen);
  els.scanBtn.addEventListener('click', startCaptureSession);
  els.addPageBtn.addEventListener('click', () => els.cameraInput.click());
  els.cameraInput.addEventListener('change', onPhotoTaken);
  els.finishCaptureBtn.addEventListener('click', finishCapture);
  els.generateBtn.addEventListener('click', generatePdfs);
  els.resetBtn.addEventListener('click', () => {
    resetSession();
    els.uploadSection.scrollIntoView({ behavior: 'smooth' });
  });
  els.shareAllBtn.addEventListener('click', onShareAll);
  els.exportCsvBtn.addEventListener('click', onExportCsv);
  els.clearHistoryBtn.addEventListener('click', onClearHistory);
  renderHistory();
}

/* ---------- PDF laden ---------- */

async function onFileChosen(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (typeof pdfjsLib === 'undefined' || typeof PDFLib === 'undefined') {
    setStatus('Fehler: PDF-Bibliotheken konnten nicht geladen werden. Bitte Internetverbindung prüfen und neu laden.');
    return;
  }
  await loadPdf(file);
}

/* ---------- Kamera-Scan: Fotos aufnehmen und zu PDF zusammenfügen ---------- */

function startCaptureSession() {
  clearCapturedPages();
  els.captureSection.hidden = false;
  els.captureSection.scrollIntoView({ behavior: 'smooth' });
  setStatus('');
  els.cameraInput.click();
}

async function onPhotoTaken(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  setStatus('Verarbeite Foto …');
  try {
    const normalized = await normalizeImageFile(file);
    const url = URL.createObjectURL(normalized.blob);
    state.capturedPages.push({ blob: normalized.blob, width: normalized.width, height: normalized.height, url });
    renderCaptureList();
    setStatus(`${state.capturedPages.length} Seite(n) fotografiert.`);
  } catch (err) {
    console.error(err);
    setStatus('Foto konnte nicht verarbeitet werden: ' + (err && err.message ? err.message : err));
  }
}

function normalizeImageFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxDim = 2200;
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Bild konnte nicht verarbeitet werden'));
            return;
          }
          resolve({ blob, width, height });
        },
        'image/jpeg',
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Bild konnte nicht geladen werden'));
    };
    img.src = objectUrl;
  });
}

function renderCaptureList() {
  els.captureList.innerHTML = '';
  state.capturedPages.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'capture-item';

    const img = document.createElement('img');
    img.className = 'capture-thumb';
    img.src = p.url;
    img.alt = `Seite ${i + 1}`;
    card.appendChild(img);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'capture-remove';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Seite ${i + 1} entfernen`);
    removeBtn.addEventListener('click', () => {
      URL.revokeObjectURL(p.url);
      state.capturedPages.splice(i, 1);
      renderCaptureList();
    });
    card.appendChild(removeBtn);

    const label = document.createElement('span');
    label.className = 'capture-label';
    label.textContent = `Seite ${i + 1}`;
    card.appendChild(label);

    els.captureList.appendChild(card);
  });
  els.finishCaptureBtn.disabled = state.capturedPages.length === 0;
}

function clearCapturedPages() {
  state.capturedPages.forEach((p) => {
    if (p.url) URL.revokeObjectURL(p.url);
  });
  state.capturedPages = [];
  els.captureList.innerHTML = '';
  els.finishCaptureBtn.disabled = true;
}

async function finishCapture() {
  if (state.capturedPages.length === 0) return;
  setStatus('Erstelle PDF aus den Fotos …');
  try {
    const bytes = await buildPdfFromCapturedPages(state.capturedPages);
    const file = new File([bytes], 'scan.pdf', { type: 'application/pdf' });
    els.captureSection.hidden = true;
    clearCapturedPages();
    await loadPdf(file);
  } catch (err) {
    console.error(err);
    setStatus('Fehler beim Erstellen der PDF: ' + (err && err.message ? err.message : err));
  }
}

async function buildPdfFromCapturedPages(pages) {
  const PT_PER_PX = 0.75; // 96dpi Bildschirmpixel -> 72pt PDF-Punkte
  const pdfDoc = await PDFLib.PDFDocument.create();
  for (const p of pages) {
    const bytes = await p.blob.arrayBuffer();
    const jpgImage = await pdfDoc.embedJpg(bytes);
    const pageWidth = p.width * PT_PER_PX;
    const pageHeight = p.height * PT_PER_PX;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    page.drawImage(jpgImage, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  }
  return pdfDoc.save();
}

async function loadPdf(file) {
  resetSession();
  setStatus('Lade PDF …');
  try {
    const arrayBuffer = await file.arrayBuffer();
    state.pdfBytes = arrayBuffer.slice(0);
    const pdfjsBytes = arrayBuffer.slice(0);

    const pdfDoc = await pdfjsLib.getDocument({ data: pdfjsBytes }).promise;
    state.pdfDocForRender = pdfDoc;
    state.numPages = pdfDoc.numPages;
    state.pages = [];

    els.pagesList.innerHTML = '';
    for (let i = 0; i < state.numPages; i++) {
      state.pages.push({ index: i, isStart: true, rendered: false });
      els.pagesList.appendChild(createPageEl(i));
      updatePageEl(i);
    }

    els.pagesSection.hidden = false;
    els.groupsSection.hidden = false;
    observeThumbnails();
    renderGroups();
    setStatus(`${state.numPages} Seite(n) geladen. Jede Seite ist zunächst eine eigene Rechnung.`);
  } catch (err) {
    console.error(err);
    setStatus('Fehler beim Lesen der PDF: ' + (err && err.message ? err.message : err));
  }
}

/* ---------- Seiten-Liste & Toggle ---------- */

function createPageEl(i) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'page-item';
  card.dataset.index = String(i);
  if (i === 0) card.classList.add('is-locked');

  const canvas = document.createElement('canvas');
  canvas.className = 'page-thumb';
  canvas.width = THUMB_WIDTH;
  canvas.height = Math.round(THUMB_WIDTH * 1.41);
  card.appendChild(canvas);

  const info = document.createElement('span');
  info.className = 'page-info';

  const label = document.createElement('span');
  label.className = 'page-label';
  label.textContent = `Seite ${i + 1}`;
  info.appendChild(label);

  const badge = document.createElement('span');
  badge.className = 'page-badge';
  info.appendChild(badge);

  card.appendChild(info);

  card.addEventListener('click', () => {
    if (i === 0) return;
    toggleStart(i);
  });

  return card;
}

function updatePageEl(i) {
  const card = els.pagesList.querySelector(`.page-item[data-index="${i}"]`);
  if (!card) return;
  const badge = card.querySelector('.page-badge');
  const p = state.pages[i];
  card.classList.toggle('is-start', p.isStart);
  if (i === 0) {
    badge.textContent = 'Beginn Rechnung 1';
  } else {
    badge.textContent = p.isStart ? '✂️ Neue Rechnung ab hier' : 'gehört zur vorherigen Rechnung';
  }
}

function toggleStart(i) {
  state.pages[i].isStart = !state.pages[i].isStart;
  updatePageEl(i);
  renderGroups();
}

/* ---------- Thumbnails (lazy, mit IntersectionObserver) ---------- */

function observeThumbnails() {
  const canvases = els.pagesList.querySelectorAll('canvas.page-thumb');
  if (!('IntersectionObserver' in window)) {
    canvases.forEach((c) => {
      const i = Number(c.closest('.page-item').dataset.index);
      renderThumb(i, c);
    });
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const canvas = entry.target;
        const i = Number(canvas.closest('.page-item').dataset.index);
        io.unobserve(canvas);
        renderThumb(i, canvas);
      });
    },
    { rootMargin: '600px 0px' }
  );
  canvases.forEach((c) => io.observe(c));
}

async function renderThumb(i, canvas) {
  if (!state.pages[i] || state.pages[i].rendered) return;
  try {
    const page = await state.pdfDocForRender.getPage(i + 1);
    const baseViewport = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = (THUMB_WIDTH / baseViewport.width) * dpr;
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${THUMB_WIDTH}px`;
    canvas.style.height = `${(THUMB_WIDTH * viewport.height) / viewport.width}px`;

    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    state.pages[i].rendered = true;
  } catch (err) {
    console.error('Thumbnail-Fehler', err);
  }
}

/* ---------- Gruppen (= einzelne Rechnungen) ---------- */

function computeGroups() {
  const groups = [];
  state.pages.forEach((p, i) => {
    if (p.isStart || groups.length === 0) {
      groups.push({ pageIndices: [i] });
    } else {
      groups[groups.length - 1].pageIndices.push(i);
    }
  });
  return groups;
}

function renderGroups() {
  const groups = computeGroups();
  state.currentGroups = groups;
  els.groupsList.innerHTML = '';

  groups.forEach((g, idx) => {
    const startIdx = g.pageIndices[0];
    if (!state.groupFields.has(startIdx)) {
      state.groupFields.set(startIdx, { date: '', doctor: '', amount: '' });
    }
    const fields = state.groupFields.get(startIdx);

    const card = document.createElement('div');
    card.className = 'group-card';

    const title = document.createElement('h3');
    const last = g.pageIndices[g.pageIndices.length - 1];
    const pageLabel = g.pageIndices.length === 1 ? `Seite ${startIdx + 1}` : `Seiten ${startIdx + 1}–${last + 1}`;
    title.textContent = `Rechnung ${idx + 1} · ${pageLabel}`;
    card.appendChild(title);

    card.appendChild(makeField('Rechnungsdatum', 'date', fields, 'date'));
    card.appendChild(makeField('Arzt / Praxis', 'doctor', fields, 'text', null, 'z. B. Dr. Müller'));
    card.appendChild(makeField('Betrag (€)', 'amount', fields, 'text', 'decimal', 'z. B. 123,45'));

    els.groupsList.appendChild(card);
  });
}

function makeField(labelText, key, fields, type, inputmode, placeholder) {
  const wrap = document.createElement('label');
  wrap.className = 'field';

  const span = document.createElement('span');
  span.textContent = labelText;
  wrap.appendChild(span);

  const input = document.createElement('input');
  input.type = type;
  if (inputmode) input.inputMode = inputmode;
  if (placeholder) input.placeholder = placeholder;
  input.value = fields[key];
  input.addEventListener('input', () => {
    fields[key] = input.value;
  });
  wrap.appendChild(input);

  return wrap;
}

/* ---------- PDFs erzeugen ---------- */

async function generatePdfs() {
  if (!state.pdfBytes) return;
  els.generateBtn.disabled = true;
  setStatus('Erzeuge PDFs …');
  try {
    const srcDoc = await PDFLib.PDFDocument.load(state.pdfBytes.slice(0));
    const groups = state.currentGroups.length ? state.currentGroups : computeGroups();
    const results = [];
    const historyEntries = [];

    for (const g of groups) {
      const startIdx = g.pageIndices[0];
      const fields = state.groupFields.get(startIdx) || { date: '', doctor: '', amount: '' };

      const newDoc = await PDFLib.PDFDocument.create();
      const copiedPages = await newDoc.copyPages(srcDoc, g.pageIndices);
      copiedPages.forEach((p) => newDoc.addPage(p));
      const bytes = await newDoc.save();

      const filename = buildFilename(fields);
      const blob = new Blob([bytes], { type: 'application/pdf' });

      results.push({ filename, blob, pageIndices: g.pageIndices });
      historyEntries.push({
        date: fields.date || todayISO(),
        doctor: (fields.doctor || 'unbekannt').trim() || 'unbekannt',
        amount: normalizeAmount(fields.amount) ?? 0,
        filename,
        createdAt: new Date().toISOString(),
      });
    }

    state.results = results;
    renderResults();
    appendHistory(historyEntries);

    els.resultsSection.hidden = false;
    setStatus(`${results.length} PDF${results.length === 1 ? '' : 's'} erzeugt.`);
    els.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    setStatus('Fehler beim Erzeugen der PDFs: ' + (err && err.message ? err.message : err));
  } finally {
    els.generateBtn.disabled = false;
  }
}

/* ---------- Dateiname ---------- */

function buildFilename(fields) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(fields.date || '') ? fields.date : todayISO();
  const doctor = sanitizeForFilename(fields.doctor || 'unbekannt');
  const amount = formatAmountForFilename(fields.amount);
  return `${date}_${doctor}_${amount}.pdf`;
}

function sanitizeForFilename(str) {
  const cleaned = String(str)
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'unbekannt';
}

function normalizeAmount(input) {
  if (!input) return null;
  let s = String(input).trim().replace(/[€\s]/g, '');
  if (s === '') return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    s = s.replace(',', '.');
  }
  const num = parseFloat(s);
  return Number.isFinite(num) ? num : null;
}

function formatAmountForFilename(amountStr) {
  const num = normalizeAmount(amountStr);
  if (num === null) return '0,00';
  return num.toFixed(2).replace('.', ',');
}

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatDateDisplay(iso) {
  if (!iso) return '';
  const parts = String(iso).split('-');
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}.${m}.${y}`;
}

/* ---------- Ergebnisse: Teilen / Herunterladen ---------- */

function renderResults() {
  els.resultsList.innerHTML = '';

  state.results.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'result-card';

    const name = document.createElement('p');
    name.className = 'result-filename';
    name.textContent = r.filename;
    card.appendChild(name);

    const pagesInfo = document.createElement('p');
    pagesInfo.className = 'result-pages';
    const last = r.pageIndices[r.pageIndices.length - 1];
    pagesInfo.textContent =
      r.pageIndices.length === 1 ? `Seite ${r.pageIndices[0] + 1}` : `Seiten ${r.pageIndices[0] + 1}–${last + 1}`;
    card.appendChild(pagesInfo);

    const actions = document.createElement('div');
    actions.className = 'result-actions';

    const file = new File([r.blob], r.filename, { type: 'application/pdf' });

    if (canShareFiles([file])) {
      const shareBtn = document.createElement('button');
      shareBtn.type = 'button';
      shareBtn.className = 'btn btn-primary';
      shareBtn.textContent = '📤 Teilen';
      shareBtn.addEventListener('click', () => shareFiles([file], r.filename));
      actions.appendChild(shareBtn);
    }

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'btn btn-secondary';
    dlBtn.textContent = '⬇️ Herunterladen';
    dlBtn.addEventListener('click', () => downloadBlob(r.blob, r.filename));
    actions.appendChild(dlBtn);

    card.appendChild(actions);
    els.resultsList.appendChild(card);
  });

  const allFiles = state.results.map((r) => new File([r.blob], r.filename, { type: 'application/pdf' }));
  els.shareAllBtn.hidden = !(allFiles.length > 1 && canShareFiles(allFiles));
}

function canShareFiles(files) {
  return !!(navigator.canShare && navigator.share && navigator.canShare({ files }));
}

async function shareFiles(files, title) {
  try {
    await navigator.share({ files, title: title || 'Arztrechnung' });
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      console.error(err);
      setStatus('Teilen fehlgeschlagen – bitte stattdessen herunterladen.');
    }
  }
}

function onShareAll() {
  const allFiles = state.results.map((r) => new File([r.blob], r.filename, { type: 'application/pdf' }));
  shareFiles(allFiles, 'Arztrechnungen');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ---------- Verlauf (localStorage) ---------- */

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Verlauf konnte nicht gelesen werden', err);
    return [];
  }
}

function saveHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch (err) {
    console.error('Verlauf konnte nicht gespeichert werden (Speicher voll?)', err);
  }
}

function appendHistory(entries) {
  const list = loadHistory();
  list.push(...entries);
  saveHistory(list);
  renderHistory();
}

function renderHistory() {
  const list = loadHistory();
  els.historyList.innerHTML = '';

  if (list.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Noch keine Rechnungen erfasst.';
    els.historyList.appendChild(p);
    return;
  }

  const table = document.createElement('table');
  table.className = 'history-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Datum</th><th>Arzt</th><th>Betrag</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  list
    .slice()
    .reverse()
    .forEach((entry) => {
      const tr = document.createElement('tr');
      const amountText =
        typeof entry.amount === 'number' ? `${entry.amount.toFixed(2).replace('.', ',')} €` : String(entry.amount);

      const dateTd = document.createElement('td');
      dateTd.textContent = formatDateDisplay(entry.date);
      const doctorTd = document.createElement('td');
      doctorTd.textContent = entry.doctor;
      const amountTd = document.createElement('td');
      amountTd.textContent = amountText;

      tr.appendChild(dateTd);
      tr.appendChild(doctorTd);
      tr.appendChild(amountTd);
      tbody.appendChild(tr);
    });
  table.appendChild(tbody);
  els.historyList.appendChild(table);
}

function onClearHistory() {
  if (!confirm('Verlauf wirklich löschen? Dies kann nicht rückgängig gemacht werden.')) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

/* ---------- CSV-Export ---------- */

function onExportCsv() {
  const list = loadHistory();
  if (list.length === 0) {
    setStatus('Verlauf ist leer – nichts zu exportieren.');
    return;
  }

  const rows = [['Datum', 'Arzt', 'Betrag']];
  list.forEach((e) => {
    const amount =
      typeof e.amount === 'number' ? e.amount.toFixed(2).replace('.', ',') : String(e.amount).replace('.', ',');
    rows.push([formatDateDisplay(e.date), e.doctor, amount]);
  });

  const csv = rows.map((row) => row.map(csvEscape).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `arztrechnungen_verlauf_${todayISO()}.csv`);
}

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  if (/[;"\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/* ---------- Hilfsfunktionen ---------- */

function setStatus(msg) {
  els.uploadStatus.textContent = msg;
}

function resetSession() {
  state.pdfBytes = null;
  state.pdfDocForRender = null;
  state.numPages = 0;
  state.pages = [];
  state.groupFields = new Map();
  state.currentGroups = [];
  state.results = [];

  clearCapturedPages();
  els.captureSection.hidden = true;

  els.pagesList.innerHTML = '';
  els.groupsList.innerHTML = '';
  els.resultsList.innerHTML = '';
  els.pagesSection.hidden = true;
  els.groupsSection.hidden = true;
  els.resultsSection.hidden = true;
  els.shareAllBtn.hidden = true;
  els.fileInput.value = '';
  setStatus('');
}
