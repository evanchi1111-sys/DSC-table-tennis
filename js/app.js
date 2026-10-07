import { ORGANIZER_EMAIL } from './config.js';
import { createBackend, isConfigured } from './backend.js';
import { generateRoundRobin } from './scheduler.js';
import { computeRankings, gamesWon, gameWinner } from './ranking.js';
import { exportExcel, printReport } from './export.js';

const DIVISIONS = { competitive: '競賽組', fun: '歡樂成長組' };
const FORMATS = {
  best_of_3: { label: '三局兩勝', games: 3, wins: 2 },
  best_of_5: { label: '五局三勝', games: 5, wins: 3 },
};
const SECTIONS = { rankings: '排名', matches: '賽程', matrix: '對戰表', teams: '名單' };

const demo = new URLSearchParams(location.search).has('demo');
const store = {
  get(key, fallback) {
    try { return localStorage.getItem(`tt_${key}`) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`tt_${key}`, value); } catch { /* 私密瀏覽等情況忽略 */ }
  },
};

const state = {
  loaded: false,
  error: null,
  busy: false,
  settings: { status: 'setup', match_format: 'best_of_3' },
  teams: [],
  matches: [],
  user: null,
  division: DIVISIONS[store.get('division')] ? store.get('division') : 'competitive',
  section: SECTIONS[store.get('section')] ? store.get('section') : 'rankings',
  myTeam: store.get('myTeam', ''),
  onlyMine: store.get('onlyMine', '') === '1',
};

const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastEl = document.getElementById('toast');
let backend;

// ---------------------------------------------------------------- 小工具

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const teamById = (id) => state.teams.find((t) => t.id === id);
const teamName = (id) => {
  const t = teamById(id);
  return t ? `${t.player_a} & ${t.player_b}` : '（已刪除）';
};
const isOrganizer = () => !!state.user && (state.user.email || '').toLowerCase() === ORGANIZER_EMAIL.toLowerCase();
const isSetup = () => state.settings.status !== 'active';
const formatOf = (m) => FORMATS[m?.match_format] || FORMATS[state.settings.match_format] || FORMATS.best_of_3;
// 桌球 11 分制：先得 11 分且領先 2 分；10:10 之後要領先 2 分
const isStandardGame = (a, b) => {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return hi === 11 ? lo <= 9 : hi > 11 && hi - lo === 2;
};
const statusLabel = (m) => ({ completed: '已完賽', playing: '進行中', not_started: '未開始' })[m.status] || '未開始';
const divisionMatches = (division) => state.matches.filter((m) => m.division === division);

let toastTimer;
function toast(message, kind = 'info') {
  toastEl.textContent = message;
  toastEl.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = ''; }, 3200);
}

async function run(task, successMessage) {
  if (state.busy) return false;
  state.busy = true;
  render();
  try {
    await task();
    if (successMessage) toast(successMessage, 'ok');
    return true;
  } catch (err) {
    console.error(err);
    toast(err.message || '操作失敗，請再試一次', 'error');
    return false;
  } finally {
    state.busy = false;
    render();
  }
}

// ---------------------------------------------------------------- 資料載入與即時同步

let reloadTimer;
const scheduleReload = () => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(reload, 250);
};

async function reload() {
  try {
    const data = await backend.load();
    Object.assign(state, data, { loaded: true, error: null });
  } catch (err) {
    console.error(err);
    state.error = err.message || '資料讀取失敗';
  }
  requestRender();
}

// 使用者正在輸入時，延後重繪，避免打字到一半被清掉
let pendingRender = false;
const isEditing = () => {
  const el = document.activeElement;
  return !!el && app.contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
};
function requestRender() {
  if (isEditing()) pendingRender = true;
  else render();
}
app.addEventListener('focusout', () => {
  setTimeout(() => {
    if (pendingRender && !isEditing()) {
      pendingRender = false;
      render();
    }
  }, 0);
});

// ---------------------------------------------------------------- 畫面

