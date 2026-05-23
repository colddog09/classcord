/* ============================================================
 *  플래시카드 — 메인 스크립트
 * ============================================================ */
'use strict';

/* ============================================================
 *  Firebase 설정
 *  Firebase Console > 프로젝트 설정 > 내 앱 > SDK 설정의 값을 넣어주세요
 * ============================================================ */
// Firebase 설정은 firebase-config.js 에서 window.FIREBASE_CONFIG 로 주입됩니다.
// (해당 파일은 .gitignore 처리되어 저장소에 포함되지 않습니다)
const FIREBASE_CONFIG = window.FIREBASE_CONFIG || {};

/* ----------- 상수 ----------- */
const STORAGE_KEY  = 'flashcard.sets.v1';
const SETTINGS_KEY = 'flashcard.settings.v1';
const THEME_KEY    = 'flashcard.theme.v1';
const STATS_KEY    = 'flashcard.stats.v1';

/* ----------- 전역 상태 ----------- */
const state = {
  currentView: 'home',
  sets: [],
  currentSetId: null,
  editDraft: null,
  setupConfig: {
    mode: 'word',
    order: 'sequential',
    filter: 0,
    chunkEnabled: false,
    chunkSize: 10,
  },
  session: null,
  stats: {},
};

/* ----------- Firebase 전역 ----------- */
let fbAuth = null;
let fbDb   = null;
let fbUser = null;
let syncTimer = null;

/* ----------- DOM 헬퍼 ----------- */
const $  = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function uid() {
  return 'set-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/* ============================================================
 *  영속화
 * ============================================================ */
function loadAll() {
  try { state.sets = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { state.sets = []; }
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (s) Object.assign(state.setupConfig, JSON.parse(s));
  } catch {}
  try { state.stats = JSON.parse(localStorage.getItem(STATS_KEY) || '{}'); }
  catch { state.stats = {}; }
  // 기본 샘플 세트 없음 — 사용자가 직접 만든 세트만 사용
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sets));
}

function saveSets() {
  saveLocal();
  cloudSyncDebounced();
}

const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.setupConfig));
const saveStats    = () => localStorage.setItem(STATS_KEY,    JSON.stringify(state.stats));

function cloudSyncDebounced() {
  if (!fbDb || !fbUser) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncToFirestore, 1500);
}

async function syncToFirestore() {
  if (!fbDb || !fbUser) return;
  try {
    const batch = fbDb.batch();
    const base = fbDb.collection('users').doc(fbUser.uid).collection('sets');
    for (const s of state.sets) {
      batch.set(base.doc(s.id), s);
    }
    await batch.commit();
    const now = Date.now();
    localStorage.setItem('flashcard.lastSync.v1', String(now));
    renderSyncTime(now);
  } catch(e) { console.warn('Firestore sync failed:', e); }
}

function renderSyncTime(ts) {
  const el = $('#syncTimeLabel');
  if (!el) return;
  if (!ts) { el.textContent = ''; return; }
  const diff = Math.floor((Date.now() - ts) / 1000);
  let label;
  if (diff < 10)       label = '방금 동기화됨';
  else if (diff < 60)  label = `${diff}초 전 동기화`;
  else if (diff < 3600) label = `${Math.floor(diff/60)}분 전 동기화`;
  else if (diff < 86400) label = `${Math.floor(diff/3600)}시간 전 동기화`;
  else                 label = `${Math.floor(diff/86400)}일 전 동기화`;
  el.textContent = '☁ ' + label;
}

async function deleteFromFirestore(id) {
  if (!fbDb || !fbUser) return;
  try {
    await fbDb.collection('users').doc(fbUser.uid).collection('sets').doc(id).delete();
  } catch(e) { console.warn('Firestore delete failed:', e); }
}

async function loadFromFirestore() {
  if (!fbDb || !fbUser) return;
  try {
    const snap = await fbDb.collection('users').doc(fbUser.uid).collection('sets').get();
    if (!snap.empty) {
      state.sets = snap.docs.map(d => d.data());
      saveLocal();
      renderHome();
      toast('☁ 클라우드에서 불러왔습니다');
    } else if (state.sets.length) {
      // 로컬 데이터를 클라우드에 첫 업로드
      await syncToFirestore();
    }
  } catch(e) { console.warn('Firestore load failed:', e); }
}


const getSet = id => state.sets.find(s => s.id === id);

function avgRating(set) {
  if (!set.cards.length) return 0;
  let total = 0;
  for (let i = 0; i < set.cards.length; i++) total += (set.starRatings[i] || 0);
  return total / set.cards.length;
}

