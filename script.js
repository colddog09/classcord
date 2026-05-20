/* ============================================================
 *  플래시카드 — 메인 스크립트
 *  state / view 라우팅 / 학습 세션 / localStorage 영속화
 * ============================================================ */

'use strict';

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
    mode: 'word',          // 'word' | 'meaning'
    order: 'sequential',   // 'sequential' | 'random'
    filter: 0,             // 0 | 1 | 2 | 3
    chunkEnabled: false,
    chunkSize: 10,
  },
  session: null,
  stats: {},
  expandedStats: {},
};

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
  try {
    state.sets = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { state.sets = []; }
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (s) Object.assign(state.setupConfig, JSON.parse(s));
  } catch {}
  try {
    state.stats = JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
  } catch { state.stats = {}; }
  if (!state.sets.length) {
    state.sets = defaultSets();
    saveSets();
  }
}
const saveSets     = () => localStorage.setItem(STORAGE_KEY,  JSON.stringify(state.sets));
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.setupConfig));
const saveStats    = () => localStorage.setItem(STATS_KEY,    JSON.stringify(state.stats));

function defaultSets() {
  return [
    {
      id: 'sample-1',
      name: 'TOEIC 기초 단어',
      themeColor: '#3B82F6',
      lastStudied: null,
      starRatings: {},
      cards: [
        { word: 'achieve', phonetic: '/əˈtʃiːv/',     meaning: '달성하다, 성취하다' },
        { word: 'benefit', phonetic: '/ˈben.ɪ.fɪt/',  meaning: '이익, 혜택' },
        { word: 'company', phonetic: '/ˈkʌm.pə.ni/',  meaning: '회사' },
        { word: 'develop', phonetic: '/dɪˈvel.əp/',   meaning: '발전시키다' },
      ],
    },
    {
      id: 'sample-2',
      name: '일상 영어 표현',
      themeColor: '#10B981',
      lastStudied: null,
      starRatings: {},
      cards: [
        { word: 'apple',   phonetic: '/ˈæp.əl/',         meaning: '사과' },
        { word: 'breeze',  phonetic: '/briːz/',          meaning: '산들바람' },
        { word: 'curious', phonetic: '/ˈkjʊə.ri.əs/',    meaning: '호기심이 많은' },
        { word: 'delight', phonetic: '/dɪˈlaɪt/',        meaning: '기쁨' },
      ],
    },
  ];
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
  if (diff < 7)   return diff + '일 전';
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
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ============================================================
 *  HOME 뷰
 * ============================================================ */
function renderHome() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const filtered = state.sets.filter(s => !q || s.name.toLowerCase().includes(q));
  const list = $('#setList');

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">
      <span class="emoji">${q ? '🔍' : '📭'}</span>
      <h3>${q ? '검색 결과가 없습니다' : '아직 단어장이 없습니다'}</h3>
      <p>${q ? '다른 키워드로 검색해 보세요' : '"새 단어장 만들기"로 시작해 보세요'}</p>
    </div>`;
    return;
  }

  list.innerHTML = filtered.map((s, idx) => {
    const avg   = avgRating(s);
    const rd    = Math.round(avg);
    const stars = '★'.repeat(rd) + '☆'.repeat(3 - rd);
    const stat  = state.stats[s.id] || { sessions: 0, lastDate: null };
    const open  = state.expandedStats[s.id];
    return `
      <div class="set-card" style="--set-color:${escapeHtml(s.themeColor || '#3B82F6')}; animation-delay:${idx * 40}ms;">
        <div class="set-card-name">${escapeHtml(s.name)}</div>
        <div class="set-card-meta">
          <span>📚 ${s.cards.length}개</span>
          <span class="star">${stars} ${avg.toFixed(1)}</span>
          <span>🕐 ${formatDate(s.lastStudied)}</span>
        </div>
        <div class="set-card-actions">
          <button class="btn primary sm" data-action="study"  data-id="${s.id}">학습하기</button>
          <button class="btn sm"         data-action="edit"   data-id="${s.id}">편집</button>
          <button class="btn danger sm"  data-action="delete" data-id="${s.id}">삭제</button>
        </div>
        <div class="stats-toggle ${open ? 'open' : ''}" data-action="toggle-stats" data-id="${s.id}">
          <span class="caret">▶</span>
          <span>학습 통계</span>
        </div>
        <div class="stats-panel ${open ? 'open' : ''}">
          <div><div class="stats-panel-inner">
            <div class="stats-row"><span>총 세션 수</span><span><strong>${stat.sessions}</strong>회</span></div>
            <div class="stats-row"><span>마지막 학습</span><span>${formatDate(stat.lastDate)}</span></div>
            <div style="margin-top:10px;">${renderStatBars(s)}</div>
          </div></div>
        </div>
      </div>
    `;
  }).join('');

  // 통계 바 width 애니메이션 트리거
  requestAnimationFrame(() => {
    $$('.stats-bar-fill').forEach(el => {
      el.style.width = el.dataset.width;
    });
  });
}

function renderStatBars(set) {
  const counts = [0, 0, 0, 0];
  const total = set.cards.length || 1;
  for (let i = 0; i < set.cards.length; i++) {
    counts[set.starRatings[i] || 0]++;
  }
  const labels = ['☆', '★', '★★', '★★★'];
  return [3, 2, 1, 0].map(r => {
    const pct = (counts[r] / total) * 100;
    const empty = r === 0;
    return `<div class="stats-bar-row">
      <div class="stats-bar-label ${empty ? 'empty' : ''}">${labels[r]}</div>
      <div class="stats-bar-track">
        <div class="stats-bar-fill ${empty ? 'empty' : ''}" data-width="${pct}%" style="width:0;"></div>
      </div>
      <div class="stats-bar-count">${counts[r]}</div>
    </div>`;
  }).join('');
}

$('#searchInput').addEventListener('input', renderHome);
$('#newSetBtn').addEventListener('click', () => openEdit(null));
$('#logoBtn').addEventListener('click', () => { showView('home'); renderHome(); });

$('#setList').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  switch (btn.dataset.action) {
    case 'study':         openSetup(id); break;
    case 'edit':          openEdit(id); break;
    case 'delete':        confirmDelete(id); break;
    case 'toggle-stats':
      state.expandedStats[id] = !state.expandedStats[id];
      renderHome();
      break;
  }
});

function confirmDelete(id) {
  const s = getSet(id);
  if (!s) return;
  showModal(`'${s.name}' 삭제`, '이 단어장을 정말 삭제할까요? 되돌릴 수 없습니다.', () => {
    state.sets = state.sets.filter(x => x.id !== id);
    saveSets();
    delete state.stats[id];
    saveStats();
    renderHome();
    toast('🗑 삭제했습니다');
  });
}

/* ============================================================
 *  JSON 가져오기 / 내보내기
 * ============================================================ */
$('#importJsonBtn').addEventListener('click', () => $('#jsonFileInput').click());

$('#jsonFileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const items = Array.isArray(data) ? data : [data];
      let added = 0;
      for (const it of items) {
        if (!it.name || !Array.isArray(it.cards)) continue;
        state.sets.push({
          id: uid(),
          name: it.name,
          themeColor: it.themeColor || '#3B82F6',
          lastStudied: it.lastStudied || null,
          starRatings: it.starRatings || {},
          cards: it.cards.map(c => ({
            word:     c.word     || '',
            phonetic: c.phonetic || '',
            meaning:  c.meaning  || '',
          })),
        });
        added++;
      }
      if (added) {
        saveSets();
        renderHome();
        toast(`✅ ${added}개 단어장을 가져왔습니다`);
      } else {
        toast('⚠ 가져올 수 있는 단어장이 없습니다');
      }
    } catch {
      toast('❌ JSON 파일을 읽을 수 없습니다');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
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
      id: uid(),
      name: '',
      themeColor: '#3B82F6',
      lastStudied: null,
      starRatings: {},
      cards: [{ word: '', phonetic: '', meaning: '' }],
    };
    $('#editTitle').textContent = '새 단어장';
  }
  $('#editNameInput').value  = state.editDraft.name;
  $('#editColorInput').value = state.editDraft.themeColor || '#3B82F6';
  syncColorPreview();
  renderEditTable();
  $('#csvInput').value = '';
  showView('edit');
}

function syncColorPreview() {
  $('#colorPreview').style.background = state.editDraft.themeColor;
}

function renderEditTable() {
  const tbody = $('#editTableBody');
  tbody.innerHTML = state.editDraft.cards.map((c, i) => `
    <tr data-idx="${i}">
      <td class="row-num">${i + 1}</td>
      <td>
        <div class="word-cell">
          <input type="text" data-field="word"     value="${escapeHtml(c.word)}"     placeholder="단어" />
          <button class="preview-btn" data-action="preview" title="발음 미리듣기">🔊</button>
        </div>
      </td>
      <td><input type="text" data-field="phonetic" value="${escapeHtml(c.phonetic)}" placeholder="/발음/" /></td>
      <td><input type="text" data-field="meaning"  value="${escapeHtml(c.meaning)}"  placeholder="뜻" /></td>
      <td class="row-actions">
        <button class="btn danger sm" data-action="delete-row" title="삭제">🗑</button>
      </td>
    </tr>
  `).join('');
  $('#cardCount').textContent = `총 ${state.editDraft.cards.length}개 카드`;
}

$('#editBackBtn').addEventListener('click', () => { showView('home'); renderHome(); });

$('#editNameInput').addEventListener('input', e => { state.editDraft.name = e.target.value; });
$('#editColorInput').addEventListener('input', e => {
  state.editDraft.themeColor = e.target.value;
  syncColorPreview();
});
$('#colorPreview').addEventListener('click', () => $('#editColorInput').click());

$('#editTableBody').addEventListener('input', e => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const idx = parseInt(tr.dataset.idx, 10);
  const field = e.target.dataset.field;
  if (field && state.editDraft.cards[idx]) {
    state.editDraft.cards[idx][field] = e.target.value;
  }
});

$('#editTableBody').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const tr  = btn.closest('tr');
  const idx = parseInt(tr.dataset.idx, 10);
  if (btn.dataset.action === 'delete-row') {
    tr.classList.add('removing');
    setTimeout(() => {
      state.editDraft.cards.splice(idx, 1);
      if (!state.editDraft.cards.length) {
        state.editDraft.cards.push({ word: '', phonetic: '', meaning: '' });
      }
      renderEditTable();
    }, 230);
  } else if (btn.dataset.action === 'preview') {
    const w = state.editDraft.cards[idx].word.trim();
    if (w && window.responsiveVoice) {
      responsiveVoice.speak(w, 'UK English Female');
    }
  }
});

$('#addRowBtn').addEventListener('click', () => {
  state.editDraft.cards.push({ word: '', phonetic: '', meaning: '' });
  renderEditTable();
  const tbody = $('#editTableBody');
  const lastTr = tbody.querySelector('tr:last-child');
  if (lastTr) {
    lastTr.classList.add('adding');
    const input = lastTr.querySelector('input[data-field="word"]');
    if (input) input.focus();
  }
});

$('#csvImportBtn').addEventListener('click', () => {
  const raw = $('#csvInput').value.trim();
  if (!raw) { toast('⚠ CSV 내용이 비어 있습니다'); return; }
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  let rows = lines.map(l => l.split(',').map(c => c.trim()));
  if (rows.length && rows[0][0] && rows[0][0].toLowerCase() === 'word') rows.shift();

  // 빈 placeholder 카드 1개만 있으면 제거
  if (state.editDraft.cards.length === 1) {
    const only = state.editDraft.cards[0];
    if (!only.word && !only.phonetic && !only.meaning) state.editDraft.cards = [];
  }

  let added = 0;
  for (const [w, p, m] of rows) {
    if (!w) continue;
    state.editDraft.cards.push({ word: w, phonetic: p || '', meaning: m || '' });
    added++;
  }
  if (!state.editDraft.cards.length) {
    state.editDraft.cards.push({ word: '', phonetic: '', meaning: '' });
  }
  renderEditTable();
  $('#csvInput').value = '';
  toast(added ? `✅ ${added}개 카드를 추가했습니다` : '⚠ 유효한 행이 없습니다');
});

$('#saveSetBtn').addEventListener('click', () => {
  const draft = state.editDraft;
  if (!draft.name.trim()) { toast('⚠ 단어장 이름을 입력해 주세요'); $('#editNameInput').focus(); return; }
  const valid = draft.cards.filter(c => c.word.trim() || c.meaning.trim());
  if (!valid.length) { toast('⚠ 최소 1개의 카드가 필요합니다'); return; }
  draft.cards = valid;
  // 카드 개수가 줄었을 때 별점 인덱스 정리
  const cleanRatings = {};
  for (const k in draft.starRatings) {
    const ki = parseInt(k, 10);
    if (ki < draft.cards.length) cleanRatings[ki] = draft.starRatings[k];
  }
  draft.starRatings = cleanRatings;
  const idx = state.sets.findIndex(s => s.id === draft.id);
  if (idx >= 0) state.sets[idx] = draft;
  else state.sets.push(draft);
  saveSets();
  toast('💾 저장했습니다');
  showView('home');
  renderHome();
});

$('#exportJsonBtn').addEventListener('click', () => {
  const draft = state.editDraft;
  const data = {
    name: draft.name || 'flashcards',
    themeColor: draft.themeColor,
    cards: draft.cards.filter(c => c.word.trim() || c.meaning.trim()),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (data.name || 'flashcards') + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('⬇ 다운로드했습니다');
});

/* ============================================================
 *  SETUP 뷰
 * ============================================================ */
function openSetup(id) {
  state.currentSetId = id;
  const s = getSet(id);
  $('#setupTitle').textContent = s.name + ' — 학습 설정';
  setChips('modeChips',   'mode',   state.setupConfig.mode);
  setChips('orderChips',  'order',  state.setupConfig.order);
  setChips('filterChips', 'filter', String(state.setupConfig.filter));
  setChunkToggle(state.setupConfig.chunkEnabled);
  $('#chunkSize').value = state.setupConfig.chunkSize;
  updateMatchInfo();
  showView('setup');
}

function setChips(containerId, key, value) {
  $$(`#${containerId} .option-chip`).forEach(chip => {
    chip.classList.toggle('active', chip.dataset[key] === String(value));
  });
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
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    $('#chunkToggle').click();
  }
});
$('#chunkSize').addEventListener('input', e => {
  state.setupConfig.chunkSize = Math.max(1, parseInt(e.target.value, 10) || 1);
});
$('#setupBackBtn').addEventListener('click', () => { showView('home'); renderHome(); });