function render() {
  if (!state.loaded) {
    app.innerHTML = state.error
      ? `<div class="center-card"><h2>無法讀取賽事資料</h2><p>${esc(state.error)}</p><button class="btn primary" data-action="retry">重新載入</button></div>`
      : `<div class="center-card"><div class="spinner" aria-hidden="true"></div><p>載入賽事資料中…</p></div>`;
    return;
  }
  const rankings = computeRankings(state.teams, state.matches, state.division);
  app.innerHTML = `
    ${renderHeader()}
    <main class="container">
      ${state.error ? `<div class="banner error">⚠️ 與資料庫連線異常：${esc(state.error)}（畫面可能不是最新）</div>` : ''}
      ${demo ? `<div class="banner demo">🧪 示範模式：資料只存在這個分頁，重新整理就會還原。主辦登入密碼：<b>${esc(backend.demoPassword)}</b></div>` : ''}
      ${renderStatus()}
      ${renderTabs()}
      <section class="panel" aria-label="${esc(SECTIONS[state.section])}">
        ${state.section === 'rankings' ? renderRankings(rankings) : ''}
        ${state.section === 'matches' ? renderMatches() : ''}
        ${state.section === 'matrix' ? renderMatrix(rankings) : ''}
        ${state.section === 'teams' ? renderTeams() : ''}
      </section>
    </main>`;
}

function renderHeader() {
  return `
    <header class="topbar">
      <div class="container topbar-inner">
        <div class="brand">
          <span class="brand-icon" aria-hidden="true">🏓</span>
          <div>
            <h1>桌球雙打賽即時計分</h1>
            <p class="live"><span class="dot" aria-hidden="true"></span>比分自動即時更新</p>
          </div>
        </div>
        ${
          isOrganizer()
            ? `<div class="who"><span class="chip ok">主辦模式</span><button class="btn small" data-action="logout">登出</button></div>`
            : `<button class="btn small" data-action="login">主辦登入</button>`
        }
      </div>
    </header>`;
}

function renderStatus() {
  const fmt = FORMATS[state.settings.match_format] || FORMATS.best_of_3;
  const all = state.matches.length;
  const done = state.matches.filter((m) => m.status === 'completed').length;
  const pct = all ? Math.round((done / all) * 100) : 0;
  const org = isOrganizer();
  const busy = state.busy ? 'disabled' : '';
  const canStart = Object.keys(DIVISIONS).some((d) => state.teams.filter((t) => t.division === d).length >= 2);

  return `
    <section class="status card">
      <div class="status-main">
        <div>
          <span class="phase ${isSetup() ? 'setup' : 'active'}">${isSetup() ? '籌備中' : '比賽進行中'}</span>
          <span class="chip">${esc(fmt.label)}</span>
        </div>
        ${
          isSetup()
            ? `<p class="status-text">${org ? '確認名單與賽制後，按「產生賽程並開賽」。' : '主辦單位正在安排名單，開賽後這裡會自動顯示賽程。'}</p>`
            : `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="賽事進度">
                 <div class="progress-bar" style="width:${pct}%"></div>
               </div>
               <p class="status-text">賽事進度 <b>${done}</b> / ${all} 場（${pct}%）</p>`
        }
      </div>

      ${
        org && isSetup()
          ? `<div class="format-pick" role="radiogroup" aria-label="賽制">
               ${Object.entries(FORMATS)
                 .map(
                   ([key, f]) => `<button class="seg ${state.settings.match_format === key ? 'on' : ''}" role="radio" aria-checked="${state.settings.match_format === key}" data-action="set-format" data-format="${key}" ${busy}>${f.label}</button>`
                 )
                 .join('')}
             </div>`
          : ''
      }

      <div class="actions">
        ${org && isSetup() ? `<button class="btn primary" data-action="start" ${canStart && !state.busy ? '' : 'disabled'}>產生賽程並開賽</button>` : ''}
        <button class="btn" data-action="export-excel">匯出 Excel</button>
        <button class="btn" data-action="print">列印成績</button>
        <button class="btn" data-action="copy-link">複製網址</button>
        ${
          org
            ? `<details class="more">
                 <summary class="btn">更多管理</summary>
                 <div class="more-menu">
                   ${!isSetup() ? `<button class="btn" data-action="reset" ${busy}>重設賽程（保留名單）</button>` : ''}
                   <button class="btn" data-action="change-password">變更密碼</button>
                   <button class="btn danger" data-action="wipe" ${busy}>清除全部資料</button>
                 </div>
               </details>`
            : ''
        }
      </div>
    </section>`;
}

function renderTabs() {
  return `
    <nav class="tabs" aria-label="組別">
      ${Object.entries(DIVISIONS)
        .map(([key, label]) => {
          const count = state.teams.filter((t) => t.division === key).length;
          return `<button class="tab ${state.division === key ? 'on' : ''}" data-action="division" data-division="${key}" aria-pressed="${state.division === key}">${label}<span class="count">${count} 隊</span></button>`;
        })
        .join('')}
    </nav>
    <nav class="subtabs" aria-label="內容">
      ${Object.entries(SECTIONS)
        .map(([key, label]) => `<button class="subtab ${state.section === key ? 'on' : ''}" data-action="section" data-section="${key}" aria-pressed="${state.section === key}">${label}</button>`)
        .join('')}
    </nav>`;
}