function formatDate(ts) {
  if (!ts) return '아직 학습 안 함';
  const d = new Date(ts);
  const diff = Math.floor((Date.now() - d) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  if (diff < 7)  return diff + '일 전';
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

/* ============================================================
 *  뷰 라우팅
 * ============================================================ */
function showView(name) {
  state.currentView = name;
  $$('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(name + 'View');
  if (el) el.classList.add('active');
  // 학습 화면에서는 body 스크롤 잠금
  document.body.style.overflow = (name === 'study') ? 'hidden' : '';
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ============================================================
 *  HOME 뷰
 * ============================================================ */
function renderHome() {
  const lastSync = parseInt(localStorage.getItem('flashcard.lastSync.v1') || '0', 10);
  renderSyncTime(lastSync || null);
  const list = $('#setList');
  if (!state.sets.length) {
    list.innerHTML = `<div class="empty-state">
      <span class="emoji">📭</span>
      <h3>아직 단어장이 없습니다</h3>
      <p>"새 단어장 만들기"로 시작해 보세요</p>
    </div>`;
    return;
  }
  list.innerHTML = state.sets.map((s, idx) => {
    const avg = avgRating(s);
    const rd  = Math.round(avg);
    const stars = '★'.repeat(rd);
    const badge = s.type === 'history' ? '역사' : '단어';
    return `
      <div class="ql-set-row" data-action="open-detail" data-id="${s.id}" style="animation-delay:${idx*30}ms;">
        <span class="ql-badge">${badge}</span>
        <span class="ql-row-name">${escapeHtml(s.name)}</span>
        <span class="ql-row-count">${s.cards.length} 카드</span>
        ${stars ? `<span class="ql-row-stars">${stars}</span>` : ''}
      </div>
    `;
  }).join('');
}

$('#newSetBtn').addEventListener('click', () => openEdit(null));
$('#logoBtn').addEventListener('click', () => { showView('home'); renderHome(); });

$('#setList').addEventListener('click', e => {
  const row = e.target.closest('[data-action="open-detail"]');
  if (row) { openDetail(row.dataset.id); return; }
});

/* ============================================================
 *  SET DETAIL 뷰
 * ============================================================ */
function openDetail(id) {
  const s = getSet(id);
  if (!s) return;
  state.currentSetId = id;
  $('#detailBanner').style.background = s.themeColor || '#8bc34a';
  $('#detailName').textContent = s.name;
  $('#detailMeta').textContent = `${s.cards.length} 카드 | ${formatDate(s.lastStudied)}`;
  document.querySelector('.detail-badge').textContent = s.type === 'history' ? '역사' : '단어';
  const isHistory = (s.type || 'vocab') === 'history';
  $('#detailGrid').innerHTML = s.cards.map((c, i) => {
    const rating = s.starRatings[i] || 0;
    const stars = [1,2,3].map(n =>
      `<button class="dc-star-btn ${n <= rating ? 'filled' : ''}" data-card-idx="${i}" data-star="${n}" title="${n}★">★</button>`
    ).join('');
    return `<div class="detail-card" data-idx="${i}" data-flipped="false">
      <div class="detail-card-inner">
        <div class="detail-card-front">
          <div class="detail-card-word">${escapeHtml(c.word || c.meaning)}</div>
          ${!isHistory && c.phonetic ? `<div class="detail-card-phonetic">${escapeHtml(c.phonetic)}</div>` : ''}
          <div class="dc-stars">${stars}</div>
        </div>
        <div class="detail-card-back">
          <div class="detail-card-meaning">${escapeHtml(c.meaning || c.word)}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  showView('detail');
}

// 상세 뷰 배너 버튼
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-daction]');
  if (!btn) return;
  const id = state.currentSetId;
  switch (btn.dataset.daction) {
    case 'edit':   openEdit(id); break;
    case 'export': exportSet(id); break;
    case 'delete': confirmDelete(id); break;
  }
});

$('#detailGrid').addEventListener('click', e => {
  const s = getSet(state.currentSetId);
  if (!s) return;

  // 별점 버튼 클릭
  const starBtn = e.target.closest('.dc-star-btn');
  if (starBtn) {
    e.stopPropagation();
    const idx = parseInt(starBtn.dataset.cardIdx, 10);
    const val = parseInt(starBtn.dataset.star, 10);
    const cur = s.starRatings[idx] || 0;
    s.starRatings[idx] = (cur === val) ? 0 : val;
    saveSets();
    const card = starBtn.closest('.detail-card');
    card.querySelectorAll('.dc-star-btn').forEach(b => {
      b.classList.toggle('filled', parseInt(b.dataset.star) <= (s.starRatings[idx] || 0));
    });
    return;
  }

  // 카드 뒤집기
  const card = e.target.closest('.detail-card');
  if (!card) return;
  const flipped = card.dataset.flipped === 'true';
  card.dataset.flipped = String(!flipped);
  card.classList.toggle('flipped', !flipped);
});

$('#detailBackBtn').addEventListener('click', () => { showView('home'); renderHome(); });
$('#detailStudyBtn').addEventListener('click', () => openSetup(state.currentSetId));

// ops 드롭다운
const opsBtn      = $('#opsExtractBtn');
const opsDropdown = $('#opsDropdown');
opsBtn.addEventListener('click', e => {
  e.stopPropagation();
  opsDropdown.classList.toggle('open');
});
document.addEventListener('click', () => opsDropdown.classList.remove('open'));

opsDropdown.addEventListener('click', e => {
  const item = e.target.closest('[data-op]');
  if (!item) return;
  opsDropdown.classList.remove('open');
  const id = state.currentSetId;
  switch (item.dataset.op) {
    case 'clone':         cloneSet(id); break;
    case 'star-extract':  openStarPicker(id); break;
    case 'extract-cards': openCardPicker([id], '카드 선택해 새 단어장으로'); break;
    case 'merge-sets':    openCardPicker(state.sets.map(s => s.id), '여러 세트 카드 합치기', true); break;
  }
});

// --- 세트 복제 ---
function cloneSet(id) {
  const s = getSet(id);
  if (!s) return;
  const clone = JSON.parse(JSON.stringify(s));
  clone.id = uid();
  clone.name = s.name + ' (복사본)';
  clone.lastStudied = null;
  state.sets.push(clone);
  saveSets();
  toast(`✅ "${clone.name}" 복제됐습니다`);
  renderHome();
}

// --- CSV 내보내기 ---
function exportSet(id) {
  const s = getSet(id);
  if (!s) return;
  const isHistory = (s.type || 'vocab') === 'history';
  const header = isHistory ? 'front,back' : 'word,phonetic,meaning';
  const rows = s.cards.map(c =>
    isHistory
      ? [c.word, c.meaning].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
      : [c.word, c.phonetic, c.meaning].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
  );
  const csv = [header, ...rows].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = (s.name || 'flashcards') + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('⬇ CSV로 내보냈습니다');
}

function confirmDelete(id) {
  const s = getSet(id);
  if (!s) return;
  showModal(`'${s.name}' 삭제`, '이 단어장을 정말 삭제할까요? 되돌릴 수 없습니다.', () => {
    state.sets = state.sets.filter(x => x.id !== id);
    saveSets();
    deleteFromFirestore(id);
    delete state.stats[id];
    saveStats();
    showView('home');
    renderHome();
    toast('🗑 삭제했습니다');
  });
}

/* ============================================================
 *  별점 필터 추출 (Star Picker)
 * ============================================================ */
let spMinStar = 1;

function openStarPicker(id) {
  const s = getSet(id);
  if (!s) return;
  spMinStar = 1;
  $('#spName').value = s.name + ' ★필터';
  updateSpPreview(id);
  // chip 초기화
  $$('#starPickerRow .sp-chip').forEach(c => c.classList.toggle('active', parseInt(c.dataset.min) === 1));
  $('#starPickerModal').classList.add('show');
}

function updateSpPreview(id) {
  const s = getSet(id || state.currentSetId);
  if (!s) return;
  const matched = s.cards.filter((_, i) => (s.starRatings[i] || 0) >= spMinStar);
  $('#spPreview').textContent = `✓ 조건에 맞는 카드: ${matched.length}개`;
}

$('#starPickerRow').addEventListener('click', e => {
  const c = e.target.closest('.sp-chip');
  if (!c) return;
  spMinStar = parseInt(c.dataset.min);
  $$('#starPickerRow .sp-chip').forEach(x => x.classList.toggle('active', x === c));
  updateSpPreview();
});

$('#spCancel').addEventListener('click', () => $('#starPickerModal').classList.remove('show'));
$('#spConfirm').addEventListener('click', () => {
  const s = getSet(state.currentSetId);
  if (!s) return;
  const name = $('#spName').value.trim() || (s.name + ' ★필터');
  const cards = s.cards.filter((_, i) => (s.starRatings[i] || 0) >= spMinStar);
  if (!cards.length) { toast('⚠ 조건에 맞는 카드가 없습니다'); return; }
  state.sets.push({ id: uid(), name, themeColor: s.themeColor || '#3B82F6', lastStudied: null, starRatings: {}, cards });
  saveSets();
  renderHome();
  $('#starPickerModal').classList.remove('show');
  toast(`✅ "${name}" (${cards.length}개) 만들었습니다`);
});

/* ============================================================
 *  카드 선택 피커 (Card Picker)
 * ============================================================ */
let cpSetIds  = [];
let cpAllCards = []; // { setId, cardIdx, card }
let cpSelected = new Set(); // "setId:cardIdx"
let cpActiveSet = null;

function openCardPicker(setIds, title, multiSet = false) {
  cpSetIds = setIds.filter(id => getSet(id));
  if (!cpSetIds.length) return;
  cpSelected = new Set();
  cpActiveSet = cpSetIds[0];
  $('#cpickerTitle').textContent = title;
  $('#cpickerName').value = '';
  renderCpSetTabs(multiSet);
  renderCpCards();
  updateCpCount();
  $('#cardPicker').classList.add('show');
}

function renderCpSetTabs(multi) {
  const tabs = $('#cpickerSetTabs');
  if (!multi && cpSetIds.length === 1) { tabs.innerHTML = ''; return; }
  tabs.innerHTML = cpSetIds.map(id => {
    const s = getSet(id);
    return `<button class="cp-tab ${id === cpActiveSet ? 'active' : ''}" data-sid="${id}">${escapeHtml(s.name)}</button>`;
  }).join('');
  tabs.addEventListener('click', e => {
    const btn = e.target.closest('[data-sid]');
    if (!btn) return;
    cpActiveSet = btn.dataset.sid;
    $$('.cp-tab').forEach(t => t.classList.toggle('active', t.dataset.sid === cpActiveSet));
    renderCpCards();
  });
}

function renderCpCards() {
  const s = getSet(cpActiveSet);
  if (!s) return;
  $('#cpickerCards').innerHTML = s.cards.map((c, i) => {
    const key = `${cpActiveSet}:${i}`;
    const checked = cpSelected.has(key);
    const star = s.starRatings[i] || 0;
    return `<label class="cp-card ${checked ? 'checked' : ''}" data-key="${key}">
      <input type="checkbox" ${checked ? 'checked' : ''} />
      <span class="cp-star">${'★'.repeat(star)}</span>
      <span class="cp-word">${escapeHtml(c.word)}</span>
      <span class="cp-meaning">${escapeHtml(c.meaning)}</span>
    </label>`;
  }).join('');

  $('#cpickerCards').addEventListener('change', e => {
    const lbl = e.target.closest('[data-key]');
    if (!lbl) return;
    const key = lbl.dataset.key;
    if (e.target.checked) { cpSelected.add(key); lbl.classList.add('checked'); }
    else { cpSelected.delete(key); lbl.classList.remove('checked'); }
    updateCpCount();
  });
}

function updateCpCount() {
  $('#cpickerCount').textContent = `${cpSelected.size}개 선택됨`;
}

$('#cpickerClose').addEventListener('click', () => $('#cardPicker').classList.remove('show'));

$('#cpickerConfirm').addEventListener('click', () => {
  const name = $('#cpickerName').value.trim();
  if (!name) { $('#cpickerName').focus(); toast('⚠ 단어장 이름을 입력하세요'); return; }
  if (!cpSelected.size) { toast('⚠ 카드를 1개 이상 선택하세요'); return; }

  const cards = [];
  for (const key of cpSelected) {
    const [sid, idx] = key.split(':');
    const s = getSet(sid);
    if (s && s.cards[parseInt(idx)]) cards.push({ ...s.cards[parseInt(idx)] });
  }
  if (!cards.length) return;

  state.sets.push({ id: uid(), name, themeColor: '#3B82F6', lastStudied: null, starRatings: {}, cards });
  saveSets();
  renderHome();
  $('#cardPicker').classList.remove('show');
  toast(`✅ "${name}" (${cards.length}개 카드) 만들었습니다`);
});

/* ============================================================
 *  CSV 가져오기
 * ============================================================ */
$('#importCsvBtn').addEventListener('click', () => $('#csvFileInput').click());
$('#csvFileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const lines = reader.result.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) { toast('⚠ 파일이 비어 있습니다'); return; }

      // 헤더 감지: front,back → 역사 세트 / word,phonetic,meaning → 단어 세트
      const firstCell = lines[0].split(',')[0].trim().replace(/^"|"$/g, '').toLowerCase();
      const isHistoryCsv = firstCell === 'front' || firstCell === '앞면';
      const isVocabHeader = firstCell === 'word' || firstCell === '단어' || isHistoryCsv;
      const startIdx = isVocabHeader ? 1 : 0;
      const setType  = isHistoryCsv ? 'history' : 'vocab';

      const cards = [];
      for (const line of lines.slice(startIdx)) {
        // CSV 파싱: 따옴표 안의 쉼표 처리
        const cols = line.match(/("([^"]*(?:""[^"]*)*)"|[^,]*)/g)
          ?.map(c => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"')) || [];
        if (isHistoryCsv) {
          const [f, b] = cols;
          if (f) cards.push({ word: f, phonetic: '', meaning: b || '' });
        } else {
          const [w, p, m] = cols;
          if (w) cards.push({ word: w, phonetic: p || '', meaning: m || '' });
        }
      }
      if (!cards.length) { toast('⚠ 유효한 카드가 없습니다'); return; }
      const setName = file.name.replace(/\.csv$/i, '');
      const themeColor = isHistoryCsv ? '#8B5CF6' : '#3B82F6'; // 역사 세트는 보라색
      state.sets.push({ id: uid(), name: setName, type: setType, themeColor, lastStudied: null, starRatings: {}, cards });
      saveSets();
      renderHome();
      toast(`✅ "${setName}" (${cards.length}개 카드) 가져왔습니다`);
    } catch(err) { console.error(err); toast('❌ CSV 파일을 읽을 수 없습니다'); }
    e.target.value = '';
  };
  reader.readAsText(file, 'UTF-8');
});

/* ============================================================
 *  EDIT 뷰
 * ============================================================ */
function openEdit(id) {
  if (id) {
    const s = getSet(id);
    if (!s) return;
    state.editDraft = JSON.parse(JSON.stringify(s));
    $('#editTitle').textContent = '단어장 편집';
  } else {
    state.editDraft = {
      id: uid(), name: '', themeColor: '#3B82F6', type: 'vocab',
      lastStudied: null, starRatings: {},
      cards: [{ word: '', phonetic: '', meaning: '' }],
    };
    $('#editTitle').textContent = '새 단어장';
  }
  $('#editNameInput').value  = state.editDraft.name;
  $('#editColorInput').value = state.editDraft.themeColor || '#3B82F6';
  syncColorPreview();
  applySetType(state.editDraft.type || 'vocab');
  renderEditTable();
  showView('edit');
}

function applySetType(type) {
  state.editDraft.type = type;
  const isHistory = type === 'history';
  // 칩 활성화
  $$('#setTypeChips .option-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.type === type)
  );
  // 테이블 헤더 변경
  $('#thWord').textContent    = isHistory ? '앞면 (용어·사건)' : '단어';
  $('#thMeaning').textContent = isHistory ? '뒷면 (설명·내용)' : '뜻';
  // 발음 컬럼 숨기기/보이기
  const phoneCols = document.querySelectorAll('.col-phonetic, [data-field="phonetic"]');
  phoneCols.forEach(el => { el.style.display = isHistory ? 'none' : ''; });
  // 스피커 버튼 숨기기
  document.querySelectorAll('.preview-btn').forEach(el => {
    el.style.display = isHistory ? 'none' : '';
  });
}

$('#setTypeChips').addEventListener('click', e => {
  const chip = e.target.closest('[data-type]');
  if (!chip) return;
  applySetType(chip.dataset.type);
  renderEditTable();
});

function syncColorPreview() {
  $('#colorPreview').style.background = state.editDraft.themeColor;
}

function renderEditTable() {
  const tbody = $('#editTableBody');
  const isHistory = (state.editDraft?.type || 'vocab') === 'history';
  const wordPh    = isHistory ? '앞면 (용어·사건)' : '단어';
  const meaningPh = isHistory ? '뒷면 (설명·내용)' : '뜻';
  tbody.innerHTML = state.editDraft.cards.map((c, i) => `
    <tr data-idx="${i}">
      <td class="row-num">${i + 1}</td>
      <td>
        <div class="word-cell">
          <input type="text" data-field="word"     value="${escapeHtml(c.word)}"     placeholder="${wordPh}" />
          <button class="preview-btn" data-action="preview" title="발음 미리듣기">🔊</button>
        </div>
      </td>
      <td class="col-phonetic"><input type="text" data-field="phonetic" value="${escapeHtml(c.phonetic)}" placeholder="/발음/" /></td>
      <td><input type="text" data-field="meaning"  value="${escapeHtml(c.meaning)}"  placeholder="${meaningPh}" /></td>
      <td class="row-actions">
        <button class="btn danger sm" data-action="delete-row" title="삭제">🗑</button>
      </td>
    </tr>
  `).join('');
  $('#cardCount').textContent = `총 ${state.editDraft.cards.length}개 카드`;
  // DOM이 재생성됐으므로 타입 표시 상태 재적용
  if (state.editDraft) applySetType(state.editDraft.type || 'vocab');
}

$('#editBackBtn').addEventListener('click', () => { showView('home'); renderHome(); });
$('#editNameInput').addEventListener('input', e => { state.editDraft.name = e.target.value; });
$('#editColorInput').addEventListener('input', e => {
  state.editDraft.themeColor = e.target.value;
  syncColorPreview();
});
$('#colorPreview').addEventListener('click', () => $('#editColorInput').click());

$('#editTableBody').addEventListener('input', e => {
  const tr = e.target.closest('tr'); if (!tr) return;
  const idx = parseInt(tr.dataset.idx, 10);
  const field = e.target.dataset.field;
  if (field && state.editDraft.cards[idx]) state.editDraft.cards[idx][field] = e.target.value;
});

$('#editTableBody').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]'); if (!btn) return;
  const tr  = btn.closest('tr');
  const idx = parseInt(tr.dataset.idx, 10);
  if (btn.dataset.action === 'delete-row') {
    tr.classList.add('removing');
    setTimeout(() => {
      state.editDraft.cards.splice(idx, 1);
      if (!state.editDraft.cards.length) state.editDraft.cards.push({ word:'', phonetic:'', meaning:'' });
      renderEditTable();
    }, 230);
  } else if (btn.dataset.action === 'preview') {
    const w = state.editDraft.cards[idx].word.trim();
    if (w) speakText(w);
  }
});

$('#addRowBtn').addEventListener('click', () => {
  state.editDraft.cards.push({ word:'', phonetic:'', meaning:'' });
  renderEditTable();
  const lastTr = $('#editTableBody tr:last-child');
  if (lastTr) {
    lastTr.classList.add('adding');
    const input = lastTr.querySelector('input[data-field="word"]');
    if (input) input.focus();
  }
});

$('#saveSetBtn').addEventListener('click', () => {
  const draft = state.editDraft;
  if (!draft.name.trim()) { toast('⚠ 단어장 이름을 입력해 주세요'); $('#editNameInput').focus(); return; }
  const valid = draft.cards.filter(c => c.word.trim() || c.meaning.trim());
  if (!valid.length) { toast('⚠ 최소 1개의 카드가 필요합니다'); return; }
  draft.cards = valid;
  const cleanRatings = {};
  for (const k in draft.starRatings) {
    const ki = parseInt(k, 10);
    if (ki < draft.cards.length) cleanRatings[ki] = draft.starRatings[k];
  }
  draft.starRatings = cleanRatings;
  const idx = state.sets.findIndex(s => s.id === draft.id);
  if (idx >= 0) state.sets[idx] = draft; else state.sets.push(draft);
  saveSets();
  toast('💾 저장했습니다');
  showView('home');
  renderHome();
});

/* ============================================================
 *  SETUP 뷰
 * ============================================================ */
function openSetup(id) {
  state.currentSetId = id;
  const s = getSet(id);
  const isHistory = (s.type || 'vocab') === 'history';
  $('#setupTitle').textContent = s.name + ' — 학습 설정';
  // 모드 칩 레이블 업데이트 (역사 세트)
  const [wordChip, meaningChip] = $$('#modeChips .option-chip');
  if (isHistory) {
    if (wordChip)    wordChip.innerHTML    = '앞면 제시 <small>앞면: 용어</small>';
    if (meaningChip) meaningChip.innerHTML = '뒷면 제시 <small>앞면: 뜻</small>';
  } else {
    if (wordChip)    wordChip.innerHTML    = '단어 제시 <small>앞면: 단어</small>';
    if (meaningChip) meaningChip.innerHTML = '뜻 제시 <small>앞면: 뜻</small>';
  }
  setChips('modeChips',   'mode',   state.setupConfig.mode);
  setChips('orderChips',  'order',  state.setupConfig.order);
  setChips('filterChips', 'filter', String(state.setupConfig.filter));
  setChunkToggle(state.setupConfig.chunkEnabled);
  $('#chunkSize').value = state.setupConfig.chunkSize;
  updateMatchInfo();
  showView('setup');
}

function setChips(containerId, key, value) {
  $$(`#${containerId} .option-chip`).forEach(chip =>
    chip.classList.toggle('active', chip.dataset[key] === String(value))
  );
}

function setChunkToggle(on) {
  $('#chunkToggle').classList.toggle('on', on);
  $('#chunkLabel').textContent = on ? '한 번에' : '한 번에 모든 카드 학습';
  $('#chunkSize').hidden = !on;
  $('#chunkUnit').hidden = !on;
}

$('#modeChips').addEventListener('click', e => {
  const c = e.target.closest('.option-chip'); if (!c) return;
  state.setupConfig.mode = c.dataset.mode;
  setChips('modeChips', 'mode', state.setupConfig.mode);
});
$('#orderChips').addEventListener('click', e => {
  const c = e.target.closest('.option-chip'); if (!c) return;
  state.setupConfig.order = c.dataset.order;
  setChips('orderChips', 'order', state.setupConfig.order);
});
$('#filterChips').addEventListener('click', e => {
  const c = e.target.closest('.option-chip'); if (!c) return;
  state.setupConfig.filter = parseInt(c.dataset.filter, 10);
  setChips('filterChips', 'filter', String(state.setupConfig.filter));
  updateMatchInfo();
});
$('#chunkToggle').addEventListener('click', () => {
  state.setupConfig.chunkEnabled = !state.setupConfig.chunkEnabled;
  setChunkToggle(state.setupConfig.chunkEnabled);
});
$('#chunkToggle').addEventListener('keydown', e => {
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); $('#chunkToggle').click(); }
});
$('#chunkSize').addEventListener('input', e => {
  state.setupConfig.chunkSize = Math.max(1, parseInt(e.target.value, 10) || 1);
});
$('#setupBackBtn').addEventListener('click', () => { showView('home'); renderHome(); });

function getFilteredIndices(set, filter) {
  const out = [];
  for (let i = 0; i < set.cards.length; i++)
    if ((set.starRatings[i] || 0) >= filter) out.push(i);
  return out;
}

function updateMatchInfo() {
  const s = getSet(state.currentSetId);
  if (!s) return;
  const idxs = getFilteredIndices(s, state.setupConfig.filter);
  const info = $('#matchInfo'), startBtn = $('#startSessionBtn');
  if (!idxs.length) {
    info.textContent = '⚠ 조건에 맞는 카드가 없습니다. 필터를 조정해 주세요.';
    info.classList.add('warn'); startBtn.disabled = true;
  } else {
    info.innerHTML = `✓ 조건에 맞는 카드: <strong>${idxs.length}개</strong>`;
    info.classList.remove('warn'); startBtn.disabled = false;
  }
}

$('#startSessionBtn').addEventListener('click', () => { saveSettings(); startSession(0); });

/* ============================================================
 *  STUDY 뷰
 * ============================================================ */
function startSession(offset, customIdxs) {
  const s = getSet(state.currentSetId);
  if (!s) return;
  let idxs = customIdxs || getFilteredIndices(s, state.setupConfig.filter);
  if (!idxs.length) { toast('⚠ 학습할 카드가 없습니다'); return; }

  if (state.setupConfig.order === 'random') {
    idxs = idxs.slice();
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
  }

  let sessionIdxs;
  if (state.setupConfig.chunkEnabled) {
    sessionIdxs = idxs.slice(offset, offset + state.setupConfig.chunkSize);
  } else {
    sessionIdxs = idxs; offset = 0;
  }
  if (!sessionIdxs.length) { toast('⚠ 학습할 카드가 없습니다'); return; }

  state.session = {
    setId: s.id, allFilteredIdxs: idxs, cardIdxs: sessionIdxs, offset,
    pos: 0, mode: state.setupConfig.mode, flipped: false, hintShown: true,
    unknownSet: new Set(), knownCount: 0, revealed: false,
  };
  showView('study');
  renderStudy();
}

function renderStudy() {
  const sess    = state.session;
  const set     = getSet(sess.setId);
  const cardIdx = sess.cardIdxs[sess.pos];
  const card    = set.cards[cardIdx];

  const knownN = sess.knownCount || 0;
  const totalN = sess.cardIdxs.length;
  const isHistory = (set.type || 'vocab') === 'history';
  $('#knownCount').textContent = knownN;
  $('#totalCount').textContent = totalN;
  if (isHistory) {
    $('#modeBadge').textContent = sess.mode === 'word' ? '앞면 제시' : '뒷면 제시';
  } else {
    $('#modeBadge').textContent = sess.mode === 'word' ? '단어 제시' : '뜻 제시';
  }
  // 카드 내 진행 표시
  const pct = totalN > 0 ? (knownN / totalN) * 100 : 0;
  $('#svCardProgressFill').style.width = pct + '%';
  $('#svCardProgressLabel').textContent = `${knownN} / ${totalN} 학습 완료`;

  // 스피커 버튼 — 역사 세트는 TTS 불필요
  $('#speakBtn').style.display = isHistory ? 'none' : '';

  // 앞면
  const front = $('#svFront');
  if (sess.mode === 'word') {
    front.innerHTML = `<div class="sv-word">${escapeHtml(card.word)}</div>` +
      (!isHistory && card.phonetic ? `<div class="sv-phonetic">${escapeHtml(card.phonetic)}</div>` : '');
  } else {
    front.innerHTML = `<div class="sv-meaning-front">${escapeHtml(card.meaning)}</div>`;
  }

  // 뒷면 (항상 렌더링 - 커버 아래에 깔림)
  const back = $('#svBack');
  if (sess.mode === 'word') {
    back.innerHTML = `<div class="sv-meaning">${escapeHtml(card.meaning)}</div>`;
  } else {
    back.innerHTML = `<div class="sv-back-word">${escapeHtml(card.word)}</div>` +
      (!isHistory && card.phonetic ? `<div class="sv-back-phonetic">${escapeHtml(card.phonetic)}</div>` : '');
  }

  // 커버 초기화 (새 카드 → 완전히 덮기)
  sess.revealed = false;
  svCoverEl.style.transition = 'none';
  svCoverEl.style.transform  = 'translateY(0)';
  svCoverEl.classList.remove('hidden');
  $('#answerBtns').classList.remove('visible');
  $('#kbdRow').classList.add('hidden');

  // 별점
  const star = set.starRatings[cardIdx] || 0;
  $$('#starRow .star-btn').forEach(btn =>
    btn.classList.toggle('filled', parseInt(btn.dataset.star, 10) <= star)
  );
}

/* ---- 커버 드래그 (↓ 아래로 공개 / ↑ 위로 다시 덮기) ---- */
const COVER_HANDLE_H = 44;   // revealed 상태에서 핸들로 보이는 높이(px)
let coverDrag = null;
let suppressNextCardClick = false;
const svCoverEl = $('#svCover');

function coverRevealedY() {
  return (svCoverEl.offsetHeight || 220) - COVER_HANDLE_H;
}
function coverSetY(y, spring = false) {
  svCoverEl.style.transition = spring
    ? 'transform 0.38s cubic-bezier(0.34,1.56,0.64,1)'
    : 'none';
  svCoverEl.style.transform = `translateY(${y}px)`;
}

function startCoverDrag(e) {
  const sess = state.session;
  if (!sess) return;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  coverDrag = {
    startY:    clientY,
    delta:     0,
    moved:     false,
    revealing: !sess.revealed,   // false = 다시 덮기 모드
  };
  svCoverEl.style.transition = 'none';
}

function onCoverMove(e) {
  if (!coverDrag) return;
  if (e.cancelable) e.preventDefault();
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;

  if (coverDrag.revealing) {
    // ↓ 아래로 (공개)
    const d = Math.max(0, clientY - coverDrag.startY);
    if (d > 5) coverDrag.moved = true;
    coverDrag.delta = d;
    svCoverEl.style.transform = `translateY(${d}px)`;
  } else {
    // ↑ 위로 (다시 덮기) — 핸들에서 시작
    const d = Math.max(0, coverDrag.startY - clientY);
    if (d > 5) coverDrag.moved = true;
    coverDrag.delta = d;
    const newY = Math.max(0, coverRevealedY() - d);
    svCoverEl.style.transform = `translateY(${newY}px)`;
  }
}

function endCoverDrag() {
  document.removeEventListener('mousemove', onCoverMove);
  document.removeEventListener('mouseup',   endCoverDrag);
  document.removeEventListener('touchmove', onCoverMove);
  document.removeEventListener('touchend',  endCoverDrag);
  if (!coverDrag) return;

  const { delta, moved, revealing } = coverDrag;
  coverDrag = null;
  const height = svCoverEl.offsetHeight || 220;
  const threshold = height * 0.28;

  if (revealing) {
    if (!moved) { svCoverEl.style.transition = ''; return; }  // 클릭 이벤트에 위임
    suppressNextCardClick = true;
    setTimeout(() => { suppressNextCardClick = false; }, 100);
    if (delta > threshold) {
      revealCard(true); // true = 드래그에서 호출 (애니메이션 이미 진행 중)
    } else {
      coverSetY(0, true);
    }
  } else {
    if (!moved) return;
    if (delta > threshold) {
      recoverCard(true);
    } else {
      coverSetY(coverRevealedY(), true); // 핸들 위치로 복귀
    }
  }
}

svCoverEl.addEventListener('mousedown', e => {
  startCoverDrag(e);
  document.addEventListener('mousemove', onCoverMove);
  document.addEventListener('mouseup',   endCoverDrag);
});
svCoverEl.addEventListener('touchstart', e => {
  startCoverDrag(e);
  document.addEventListener('touchmove', onCoverMove, { passive: false });
  document.addEventListener('touchend',  endCoverDrag);
}, { passive: true });

/* ---- 커버 공개 / 다시 덮기 ---- */
function revealCard(fromDrag = false) {
  const sess = state.session;
  if (!sess || sess.revealed) return;
  sess.revealed = true;
  // 커버를 핸들 위치(아래)로 스프링 이동
  svCoverEl.style.transition = 'transform 0.40s cubic-bezier(0.4,0,0.2,1)';
  svCoverEl.style.transform  = `translateY(${coverRevealedY()}px)`;
  $('#answerBtns').classList.add('visible');
  $('#kbdRow').classList.remove('hidden');
  speakCurrent();
}

function recoverCard(fromDrag = false) {
  const sess = state.session;
  if (!sess || !sess.revealed) return;
  sess.revealed = false;
  svCoverEl.style.transition = 'transform 0.38s cubic-bezier(0.34,1.56,0.64,1)';
  svCoverEl.style.transform  = 'translateY(0)';
  $('#answerBtns').classList.remove('visible');
  $('#kbdRow').classList.add('hidden');
}

// 단순 탭(클릭) 핸들러
$('#svCard').addEventListener('click', e => {
  if (suppressNextCardClick) { suppressNextCardClick = false; return; }
  if (e.target.closest('#speakBtn')) return;
  if (e.target.closest('#svCover')) { revealCard(); return; }
});

$('#speakBtn').addEventListener('click', e => { e.stopPropagation(); speakCurrent(); });

/* ---- 진행 ---- */
function navNext() {
  // 마지막 카드를 넘길 때: 나중에 카드 처리
  const sess = state.session;
  const newPos = sess.pos + 1;
  if (newPos >= sess.cardIdxs.length) {
    // 세트 종료 — unknownSet 기반으로 재학습 또는 완료
    const unknownCardIdxs = [...sess.unknownSet].map(pos => sess.cardIdxs[pos]);
    if (unknownCardIdxs.length > 0) {
      toast(`😕 ${unknownCardIdxs.length}개 카드 다시 학습합니다`);
      state.session = {
        setId: sess.setId, allFilteredIdxs: sess.allFilteredIdxs,
        cardIdxs: unknownCardIdxs, offset: sess.offset,
        pos: 0, mode: sess.mode, flipped: false, hintShown: false,
        unknownSet: new Set(), knownCount: sess.knownCount || 0,
        revealed: false, isRetry: true,
      };
      renderStudy();
    } else {
      completeSession();
    }
    return;
  }
  sess.pos = newPos;
  sess.flipped = false;
  renderStudy();
}

function navPrev() {
  const sess = state.session;
  if (!sess || sess.pos <= 0) return;
  sess.pos -= 1;
  sess.flipped = false;
  renderStudy();
}

$$('#starRow .star-btn').forEach(btn => {
  btn.addEventListener('click', () => setStar(parseInt(btn.dataset.star, 10)));
});

function setStar(v, force = false) {
  const sess = state.session; if (!sess) return;
  const set = getSet(sess.setId);
  const ci  = sess.cardIdxs[sess.pos];
  const cur = set.starRatings[ci] || 0;
  set.starRatings[ci] = (!force && cur === v) ? 0 : v;
  saveSets();
  $$('#starRow .star-btn').forEach(b => {
    b.classList.remove('pop');
    if (parseInt(b.dataset.star, 10) === set.starRatings[ci]) {
      void b.offsetWidth;
      b.classList.add('pop');
    }
  });
  renderStudy();
}

$('#unknownBtn').addEventListener('click', () => markUnknownAndNext());
$('#knownBtn').addEventListener('click', () => markKnownAndNext());

function markUnknownAndNext() {
  const sess = state.session;
  if (!sess) return;
  sess.unknownSet.add(sess.pos);
  navNext();
}
function markKnownAndNext() {
  const sess = state.session;
  if (!sess) return;
  sess.unknownSet.delete(sess.pos);
  sess.knownCount = (sess.knownCount || 0) + 1;

  // ✓ 플래시 + 카드 슬라이드 아웃 효과
  const flash = $('#svKnownFlash');
  const card  = $('#svCard');
  flash.classList.remove('flash');
  void flash.offsetWidth;
  flash.classList.add('flash');
  card.classList.add('known-out');
  setTimeout(() => {
    card.classList.remove('known-out');
    navNext();
  }, 320);
}

/* ---- Web Speech API (무료, 브라우저 내장) ---- */
function speakText(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel(); // 이전 음성 중단
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang  = 'en-US';
  utter.rate  = 0.9;   // 약간 느리게
  utter.pitch = 1.0;

  // 영어 여성 음성 우선 선택
  const voices = speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    v.lang.startsWith('en') && v.name.toLowerCase().includes('female')
  ) || voices.find(v => v.lang === 'en-US')
    || voices.find(v => v.lang.startsWith('en'));
  if (preferred) utter.voice = preferred;

  speechSynthesis.speak(utter);
}

// 음성 목록이 비동기로 로드되므로 미리 캐시
if (window.speechSynthesis) {
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

function speakCurrent() {
  const sess = state.session; if (!sess) return;
  const set  = getSet(sess.setId);
  if ((set.type || 'vocab') === 'history') return; // 역사 세트는 TTS 없음
  const card = set.cards[sess.cardIdxs[sess.pos]];
  if (card.word) speakText(card.word);
}

$('#exitStudyBtn').addEventListener('click', () => { showView('home'); renderHome(); });

/* ----- 터치 스와이프: 커버 상태와 무관하게 좌우 스와이프로 넘기기 ----- */
let touchStartX = null, touchStartY = null;
const svCardEl = $('#svCard');
svCardEl.addEventListener('touchstart', e => {
  if (e.target.closest('#svCover')) return; // 커버 드래그와 분리
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });
svCardEl.addEventListener('touchend', e => {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    swipeCard(dx < 0 ? 'left' : 'right');
  }
  touchStartX = touchStartY = null;
});

function swipeCard(direction) {
  const sess = state.session;
  if (!sess) return;

  // 왼쪽 스와이프 = 이전 카드 (첫 카드면 무시)
  if (direction === 'left') {
    if (sess.pos <= 0) return;
    const card = $('#svCard');
    card.classList.add('swipe-right'); // 오른쪽으로 밀려나가며 이전으로
    setTimeout(() => { card.classList.remove('swipe-right'); navPrev(); }, 250);
    return;
  }

  // 오른쪽 스와이프 = 다음 카드
  // 커버 열렸으면 알아요, 닫혔으면 나중에
  const isKnown = !!sess.revealed;
  const card = $('#svCard');
  card.classList.add('swipe-left');
  setTimeout(() => {
    card.classList.remove('swipe-left');
    if (isKnown) markKnownAndNext();
    else markUnknownAndNext();
  }, 250);
}

/* ----- 키보드 ---- */
document.addEventListener('keydown', e => {
  if (state.currentView !== 'study') return;
  if (e.target.matches('input, textarea')) return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (state.session?.revealed) recoverCard(); else revealCard();
      break;
    case 'ArrowDown': e.preventDefault(); revealCard();   break; // 커버 내리기
    case 'ArrowUp':   e.preventDefault(); recoverCard();  break; // 커버 올리기
    case 'ArrowRight': e.preventDefault(); swipeCard('right'); break; // 다음 카드
    case 'ArrowLeft':  e.preventDefault(); swipeCard('left');  break; // 이전 카드
    case '1': setStar(1); break;
    case '2': setStar(2); break;
    case '3': setStar(3); break;
    case 'p': case 'P': speakCurrent(); break;
  }
});

/* ============================================================
 *  COMPLETE 뷰
 * ============================================================ */
function completeSession() {
  const sess = state.session;
  const set  = getSet(sess.setId);
  set.lastStudied = Date.now();
  saveSets();
  const stat = state.stats[set.id] || { sessions: 0, lastDate: null };
  stat.sessions++; stat.lastDate = Date.now();
  state.stats[set.id] = stat;
  saveStats();

  const counts = [0,0,0,0];
  for (let i = 0; i < set.cards.length; i++) counts[set.starRatings[i] || 0]++;

  $('#summaryGrid').innerHTML = [
    { label:'★★★', count: counts[3], zero: false },
    { label:'★★',  count: counts[2], zero: false },
    { label:'★',   count: counts[1], zero: false },
    { label:'😕',  count: sess.unknownSet.size, zero: true },
  ].map((c, i) => `
    <div class="summary-cell ${c.zero ? 'zero' : ''}" style="animation: cardIn 0.4s ${i*80}ms cubic-bezier(0.4,0,0.2,1) both;">
      <div class="label">${c.label}</div>
      <div class="count">${c.count}개</div>
    </div>
  `).join('');

  $('#completeSub').textContent = `${set.name} · ${sess.cardIdxs.length}개 카드 학습 완료`;

  const hasNext = state.setupConfig.chunkEnabled &&
    (sess.offset + state.setupConfig.chunkSize) < sess.allFilteredIdxs.length;
  const unknownCardIdxs = [...sess.unknownSet].map(pos => sess.cardIdxs[pos]);

  const buttons = [];
  if (hasNext) buttons.push(`<button class="btn primary lg" data-act="next-chunk">▶ 다음 세션 이어하기</button>`);
  if (unknownCardIdxs.length) buttons.push(`<button class="btn lg unknown-btn" data-act="restudy-unknown">😕 모르겠음 카드만 다시 학습 (${unknownCardIdxs.length}개)</button>`);
  buttons.push(`<button class="btn lg" data-act="restart">↻ 처음부터 다시</button>`);
  buttons.push(`<button class="btn ghost lg" data-act="home">목록으로</button>`);

  const actions = $('#completeActions');
  actions.innerHTML = buttons.join('');
  actions.onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    switch (b.dataset.act) {
      case 'next-chunk':      startSession(sess.offset + state.setupConfig.chunkSize); break;
      case 'restudy-unknown': startSession(0, unknownCardIdxs); break;
      case 'restart':         startSession(0); break;
      case 'home':            showView('home'); renderHome(); break;
    }
  };
  showView('complete');
  fireConfetti();
}