function getFilteredIndices(set, filter) {
  const out = [];
  for (let i = 0; i < set.cards.length; i++) {
    if ((set.starRatings[i] || 0) >= filter) out.push(i);
  }
  return out;
}

function updateMatchInfo() {
  const s = getSet(state.currentSetId);
  if (!s) return;
  const idxs = getFilteredIndices(s, state.setupConfig.filter);
  const info = $('#matchInfo');
  const startBtn = $('#startSessionBtn');
  if (!idxs.length) {
    info.textContent = '⚠ 조건에 맞는 카드가 없습니다. 필터를 조정해 주세요.';
    info.classList.add('warn');
    startBtn.disabled = true;
  } else {
    info.innerHTML = `✓ 조건에 맞는 카드: <strong>${idxs.length}개</strong>`;
    info.classList.remove('warn');
    startBtn.disabled = false;
  }
}

$('#startSessionBtn').addEventListener('click', () => {
  saveSettings();
  startSession(0);
});

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
    sessionIdxs = idxs;
    offset = 0;
  }

  if (!sessionIdxs.length) { toast('⚠ 학습할 카드가 없습니다'); return; }

  state.session = {
    setId: s.id,
    allFilteredIdxs: idxs,
    cardIdxs: sessionIdxs,
    offset,
    pos: 0,
    mode: state.setupConfig.mode,
    flipped: false,
    hintShown: true,
    unknownSet: new Set(), // 모르겠음 누른 카드 인덱스 (cardIdxs 기준)
  };

  showView('study');
  renderStudy();
}