function myTeamPicker() {
  const teams = state.teams.filter((t) => t.division === state.division);
  if (!teams.length) return '';
  const mine = teams.some((t) => t.id === state.myTeam) ? state.myTeam : '';
  return `
    <div class="picker">
      <label for="my-team">我的隊伍</label>
      <select id="my-team" data-change="my-team">
        <option value="">（不指定）</option>
        ${teams.map((t) => `<option value="${t.id}" ${t.id === mine ? 'selected' : ''}>${esc(t.player_a)} & ${esc(t.player_b)}</option>`).join('')}
      </select>
    </div>`;
}

function renderRankings(rankings) {
  if (!rankings.length) return emptyState('這個組別還沒有隊伍。');
  const org = isOrganizer();
  const needDraw = rankings.some((s) => s.drawTied && s.team.draw_rank == null);
  return `
    ${myTeamPicker()}
    ${needDraw && org ? `<div class="banner warn">有隊伍戰績完全相同，請抽籤後在「抽籤」欄填入順位。</div>` : ''}
    <div class="table-wrap">
      <table class="rank-table">
        <thead><tr><th>名次</th><th class="left">隊伍</th><th>勝</th><th>敗</th><th>局數</th><th class="hide-sm">得失分</th><th class="left hide-sm">判定依據</th></tr></thead>
        <tbody>
          ${rankings
            .map((s) => {
              const medal = s.played > 0 && s.rank <= 3 ? ['🥇', '🥈', '🥉'][s.rank - 1] : '';
              const drawCell =
                s.drawTied && org
                  ? `<label class="draw">抽籤 <select data-change="draw-rank" data-id="${s.team.id}" aria-label="抽籤順位">
                       <option value="">—</option>
                       ${Array.from({ length: rankings.length }, (_, i) => i + 1)
                         .map((n) => `<option value="${n}" ${s.team.draw_rank === n ? 'selected' : ''}>${n}</option>`)
                         .join('')}
                     </select></label>`
                  : '';
              const basis = s.drawTied && s.team.draw_rank == null ? `${s.basis}（未抽籤）` : s.basis;
              return `
                <tr class="${s.team.id === state.myTeam ? 'mine' : ''}">
                  <td class="rank">${medal || s.rank}</td>
                  <td class="left"><div class="team">${esc(s.team.player_a)} & ${esc(s.team.player_b)}</div><div class="basis show-sm">${esc(basis)}</div>${drawCell}</td>
                  <td>${s.wins}</td>
                  <td>${s.losses}</td>
                  <td class="nowrap">${s.gamesWon}:${s.gamesLost}</td>
                  <td class="nowrap hide-sm">${s.pointsWon}:${s.pointsLost}</td>
                  <td class="left hide-sm basis">${esc(basis)}</td>
                </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>
    <p class="note">排名規則：勝場數多者在前。兩隊同勝場看兩隊對戰勝負；三隊以上同勝場，只計算彼此之間的對戰，依序比 場數勝率 → 局數勝率 → 分數勝率 → 抽籤。</p>`;
}

function renderMatches() {
  const matches = divisionMatches(state.division);
  if (!matches.length) {
    return emptyState(isSetup() ? '尚未開賽，主辦單位產生賽程後會顯示在這裡。' : '這個組別沒有對戰（隊伍少於 2 隊）。');
  }
  const mine = state.myTeam && teamById(state.myTeam)?.division === state.division ? state.myTeam : '';
  const shown = mine && state.onlyMine ? matches.filter((m) => m.team1_id === mine || m.team2_id === mine) : matches;
  const rounds = [...new Set(shown.map((m) => m.round))].sort((a, b) => a - b);
  const org = isOrganizer();
  const next = mine ? matches.find((m) => m.status !== 'completed' && (m.team1_id === mine || m.team2_id === mine)) : null;

  return `
    <div class="picker-row">
      ${myTeamPicker()}
      ${mine ? `<label class="check"><input type="checkbox" data-change="only-mine" ${state.onlyMine ? 'checked' : ''}> 只看我的比賽</label>` : ''}
    </div>
    ${mine ? `<div class="banner info">${next ? `你的下一場：第 ${next.round} 輪 對上 <b>${esc(teamName(next.team1_id === mine ? next.team2_id : next.team1_id))}</b>` : '你的比賽都打完了 🎉'}</div>` : ''}
    ${rounds
      .map(
        (round) => `
      <h3 class="round-title">第 ${round} 輪</h3>
      <div class="match-grid">
        ${shown.filter((m) => m.round === round).map((m) => matchCard(m, mine, org)).join('')}
      </div>`
      )
      .join('')}`;
}

function matchCard(m, mine, org) {
  const w1 = gamesWon(m.games, 1);
  const w2 = gamesWon(m.games, 2);
  const isMine = mine && (m.team1_id === mine || m.team2_id === mine);
  const games = m.games || [];
  // 每隊一列：隊名、各局得分（贏的局加粗）、總局數
  const side = (id, wins, idx) => `
    <span class="side ${m.winner_id === id ? 'won' : ''} ${id === mine ? 'me' : ''}">
      <span class="name">${esc(teamName(id))}</span>
      <span class="pts">${games.map((g) => `<span class="pt ${gameWinner(g) === idx + 1 ? 'w' : ''}">${Number(g[idx])}</span>`).join('')}</span>
      <span class="score">${m.status === 'not_started' ? '' : wins}</span>
    </span>`;
  const tag = org ? 'button' : 'div';
  const attrs = org ? `data-action="open-match" data-id="${m.id}" type="button" aria-label="輸入比分：${esc(teamName(m.team1_id))} 對 ${esc(teamName(m.team2_id))}"` : '';
  return `
    <${tag} class="match ${m.status} ${isMine ? 'mine' : ''}" ${attrs}>
      <span class="match-top"><span class="status-badge ${m.status}">${statusLabel(m)}</span><span class="fmt">${formatOf(m).label}</span></span>
      ${side(m.team1_id, w1, 0)}
      ${side(m.team2_id, w2, 1)}
      ${org ? `<span class="edit-hint">${m.status === 'not_started' ? '點此輸入比分' : '點此修改比分'}</span>` : ''}
    </${tag}>`;
}

function renderMatrix(rankings) {
  if (rankings.length < 2) return emptyState('至少需要 2 隊才有對戰表。');
  if (!divisionMatches(state.division).length) return emptyState('開賽後會顯示各隊之間的對戰結果。');
  const order = rankings.map((s) => s.team);
  const find = (a, b) => state.matches.find((m) => (m.team1_id === a && m.team2_id === b) || (m.team1_id === b && m.team2_id === a));
  const cell = (row, col) => {
    if (row.id === col.id) return '<td class="self">—</td>';
    const m = find(row.id, col.id);
    if (!m || m.status === 'not_started') return '<td class="pending"></td>';
    const side = m.team1_id === row.id ? 1 : 2;
    const mineWins = gamesWon(m.games, side);
    const theirWins = gamesWon(m.games, side === 1 ? 2 : 1);
    if (m.status === 'playing') return `<td class="playing">${mineWins}:${theirWins}<small>進行中</small></td>`;
    return `<td class="${m.winner_id === row.id ? 'win' : 'loss'}">${mineWins}:${theirWins}</td>`;
  };
  return `
    <p class="note">從「列」的隊伍角度看局數比分：綠色為勝、紅色為敗。</p>
    <div class="table-wrap">
      <table class="matrix">
        <thead><tr><th></th>${order.map((_, i) => `<th>${i + 1}</th>`).join('')}</tr></thead>
        <tbody>
          ${order
            .map(
              (row, i) => `<tr class="${row.id === state.myTeam ? 'mine' : ''}"><th class="left"><span class="idx">${i + 1}</span>${esc(row.player_a)} & ${esc(row.player_b)}</th>${order.map((col) => cell(row, col)).join('')}</tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function renderTeams() {
  const teams = state.teams.filter((t) => t.division === state.division);
  const editable = isOrganizer() && isSetup();
  const busy = state.busy ? 'disabled' : '';
  const divisionOptions = Object.entries(DIVISIONS)
    .map(([key, label]) => `<option value="${key}" ${key === state.division ? 'selected' : ''}>${label}</option>`)
    .join('');

  return `
    ${
      editable
        ? `<div class="forms">
            <form class="card form" data-form="add-team">
              <h3>新增一組</h3>
              <div class="row">
                <label>選手一<input name="a" required maxlength="40" autocomplete="off"></label>
                <label>選手二<input name="b" required maxlength="40" autocomplete="off"></label>
              </div>
              <label>組別<select name="division">${divisionOptions}</select></label>
              <button class="btn primary" ${busy}>新增</button>
            </form>
            <form class="card form" data-form="bulk-import">
              <h3>批次匯入</h3>
              <label>每行一組，兩位選手用空白、逗號或 / 分開；可在後面加「競賽」或「歡樂」指定組別
                <textarea name="text" rows="5" placeholder="王小明 李大華&#10;陳志強/林建宏 競賽&#10;許文彬,楊佩珊,歡樂"></textarea>
              </label>
              <label>未指定時的組別<select name="division">${divisionOptions}</select></label>
              <button class="btn primary" ${busy}>匯入</button>
            </form>
          </div>`
        : isOrganizer()
          ? `<div class="banner info">比賽進行中，名單已鎖定。如需修改名單，請先在「更多管理」重設賽程。</div>`
          : ''
    }
    ${
      teams.length
        ? `<ul class="team-list">
            ${teams
              .map(
                (t, i) => `
              <li class="${t.id === state.myTeam ? 'mine' : ''}">
                <span class="idx">${i + 1}</span>
                <span class="team">${esc(t.player_a)} & ${esc(t.player_b)}</span>
                ${
                  editable
                    ? `<span class="row-actions">
                         <button class="btn small" data-action="edit-team" data-id="${t.id}">修改</button>
                         <button class="btn small danger" data-action="delete-team" data-id="${t.id}" ${busy}>刪除</button>
                       </span>`
                    : ''
                }
              </li>`
              )
              .join('')}
          </ul>`
        : emptyState('這個組別還沒有隊伍。')
    }`;
}

const emptyState = (text) => `<div class="empty"><span aria-hidden="true">🏓</span><p>${esc(text)}</p></div>`;

// ---------------------------------------------------------------- 對話框

function openModal(html, onReady) {
  const previousFocus = document.activeElement;
  modalRoot.innerHTML = `<div class="backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const backdrop = modalRoot.querySelector('.backdrop');
  const close = () => {
    modalRoot.innerHTML = '';
    document.removeEventListener('keydown', onKey);
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
  });
  onReady(modalRoot.querySelector('.modal'), close);
  if (!modalRoot.contains(document.activeElement)) modalRoot.querySelector('input, button:not([data-close])')?.focus();
}

function openLoginModal() {
  openModal(
    `<h2>主辦單位登入</h2>
     <form data-modal-form>
       <label>帳號<input name="email" type="email" required autocomplete="username" value="${esc(ORGANIZER_EMAIL)}"></label>
       <label>密碼<input name="password" type="password" required autocomplete="current-password"></label>
       <p class="error" hidden></p>
       <div class="modal-actions"><button type="button" class="btn" data-close>取消</button><button class="btn primary">登入</button></div>
     </form>`,
    (modal, close) => {
      const form = modal.querySelector('form');
      modal.querySelector('[name=password]').focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = form.querySelector('.error');
        const button = form.querySelector('.primary');
        button.disabled = true;
        try {
          await backend.signIn(form.email.value.trim(), form.password.value);
          close();
          toast('已登入主辦模式', 'ok');
        } catch (err) {
          errorEl.textContent = err.message;
          errorEl.hidden = false;
          form.password.value = '';
          form.password.focus();
        } finally {
          button.disabled = false;
        }
      });
    }
  );
}