/* ============================================================
 *  컨페티
 * ============================================================ */
function fireConfetti() {
  const canvas = $('#confettiCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width  = window.innerWidth;
  const H = canvas.height = window.innerHeight;
  const colors = ['#FFB800','#3B82F6','#10B981','#EF4444','#A78BFA','#F472B6'];
  const parts = Array.from({ length: 90 }, () => ({
    x: W/2 + (Math.random()-.5)*100, y: H/3,
    vx: (Math.random()-.5)*14, vy: -Math.random()*14-4, g: 0.45,
    size: 5+Math.random()*6, rot: Math.random()*Math.PI*2, vr: (Math.random()-.5)*0.3,
    color: colors[Math.floor(Math.random()*colors.length)],
  }));
  const start = performance.now();
  (function tick(t) {
    const elapsed = t - start;
    ctx.clearRect(0,0,W,H);
    for (const p of parts) {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - elapsed/2200);
      ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size*0.6);
      ctx.restore();
    }
    if (elapsed < 2400) requestAnimationFrame(tick);
    else ctx.clearRect(0,0,W,H);
  })(start);
}

window.addEventListener('resize', () => {
  const c = $('#confettiCanvas');
  if (c) { c.width = window.innerWidth; c.height = window.innerHeight; }
});

/* ============================================================
 *  테마
 * ============================================================ */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('#themeToggle .theme-icon').textContent = t === 'dark' ? '☀' : '🌙';
}
$('#themeToggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, cur);
  applyTheme(cur);
});
applyTheme(localStorage.getItem(THEME_KEY) || 'light');