function renderStudy() {
  const sess = state.session;
  const set  = getSet(sess.setId);
  document.documentElement.style.setProperty('--set-color', set.themeColor || '#3B82F6');

  const total = sess.cardIdxs.length;
  const cur   = sess.pos + 1;
  $('#progressFill').style.width = ((sess.pos + 1) / total * 100) + '%';
  $('#progressText').textContent = `${cur} / ${total}`;
  $('#modeBadge').textContent = sess.mode === 'word' ? '단어 제시' : '뜻 제시';

  const cardIdx = sess.cardIdxs[sess.pos];
  const card    = set.cards[cardIdx];

  const fc = $('#flashcard');
  fc.classList.toggle('flipped', sess.flipped);

  const front = $('#cardFront');
  const back  = $('#cardBack');
  if (sess.mode === 'word') {
    front.innerHTML = `
      <div class="flashcard-word">${escapeHtml(card.word)}</div>
      <div class="flashcard-phonetic">${escapeHtml(card.phonetic || '')}</div>`;
    back.innerHTML = `<div class="flashcard-meaning">${escapeHtml(card.meaning)}</div>`;
  } else {
    front.innerHTML = `<div class="flashcard-meaning">${escapeHtml(card.meaning)}</div>`;
    back.innerHTML = `
      <div class="flashcard-word">${escapeHtml(card.word)}</div>
      <div class="flashcard-phonetic">${escapeHtml(card.phonetic || '')}</div>`;
  }

  $('#flipHint').style.display = (sess.pos === 0 && sess.hintShown) ? '' : 'none';

  const star = set.starRatings[cardIdx] || 0;
  $$('#starRow .star-btn').forEach(btn => {
    const v = parseInt(btn.dataset.star, 10);
    btn.classList.toggle('filled', v <= star);
  });

  updateUnknownUI();
  renderSidebar();
}