function openPasswordModal() {
  openModal(
    `<h2>變更主辦密碼</h2>
     <form data-modal-form>
       <label>目前密碼<input name="current" type="password" required autocomplete="current-password"></label>
       <label>新密碼（至少 6 個字元）<input name="next" type="password" required minlength="6" autocomplete="new-password"></label>
       <label>再輸入一次新密碼<input name="confirm" type="password" required minlength="6" autocomplete="new-password"></label>
       <p class="error" hidden></p>
       <div class="modal-actions"><button type="button" class="btn" data-close>取消</button><button class="btn primary">更新密碼</button></div>
     </form>`,
    (modal, close) => {
      const form = modal.querySelector('form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = form.querySelector('.error');
        const fail = (msg) => { errorEl.textContent = msg; errorEl.hidden = false; };
        if (form.next.value !== form.confirm.value) return fail('兩次輸入的新密碼不一樣');
        const button = form.querySelector('.primary');
        button.disabled = true;
        try {
          await backend.changePassword(state.user.email, form.current.value, form.next.value);
          close();
          toast('密碼已更新，其他裝置下次登入請使用新密碼', 'ok');
        } catch (err) {
          fail(err.message);
        } finally {
          button.disabled = false;
        }
      });
    }
  );
}

function openTeamModal(team) {
  const divisionOptions = Object.entries(DIVISIONS)
    .map(([key, label]) => `<option value="${key}" ${key === team.division ? 'selected' : ''}>${label}</option>`)
    .join('');
  openModal(
    `<h2>修改隊伍</h2>
     <form data-modal-form>
       <label>選手一<input name="a" required maxlength="40" value="${esc(team.player_a)}"></label>
       <label>選手二<input name="b" required maxlength="40" value="${esc(team.player_b)}"></label>
       <label>組別<select name="division">${divisionOptions}</select></label>
       <div class="modal-actions"><button type="button" class="btn" data-close>取消</button><button class="btn primary">儲存</button></div>
     </form>`,
    (modal, close) => {
      const form = modal.querySelector('form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const patch = { player_a: form.a.value.trim(), player_b: form.b.value.trim(), division: form.division.value };
        if (!patch.player_a || !patch.player_b) return;
        close();
        await run(() => backend.updateTeam(team.id, patch), '隊伍已更新');
        await reload();
      });
    }
  );
}