/* ============================================================
 *  Modal / Toast
 * ============================================================ */
let modalConfirmCb = null;
function showModal(title, body, onConfirm) {
  $('#modalTitle').textContent = title;
  $('#modalBody').textContent  = body;
  modalConfirmCb = onConfirm;
  $('#modal').classList.add('show');
}
function closeModal() { $('#modal').classList.remove('show'); modalConfirmCb = null; }
$('#modalCancel').addEventListener('click', closeModal);
$('#modalConfirm').addEventListener('click', () => { const cb = modalConfirmCb; closeModal(); if (cb) cb(); });
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('#modal').classList.contains('show')) { closeModal(); return; }
    if ($('#starPickerModal').classList.contains('show')) { $('#starPickerModal').classList.remove('show'); return; }
    if ($('#cardPicker').classList.contains('show')) { $('#cardPicker').classList.remove('show'); return; }
  }
});

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ============================================================
 *  Firebase 초기화 + Google 로그인
 * ============================================================ */
/* ============================================================
 *  로그인 화면 제어
 * ============================================================ */
function showLoginScreen() {
  $('#loginScreen').classList.remove('hidden');
  document.getElementById('appRoot').style.display = 'none';
  document.querySelector('.app-header').style.display = 'none';
}
function hideLoginScreen() {
  $('#loginScreen').classList.add('hidden');
  document.getElementById('appRoot').style.display = '';
  document.querySelector('.app-header').style.display = '';
}