function renderSidebar() {
  const sess = state.session;
  const set  = getSet(sess.setId);
  $('#sidebarList').innerHTML = sess.cardIdxs.map((ci, i) => {
    const card     = set.cards[ci];
    const r        = set.starRatings[ci] || 0;
    const stars    = '★'.repeat(r);
    const label    = (card.word || card.meaning || '').slice(0, 22);
    const unknown  = sess.unknownSet.has(i);
    return `<div class="sidebar-item ${i === sess.pos ? 'active' : ''} ${unknown ? 'unknown' : ''}" data-pos="${i}">
      <span class="sidebar-num">${i + 1}.</span>
      <span class="sidebar-text">${escapeHtml(label)}</span>
      <span class="stars">${unknown ? '❓' : stars}</span>
    </div>`;
  }).join('');
  // 활성 항목으로 스크롤
  const active = $('#sidebarList .sidebar-item.active');
  if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

$('#sidebarList').addEventListener('click', e => {
  const item = e.target.closest('.sidebar-item');
  if (!item) return;
  state.session.pos = parseInt(item.dataset.pos, 10);
  state.session.flipped = false;
  renderStudy();
});

const flashcardEl = $('#flashcard');
flashcardEl.addEventListener('click', () => flipCard());

function flipCard() {
  if (!state.session) return;
  state.session.flipped = !state.session.flipped;
  if (state.session.hintShown) state.session.hintShown = false;
  flashcardEl.classList.toggle('flipped', state.session.flipped);
  $('#flipHint').style.display = 'none';
}

function navNext() {
  const sess = state.session;
  const newPos = sess.pos + 1;
  if (newPos >= sess.cardIdxs.length) {
    // 한 라운드 끝 → 모르겠음 카드가 남아있으면 그것들로 다시 반복
    const unknownCardIdxs = [...sess.unknownSet].map(pos => sess.cardIdxs[pos]);
    if (unknownCardIdxs.length > 0) {
      toast(`😕 ${unknownCardIdxs.length}개 카드 다시 학습합니다`);
      // unknownSet을 새 세션으로 이어가되, 완료 시 집계를 위해 원본 정보 유지
      state.session = {
        setId: sess.setId,
        allFilteredIdxs: sess.allFilteredIdxs,
        cardIdxs: unknownCardIdxs,
        offset: sess.offset,
        pos: 0,
        mode: sess.mode,
        flipped: false,
        hintShown: false,
        unknownSet: new Set(),  // 새 라운드는 초기화
        isRetry: true,
      };
      flashcardEl.classList.remove('flipped');
      flashcardEl.classList.add('swipe-in');
      setTimeout(() => flashcardEl.classList.remove('swipe-in'), 360);
      renderStudy();
    } else {
      completeSession();
    }
    return;
  }
  sess.pos = newPos;
  sess.flipped = false;
  flashcardEl.classList.remove('flipped');
  flashcardEl.classList.add('swipe-in');
  setTimeout(() => flashcardEl.classList.remove('swipe-in'), 360);
  renderStudy();
}

$$('#starRow .star-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const v = parseInt(btn.dataset.star, 10);
    setStar(v);
  });
});