function openScoreModal(match) {
  const fmt = formatOf(match);
  const name1 = teamName(match.team1_id);
  const name2 = teamName(match.team2_id);
  const saved = (match.games || []).filter(Array.isArray);
  const cellValue = (i, side) => (saved[i] ? String(saved[i][side]) : '');
  const scoreInput = (i, side, label) =>
    `<input class="pt-input" type="number" inputmode="numeric" min="0" max="99" data-game="${i}" data-side="${side}" value="${cellValue(i, side)}" aria-label="第 ${i + 1} 局 ${esc(label)} 得分">`;

  openModal(
    `<h2>第 ${match.round} 輪・${esc(fmt.label)}</h2>
     <div class="score-head"><span>${esc(name1)}</span><b class="score-total"></b><span>${esc(name2)}</span></div>
     <p class="score-hint">輸入每一局兩隊的得分（例如 11 : 8），勝方會自動判定。</p>
     <div class="game-rows">
       ${Array.from({ length: fmt.games }, (_, i) => `
         <div class="game-row" data-row="${i}">
           <span class="game-label">第 ${i + 1} 局</span>
           ${scoreInput(i, 0, name1)}
           <span class="colon">:</span>
           ${scoreInput(i, 1, name2)}
           <span class="row-note" aria-live="polite"></span>
         </div>`).join('')}
     </div>
     <p class="score-result"></p>
     <div class="modal-actions">
       <button type="button" class="btn" data-clear>清除比分</button>
       <button type="button" class="btn" data-close>取消</button>
       <button type="button" class="btn primary" data-save>儲存</button>
     </div>`,
    (modal, close) => {
      const rowEls = [...modal.querySelectorAll('.game-row')];
      const read = (i) => {
        const [a, b] = rowEls[i].querySelectorAll('.pt-input');
        const filled = a.value !== '' && b.value !== '';
        return { a: Number(a.value), b: Number(b.value), filled, empty: a.value === '' && b.value === '' };
      };
      // 從第一局往後讀，直到遇到未完成的局或已分出勝負
      const evaluate = () => {
        const games = [];
        let problem = null;
        let w1 = 0;
        let w2 = 0;
        for (let i = 0; i < fmt.games && w1 < fmt.wins && w2 < fmt.wins; i++) {
          const r = read(i);
          if (r.empty) break;
          const valid = r.filled && Number.isInteger(r.a) && Number.isInteger(r.b) && r.a >= 0 && r.b >= 0 && r.a !== r.b;
          if (!valid) {
            problem = { i, message: r.filled && r.a === r.b ? '同分無法判定勝方' : '請填完兩隊得分' };
            break;
          }
          games.push([r.a, r.b]);
          if (r.a > r.b) w1++;
          else w2++;
        }
        return { games, problem, w1, w2, decided: w1 >= fmt.wins || w2 >= fmt.wins };
      };
      const draw = () => {
        const { games, problem, w1, w2, decided } = evaluate();
        const visible = Math.min(fmt.games, decided ? games.length : games.length + 1);
        rowEls.forEach((row, i) => {
          row.hidden = i >= visible;
          const note = row.querySelector('.row-note');
          const g = games[i];
          row.classList.toggle('w1', !!g && g[0] > g[1]);
          row.classList.toggle('w2', !!g && g[1] > g[0]);
          if (problem && problem.i === i) {
            note.textContent = problem.message;
            note.className = 'row-note bad';
          } else if (g && !isStandardGame(g[0], g[1])) {
            note.textContent = '非 11 分制比分，請再確認';
            note.className = 'row-note warn';
          } else {
            note.textContent = '';
            note.className = 'row-note';
          }
        });
        modal.querySelector('.score-total').textContent = `${w1} : ${w2}`;
        modal.querySelector('.score-result').innerHTML = decided
          ? `🏆 勝方：<b>${esc(w1 > w2 ? name1 : name2)}</b>`
          : games.length ? '比賽進行中，可先儲存目前比分。' : '';
      };

      modal.querySelector('.game-rows').addEventListener('input', draw);
      // 按 Enter 跳到下一格，方便連續輸入
      modal.querySelector('.game-rows').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !e.target.matches('.pt-input')) return;
        e.preventDefault();
        const inputs = [...modal.querySelectorAll('.game-row:not([hidden]) .pt-input')];
        const next = inputs[inputs.indexOf(e.target) + 1];
        if (next) next.focus();
        else modal.querySelector('[data-save]').focus();
      });
      modal.querySelector('[data-clear]').addEventListener('click', () => {
        modal.querySelectorAll('.pt-input').forEach((input) => { input.value = ''; });
        draw();
        modal.querySelector('.pt-input').focus();
      });
      modal.querySelector('[data-save]').addEventListener('click', async () => {
        const { games, problem, w1, w2 } = evaluate();
        if (problem) {
          modal.querySelector('.score-result').innerHTML = `<span class="error">第 ${problem.i + 1} 局：${problem.message}</span>`;
          rowEls[problem.i].querySelector('.pt-input').focus();
          return;
        }
        const winner = w1 >= fmt.wins ? match.team1_id : w2 >= fmt.wins ? match.team2_id : null;
        const status = winner ? 'completed' : games.length ? 'playing' : 'not_started';
        close();
        await run(() => backend.saveMatch(match.id, { games, winner_id: winner, status }), '比分已儲存');
        await reload();
      });
      draw();
      const firstEmpty = [...modal.querySelectorAll('.game-row:not([hidden]) .pt-input')].find((input) => input.value === '');
      (firstEmpty || modal.querySelector('.pt-input')).focus();
    }
  );
}