$('#loginGoogleBtn').addEventListener('click', async () => {
  if (!fbAuth) return;
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await fbAuth.signInWithPopup(provider);
  } catch(e) {
    toast('❌ 로그인 실패: ' + (e.message || e.code));
  }
});

function initFirebase() {
  if (!FIREBASE_CONFIG.apiKey) {
    console.warn('Firebase 설정 없음 → 로그인 불가');
    $('#loginGoogleBtn').textContent = '⚠ 설정 오류 — 관리자에게 문의';
    $('#loginGoogleBtn').disabled = true;
    return;
  }
  try {
    const app = firebase.apps.length
      ? firebase.app()
      : firebase.initializeApp(FIREBASE_CONFIG);

    fbAuth = firebase.auth(app);
    fbDb   = firebase.firestore(app);

    fbAuth.onAuthStateChanged(user => {
      fbUser = user;
      updateAuthUI();
      if (user) {
        hideLoginScreen();
        loadFromFirestore();
      } else {
        showLoginScreen();
      }
    });

    console.info('Firebase 초기화 성공');
  } catch(e) {
    console.error('Firebase 초기화 실패:', e);
    fbAuth = null;
    fbDb   = null;
    // 초기화 실패 시에도 로그인 화면 유지
    toast('❌ Firebase 초기화 실패. 새로고침 해주세요.');
  }
}