function setStar(v, force = false) {
  const sess = state.session;
  if (!sess) return;
  const set = getSet(sess.setId);
  const ci  = sess.cardIdxs[sess.pos];
  const current = set.starRatings[ci] || 0;
  set.starRatings[ci] = (!force && current === v) ? 0 : v;
  saveSets();
  // 별 pop 애니메이션
  $$('#starRow .star-btn').forEach(b => {
    b.classList.remove('pop');
    if (parseInt(b.dataset.star, 10) === set.starRatings[ci]) {
      void b.offsetWidth; // reflow
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
  updateUnknownUI();
  renderSidebar();
  navNext();
}

function markKnownAndNext() {
  const sess = state.session;
  if (!sess) return;
  sess.unknownSet.delete(sess.pos);
  updateUnknownUI();
  renderSidebar();
  navNext();
}

function updateUnknownUI() {
  const sess = state.session;
  const isUnknown = sess.unknownSet.has(sess.pos);
  const btn = $('#unknownBtn');
  btn.classList.toggle('active-unknown', isUnknown);
  btn.textContent = isUnknown ? '😕 모르겠음 ✓' : '😕 모르겠음';
  // 카드에 모르겠음 표시 뱃지
  let badge = $('#unknownBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'unknownBadge';
    badge.className = 'unknown-badge';
    $('#flashcard').appendChild(badge);
  }
  badge.textContent = '모르겠음';
  badge.style.display = isUnknown ? '' : 'none';
}

$('#speakBtn').addEventListener('click', speakCurrent);

function speakCurrent() {
  const sess = state.session;
  if (!sess) return;
  const set  = getSet(sess.setId);
  const card = set.cards[sess.cardIdxs[sess.pos]];
  // 요구사항: 동시 재생 (cancel 하지 않음)
  if (card.word && window.responsiveVoice) {
    responsiveVoice.speak(card.word, 'UK English Female');
  }
}

$('#exitStudyBtn').addEventListener('click', () => { showView('home'); renderHome(); });

/* ----- 터치 스와이프 ----- */
let touchStartX = null, touchStartY = null, touchMoved = false;
flashcardEl.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchMoved = false;
}, { passive: true });
flashcardEl.addEventListener('touchmove', e => {
  if (touchStartX === null) return;
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;
  if (Math.abs(dx) > 10 || Math.abs(dy) > 10) touchMoved = true;
}, { passive: true });
flashcardEl.addEventListener('touchend', e => {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    e.preventDefault();
    // 클릭 플립을 막기 위해 약간의 지연
    flashcardEl.style.pointerEvents = 'none';
    setTimeout(() => { flashcardEl.style.pointerEvents = ''; }, 50);
    if (dx < 0) markKnownAndNext();   // 왼쪽 스와이프 → 알겠음
    else markUnknownAndNext();         // 오른쪽 스와이프 → 모르겠음
  }
  touchStartX = touchStartY = null;
});