// ---------------------------------------------------------------- 操作

function parseBulk(text, fallbackDivision) {
  const rows = [];
  const skipped = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[\s,，、\/／&＆+]+/).filter(Boolean);
    let division = fallbackDivision;
    const last = parts[parts.length - 1] || '';
    if (parts.length >= 3 && /競賽|competitive/i.test(last)) { division = 'competitive'; parts.pop(); }
    else if (parts.length >= 3 && /歡樂|成長|fun/i.test(last)) { division = 'fun'; parts.pop(); }
    if (parts.length !== 2 || parts.some((p) => p.length > 40)) {
      skipped.push(line);
      continue;
    }
    rows.push({ player_a: parts[0], player_b: parts[1], division });
  }
  return { rows, skipped };
}

function buildReport() {
  return {
    title: '桌球雙打賽成績',
    formatLabel: (FORMATS[state.settings.match_format] || FORMATS.best_of_3).label,
    generatedAt: new Date(),
    divisions: Object.entries(DIVISIONS)
      .filter(([key]) => state.teams.some((t) => t.division === key))
      .map(([key, label]) => ({ label, rankings: computeRankings(state.teams, state.matches, key), matches: divisionMatches(key) })),
    teamName,
    shortName: (id) => (teamById(id) ? `${teamById(id).player_a}隊` : '（已刪除）'),
    statusLabel,
  };
}