function updateAuthUI() {
  const btn    = $('#authBtn');
  const avatar = $('#authAvatar');
  const label  = $('#authLabel');
  if (fbUser) {
    label.textContent = fbUser.displayName || fbUser.email || '로그아웃';
    if (fbUser.photoURL) {
      avatar.style.backgroundImage = `url(${fbUser.photoURL})`;
      avatar.hidden = false;
    }
    btn.classList.add('logged-in');
    btn.title = '클릭하여 로그아웃';
  } else {
    label.textContent = 'Google 로그인';
    avatar.hidden = true;
    btn.classList.remove('logged-in');
    btn.title = '';
  }
}

$('#authBtn').addEventListener('click', async () => {
  if (!fbAuth) {
    toast('⚠ 로그인을 사용할 수 없습니다. 브라우저 콘솔(F12)을 확인해주세요.');
    return;
  }
  if (fbUser) {
    showModal('로그아웃', `${fbUser.displayName || fbUser.email}에서 로그아웃할까요?`, async () => {
      await fbAuth.signOut();
      toast('👋 로그아웃했습니다');
    });
  } else {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await fbAuth.signInWithPopup(provider);
    } catch(e) {
      toast('❌ 로그인 실패: ' + (e.message || e.code));
    }
  }
});

/* ============================================================
 *  초기화
 * ============================================================ */
loadAll();
showView('home');
renderHome();
showLoginScreen(); // Firebase 인증 확인 전까지 로그인 화면 표시
initFirebase();