/* ----- 키보드 단축키 ----- */
document.addEventListener('keydown', e => {
  if (state.currentView !== 'study') return;
  if (e.target.matches('input, textarea')) return;
  switch (e.key) {
    case ' ':          e.preventDefault(); flipCard(); break;
    case 'ArrowRight': e.preventDefault(); markKnownAndNext(); break;
    case 'ArrowLeft':  e.preventDefault(); markUnknownAndNext(); break;
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
  stat.sessions++;
  stat.lastDate = Date.now();
  state.stats[set.id] = stat;
  saveStats();

  const counts = [0, 0, 0, 0];
  for (let i = 0; i < set.cards.length; i++) counts[set.starRatings[i] || 0]++;
  const unknownCount = sess.unknownSet.size;

  $('#summaryGrid').innerHTML = [
    { label: '★★★', count: counts[3], zero: false },
    { label: '★★',  count: counts[2], zero: false },
    { label: '★',   count: counts[1], zero: false },
    { label: '😕',  count: unknownCount, zero: true  },
  ].map((c, i) => `
    <div class="summary-cell ${c.zero ? 'zero' : ''}" style="animation: cardIn 0.4s ${i * 80}ms cubic-bezier(0.4,0,0.2,1) both;">
      <div class="label">${c.label}</div>
      <div class="count">${c.count}개</div>
    </div>
  `).join('');

  $('#completeSub').textContent = `${set.name} · ${sess.cardIdxs.length}개 카드 학습 완료`;

  const hasNext = state.setupConfig.chunkEnabled &&
    (sess.offset + state.setupConfig.chunkSize) < sess.allFilteredIdxs.length;

  // 이번 세션에서 모르겠음을 누른 카드들의 실제 set 인덱스
  const unknownCardIdxs = [...sess.unknownSet].map(pos => sess.cardIdxs[pos]);

  const buttons = [];
  if (hasNext) {
    buttons.push(`<button class="btn primary lg" data-act="next-chunk">▶ 다음 세션 이어하기</button>`);
  }
  if (unknownCardIdxs.length) {
    buttons.push(`<button class="btn lg unknown-btn" data-act="restudy-unknown">😕 모르겠음 카드만 다시 학습 (${unknownCardIdxs.length}개)</button>`);
  }
  buttons.push(`<button class="btn lg" data-act="restart">↻ 처음부터 다시</button>`);
  buttons.push(`<button class="btn ghost lg" data-act="home">목록으로</button>`);

  const actions = $('#completeActions');
  actions.innerHTML = buttons.join('');
  actions.onclick = e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
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
 *  컨페티 (CSS-free canvas 효과)
 * ============================================================ */
function fireConfetti() {
  const canvas = $('#confettiCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width  = window.innerWidth;
  const H = canvas.height = window.innerHeight;
  const colors = ['#FFB800', '#3B82F6', '#10B981', '#EF4444', '#A78BFA', '#F472B6'];
  const N = 90;
  const parts = [];
  for (let i = 0; i < N; i++) {
    parts.push({
      x: W / 2 + (Math.random() - 0.5) * 100,
      y: H / 3,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 14 - 4,
      g:  0.45,
      size: 5 + Math.random() * 6,
      rot: Math.random() * Math.PI * 2,
      vr:  (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 0,
    });
  }
  let raf = null;
  const start = performance.now();
  function tick(t) {
    const elapsed = t - start;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += p.g;
      p.x  += p.vx;
      p.y  += p.vy;
      p.rot += p.vr;
      p.life += 1;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - elapsed / 2200);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (elapsed < 2400) raf = requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, W, H);
  }
  raf = requestAnimationFrame(tick);
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
function closeModal() {
  $('#modal').classList.remove('show');
  modalConfirmCb = null;
}
$('#modalCancel').addEventListener('click', closeModal);
$('#modalConfirm').addEventListener('click', () => {
  const cb = modalConfirmCb;
  closeModal();
  if (cb) cb();
});
$('#modal').addEventListener('click', e => {
  if (e.target.id === 'modal') closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#modal').classList.contains('show')) closeModal();
});

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ============================================================
 *  초기화
 * ============================================================ */
loadAll();
showView('home');
renderHome();