const actions = {
  retry: () => { state.error = null; render(); reload(); },
  division: ({ division }) => { state.division = division; store.set('division', division); render(); },
  section: ({ section }) => { state.section = section; store.set('section', section); render(); },
  login: openLoginModal,
  logout: async () => { await backend.signOut(); toast('已登出'); },
  'set-format': ({ format }) => {
    if (format === state.settings.match_format) return;
    run(() => backend.setMatchFormat(format), `賽制改為${FORMATS[format].label}`).then(reload);
  },
  start: () => {
    const fmt = FORMATS[state.settings.match_format] || FORMATS.best_of_3;
    const summary = Object.entries(DIVISIONS)
      .map(([key, label]) => `${label} ${state.teams.filter((t) => t.division === key).length} 隊`)
      .join('、');
    if (!confirm(`確定以「${fmt.label}」產生單循環賽程並開賽？\n${summary}\n\n開賽後名單會鎖定。`)) return;
    const rows = Object.keys(DIVISIONS).flatMap((division) =>
      generateRoundRobin(state.teams.filter((t) => t.division === division), division, state.settings.match_format)
    );
    run(() => backend.startTournament(rows, state.settings.match_format), `已產生 ${rows.length} 場比賽，正式開賽！`).then((ok) => {
      if (ok) { state.section = 'matches'; store.set('section', 'matches'); }
      return reload();
    });
  },
  reset: () => {
    if (!confirm('重設賽程會清除所有比分與賽程，但保留隊伍名單。確定嗎？')) return;
    if (!confirm('再次確認：清除後無法復原。')) return;
    run(() => backend.resetTournament(), '賽程已清除，回到籌備階段').then(reload);
  },
  wipe: () => {
    if (!confirm('⚠️ 這會刪除「所有隊伍、賽程與比分」。確定嗎？')) return;
    if (!confirm('最後確認：全部資料將無法復原。')) return;
    run(() => backend.wipeAll(), '全部資料已清除').then(reload);
  },
  'change-password': () => {
    if (backend.isDemo) return toast('示範模式無法變更密碼');
    openPasswordModal();
  },
  'export-excel': () => {
    try { exportExcel(buildReport()); } catch (err) { toast(err.message, 'error'); }
  },
  print: () => printReport(buildReport()),
  'copy-link': async () => {
    const url = location.origin + location.pathname + (demo ? '?demo' : '');
    try {
      await navigator.clipboard.writeText(url);
      toast('網址已複製，可以貼到 LINE 給選手', 'ok');
    } catch {
      prompt('請複製這個網址：', url);
    }
  },
  'open-match': ({ id }) => {
    const match = state.matches.find((m) => m.id === id);
    if (match && isOrganizer()) openScoreModal(match);
  },
  'edit-team': ({ id }) => {
    const team = teamById(id);
    if (team) openTeamModal(team);
  },
  'delete-team': ({ id }) => {
    if (!confirm(`確定刪除「${teamName(id)}」？`)) return;
    run(() => backend.deleteTeam(id), '已刪除').then(reload);
  },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const handler = actions[el.dataset.action];
  if (handler) handler(el.dataset, el);
});

app.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  if (el.dataset.change === 'my-team') {
    state.myTeam = el.value;
    store.set('myTeam', el.value);
    el.blur();
    render();
  } else if (el.dataset.change === 'only-mine') {
    state.onlyMine = el.checked;
    store.set('onlyMine', el.checked ? '1' : '');
    render();
  } else if (el.dataset.change === 'draw-rank') {
    const value = el.value ? Number(el.value) : null;
    el.blur();
    run(() => backend.updateTeam(el.dataset.id, { draw_rank: value }), '抽籤順位已更新').then(reload);
  }
});

app.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'add-team') {
    const row = { player_a: form.a.value.trim(), player_b: form.b.value.trim(), division: form.division.value };
    if (!row.player_a || !row.player_b) return;
    if (await run(() => backend.addTeams([row]), `已新增 ${row.player_a} & ${row.player_b}`)) {
      form.reset();
      await reload();
    }
  } else if (form.dataset.form === 'bulk-import') {
    const { rows, skipped } = parseBulk(form.text.value, form.division.value);
    if (!rows.length) {
      toast(skipped.length ? `看不懂這些行：${skipped.slice(0, 3).join('｜')}` : '請先貼上名單', 'error');
      return;
    }
    if (await run(() => backend.addTeams(rows))) {
      toast(`已匯入 ${rows.length} 組${skipped.length ? `，略過 ${skipped.length} 行：${skipped.slice(0, 3).join('｜')}` : ''}`, skipped.length ? 'info' : 'ok');
      form.reset();
      await reload();
    }
  }
});

// ---------------------------------------------------------------- 啟動

async function init() {
  if (!demo && !isConfigured()) {
    app.innerHTML = `
      <div class="center-card">
        <h2>🏓 尚未連接資料庫</h2>
        <p>請在 <code>js/config.js</code> 填入 Supabase 專案網址與金鑰，設定步驟請見 README。</p>
        <p><a class="btn primary" href="?demo">先試用示範模式</a></p>
      </div>`;
    return;
  }
  render();
  try {
    backend = await createBackend({ demo });
  } catch (err) {
    console.error(err);
    state.error = '無法載入資料庫模組，請檢查網路連線後重新整理。';
    render();
    return;
  }
  state.user = await backend.getUser();
  backend.onAuthChange((user) => {
    state.user = user;
    render();
  });
  await reload();
  backend.subscribe(scheduleReload);
  // 手機螢幕關掉再打開時，重新抓一次最新資料
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleReload(); });
}

init();
