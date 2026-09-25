interface JournalEntry {
  id: string;
  ts: number;
  kind: string;
  label: string;
  undoable: boolean;
  undone?: boolean;
  before?: RW.AppCore;
}

interface PersistedApp {
  core: RW.AppCore;
  journal: JournalEntry[];
}

const STORAGE_KEY = 'riichi-wind-board.v1';
const APP_VERSION = '0.2.5';
let core: RW.AppCore;
let journal: JournalEntry[] = [];
let activeTab: 'game' | 'log' | 'settings' = 'game';
let menuOpen = false;
let selectedPlayer = 0;

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el as T;
};

function nowId(prefix = 'e'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadApp(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedApp;
      if (parsed?.core?.game?.scores && parsed?.core?.config) {
        core = parsed.core;
        core.config = {
          ...RW.clone(RW.DEFAULT_CONFIG),
          ...core.config,
          rules: { ...RW.clone(RW.DEFAULT_CONFIG.rules), ...core.config.rules },
        };
        if (!Array.isArray(core.config.playerNames) || core.config.playerNames.length < 4) {
          core.config.playerNames = RW.clone(RW.DEFAULT_CONFIG.playerNames);
        }
        journal = Array.isArray(parsed.journal) ? parsed.journal : [];
        return;
      }
    }
  } catch (err) {
    console.warn('Failed to restore state', err);
  }
  core = RW.createInitialCore();
  journal = [{
    id: nowId('system'),
    ts: Date.now(),
    kind: 'GAME_START',
    label: `新對局｜四麻・半莊・25000 點`,
    undoable: false,
  }];
  saveApp();
}

function saveApp(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ core, journal }));
}

function runAction(kind: string, label: string, mutator: () => string | void): void {
  const before = RW.clone(core);
  try {
    const detail = mutator();
    journal.push({
      id: nowId(),
      ts: Date.now(),
      kind,
      label: detail || label,
      undoable: true,
      before,
    });
    saveApp();
    render();
  } catch (err) {
    core = before;
    const message = err instanceof Error ? err.message : String(err);
    showToast(message, true);
  }
}

function addLog(kind: string, label: string): void {
  journal.push({ id: nowId(), ts: Date.now(), kind, label, undoable: false });
  saveApp();
}

function undoLast(): void {
  for (let i = journal.length - 1; i >= 0; i--) {
    const entry = journal[i];
    if (!entry.undoable || entry.undone || !entry.before) continue;
    core = RW.clone(entry.before);
    entry.undone = true;
    journal.push({
      id: nowId('undo'),
      ts: Date.now(),
      kind: 'UNDO',
      label: `↶ 復原「${entry.label}」`,
      undoable: false,
    });
    saveApp();
    render();
    showToast('已復原上一步');
    return;
  }
  showToast('沒有可以復原的操作', true);
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('zh-TW');
}

function fmtTime(ts: number): string {
  return new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ts));
}

function modeLabel(mode: RW.Mode): string {
  return mode === 'yonma' ? '四麻' : '三麻';
}

function lengthLabel(length: RW.GameLength): string {
  return length === 'hanchan' ? '半莊' : '東風';
}

function playerLabel(index: number): string {
  return core.config.playerNames?.[index]?.trim() || `玩家 ${String.fromCharCode(65 + index)}`;
}

function windLabel(index: number): string {
  return `${RW.WIND_NAMES[RW.seatWind(core.game, index)]}家`;
}

function render(): void {
  renderTabs();
  renderGame();
  renderLog();
  renderSettings();
  $('#undo-button').toggleAttribute('disabled', !journal.some(e => e.undoable && !e.undone));
  $('#app-version').textContent = `v${APP_VERSION}`;
}

function renderTabs(): void {
  document.body.dataset.activeTab = activeTab;
  document.body.classList.toggle('menu-open', menuOpen);
  const menuToggle = $('#menu-toggle-button');
  menuToggle.textContent = menuOpen ? '隱藏' : '顯示';
  menuToggle.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === activeTab);
  });
  document.querySelectorAll<HTMLElement>('.view').forEach(el => {
    el.classList.toggle('active', el.id === `view-${activeTab}`);
  });
}

function playerPositionClass(index: number, mode: RW.Mode): string {
  if (mode === 'yonma') return ['pos-bottom', 'pos-right', 'pos-top', 'pos-left'][index];
  if (index === 2) return core.config.sanmaThirdSeat === 'top' ? 'pos-top' : 'pos-left';
  return ['pos-bottom', 'pos-right'][index];
}

function renderGame(): void {
  const game = core.game;
  const board = $('#board');
  board.className = `board ${game.mode}`;
  const players = $('#players-layer');
  players.innerHTML = '';

  board.style.setProperty('--center-text-scale', String((core.config.centerTextScale || 100) / 100));

  for (let i = 0; i < game.scores.length; i++) {
    const seat = document.createElement('div');
    seat.className = `player-seat ${playerPositionClass(i, game.mode)}`;

    const card = document.createElement('button');
    card.className = `player-card ${i === game.dealerIndex ? 'dealer' : ''}`;
    card.dataset.player = String(i);
    card.innerHTML = `
      ${i === game.dealerIndex ? '<span class="dealer-badge">莊家</span>' : ''}
      <span class="player-meta">${escapeHtml(playerLabel(i))}</span>
      <strong class="wind-badge">${windLabel(i)}</strong>
      <span class="score-value">${fmt(game.scores[i])}</span>
    `;
    card.addEventListener('click', () => openPlayerSheet(i));

    const riichi = document.createElement('button');
    riichi.className = `riichi-stick-button ${game.riichiDeclared[i] ? 'declared' : ''}`;
    riichi.type = 'button';
    riichi.title = game.riichiDeclared[i] ? '本局已立直' : `${playerLabel(i)} 立直（-1000）`;
    riichi.setAttribute('aria-label', riichi.title);
    riichi.disabled = game.ended || game.riichiDeclared[i] || game.scores[i] < 1000;
    riichi.addEventListener('click', () => {
      selectedPlayer = i;
      declareSelectedRiichi();
    });

    seat.append(card, riichi);
    players.appendChild(seat);
  }

  $('#round-main').textContent = RW.roundLabel(game);
  $('#honba-main').textContent = `${game.honba} 本場`;
  $('#honba-dots').innerHTML = Array.from({ length: game.honba }, () => '<i></i>').join('');
  $('#honba-dots').setAttribute('aria-label', `${game.honba} 本場`);
  $('#kyotaku-main').textContent = `供託 ${game.riichiSticks}`;
  $('#mode-main').textContent = `${modeLabel(game.mode)}・${lengthLabel(game.gameLength)}`;
  $('#game-state-note').textContent = game.ended ? '本場已結束，可到設定開新局' : '點玩家分數記錄事件；點中央可流局';
  $('#center-card').classList.toggle('ended', game.ended);
}

function renderLog(): void {
  const list = $('#log-list');
  list.innerHTML = '';
  [...journal].reverse().forEach(entry => {
    const row = document.createElement('article');
    row.className = `log-row ${entry.kind.toLowerCase()} ${entry.undone ? 'undone' : ''}`;
    row.innerHTML = `
      <div class="log-icon">${logIcon(entry.kind)}</div>
      <div class="log-body">
        <div class="log-title">${escapeHtml(entry.label)}</div>
        <div class="log-meta">${fmtTime(entry.ts)}・${entry.kind}${entry.undone ? '・已被復原' : ''}</div>
      </div>
    `;
    list.appendChild(row);
  });
  if (!journal.length) list.innerHTML = '<div class="empty-state">目前沒有紀錄</div>';
}

function logIcon(kind: string): string {
  const map: Record<string, string> = {
    GAME_START: '◉', RIICHI: '立', RON: '榮', TSUMO: '摸', DRAW: '流',
    NAGASHI_MANGAN: '滿', ABORTIVE_DRAW: '+1', DEALER_OVERRIDE: '莊',
    MANUAL_SCORE: '✎', SETTING: '⚙', UNDO: '↶',
  };
  return map[kind] || '•';
}

function renderSettings(): void {
  const c = core.config;
  const game = core.game;
  (document.querySelector(`input[name="mode"][value="${c.mode}"]`) as HTMLInputElement).checked = true;
  (document.querySelector(`input[name="length"][value="${c.gameLength}"]`) as HTMLInputElement).checked = true;
  ($('#start-yonma') as HTMLInputElement).value = String(c.startYonma);
  ($('#start-sanma') as HTMLInputElement).value = String(c.startSanma);
  ($('#rule-kiriage') as HTMLInputElement).checked = c.rules.kiriageMangan;
  ($('#rule-atamahane') as HTMLInputElement).checked = c.rules.atamahane;
  ($('#rule-kazoe') as HTMLInputElement).checked = c.rules.kazoeYakuman;
  ($('#rule-multiple-yakuman') as HTMLInputElement).checked = c.rules.multipleYakuman;
  (document.querySelector(`input[name="sanma-third-seat"][value="${c.sanmaThirdSeat}"]`) as HTMLInputElement).checked = true;
  ($('#center-text-scale') as HTMLInputElement).value = String(c.centerTextScale);
  $('#center-text-scale-value').textContent = `${c.centerTextScale}%`;
  $('#current-game-summary').textContent = `目前：${modeLabel(game.mode)}・${lengthLabel(game.gameLength)}・${RW.roundLabel(game)}・${game.honba}本場`;

  const names = $('#player-name-fields');
  names.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const row = document.createElement('label');
    row.className = 'player-name-row';
    row.innerHTML = `<span>玩家 ${String.fromCharCode(65 + i)}</span><input data-player-name-index="${i}" type="text" maxlength="20" value="${escapeHtml(playerLabel(i))}">`;
    names.appendChild(row);
  }
  names.querySelectorAll<HTMLInputElement>('[data-player-name-index]').forEach(input => {
    input.addEventListener('change', () => {
      const i = Number(input.dataset.playerNameIndex);
      const next = core.config.playerNames.slice();
      next[i] = input.value.trim() || `玩家 ${String.fromCharCode(65 + i)}`;
      updateConfig('playerNames', next, `玩家 ${String.fromCharCode(65 + i)} 名稱：${next[i]}`);
    });
  });

  const dealerControls = $('#dealer-override-fields');
  dealerControls.innerHTML = '';
  game.scores.forEach((_, i) => {
    const button = document.createElement('button');
    button.className = `dealer-choice-button ${i === game.dealerIndex ? 'active' : ''}`;
    button.textContent = `${playerLabel(i)}・${windLabel(i)}`;
    button.addEventListener('click', () => {
      runAction('DEALER_OVERRIDE', '手動指定莊家', () => {
        RW.overrideDealer(core.game, i);
        return `手動指定莊家：${playerLabel(i)}`;
      });
    });
    dealerControls.appendChild(button);
  });

  const manual = $('#manual-score-fields');
  manual.innerHTML = '';
  game.scores.forEach((score, i) => {
    const row = document.createElement('label');
    row.className = 'score-edit-row';
    row.innerHTML = `<span>${playerLabel(i)}・${windLabel(i)}</span><input data-score-index="${i}" type="number" step="100" value="${score}">`;
    manual.appendChild(row);
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]!));
}

function openPlayerSheet(player: number): void {
  selectedPlayer = player;
  const game = core.game;
  $('#sheet-title').textContent = `${playerLabel(player)}・${windLabel(player)}`;
  $('#sheet-score').textContent = `${fmt(game.scores[player])} 點`;
  ($('#action-ron') as HTMLButtonElement).disabled = game.ended;
  ($('#action-tsumo') as HTMLButtonElement).disabled = game.ended;
  ($('#action-draw') as HTMLButtonElement).disabled = game.ended;
  openSheet('player-sheet');
}

function openSheet(id: string): void {
  $(`#${id}`).classList.add('open');
  $('#sheet-backdrop').classList.add('open');
  document.body.classList.add('sheet-open');
}

function closeSheets(): void {
  document.querySelectorAll('.sheet').forEach(el => el.classList.remove('open'));
  $('#sheet-backdrop').classList.remove('open');
  document.body.classList.remove('sheet-open');
}

function showToast(message: string, error = false): void {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2200);
}

function declareSelectedRiichi(): void {
  const p = selectedPlayer;
  runAction('RIICHI', `${windLabel(p)} 立直`, () => {
    const before = core.game.scores[p];
    RW.declareRiichi(core.game, p);
    return `${windLabel(p)} 立直｜${fmt(before)} → ${fmt(core.game.scores[p])}｜供託 ${core.game.riichiSticks}`;
  });
  closeSheets();
}

function scoreControlHtml(prefix: string, title: string): string {
  return `
    <div class="hand-score" data-score-prefix="${prefix}">
      <div class="hand-score-title">${title}</div>
      <div class="score-grid">
        <label>計分方式
          <select id="${prefix}-limit" data-score-update="${prefix}">
            <option value="normal">番／符</option>
            <option value="mangan">滿貫</option>
            <option value="haneman">跳滿</option>
            <option value="baiman">倍滿</option>
            <option value="sanbaiman">三倍滿</option>
            <option value="yakuman">役滿</option>
          </select>
        </label>
        <label>番
          <input id="${prefix}-han" data-score-update="${prefix}" type="number" min="1" max="99" value="3">
        </label>
        <label>符
          <select id="${prefix}-fu" data-score-update="${prefix}">
            ${[20,25,30,40,50,60,70,80,90,100,110].map(v => `<option value="${v}" ${v===40?'selected':''}>${v}</option>`).join('')}
          </select>
        </label>
        <label id="${prefix}-yakuman-wrap" class="yakuman-wrap hidden">役滿倍數
          <input id="${prefix}-yakuman" data-score-update="${prefix}" type="number" min="1" max="20" value="1">
        </label>
      </div>
      <div id="${prefix}-preview" class="score-preview"></div>
    </div>
  `;
}

function readScoreInput(prefix: string): RW.ScoreInput {
  const limit = ($(`#${prefix}-limit`) as HTMLSelectElement).value as RW.LimitKind;
  return {
    limit,
    han: Number(($(`#${prefix}-han`) as HTMLInputElement).value || 1),
    fu: Number(($(`#${prefix}-fu`) as HTMLSelectElement).value || 30),
    yakumanMultiplier: Number(($(`#${prefix}-yakuman`) as HTMLInputElement).value || 1),
  };
}

function scorePreviewText(input: RW.ScoreInput, winner: number, tsumo: boolean): string {
  const calc = RW.calculateBase(input, core.config.rules);
  if (!tsumo) {
    const points = RW.ronPoints(calc.base, winner === core.game.dealerIndex);
    return `${calc.label}・${fmt(points)} 點（未含本場／供託）`;
  }
  const pieces: number[] = [];
  for (let payer = 0; payer < core.game.scores.length; payer++) {
    if (payer === winner) continue;
    pieces.push(RW.tsumoPayment(calc.base, winner === core.game.dealerIndex, payer === core.game.dealerIndex));
  }
  return `${calc.label}・支付 ${pieces.map(fmt).join(' / ')}（未含本場／供託）`;
}

function bindScoreControls(prefix: string, winner: number, tsumo: boolean): void {
  const update = () => {
    const input = readScoreInput(prefix);
    const isYakuman = input.limit === 'yakuman';
    $(`#${prefix}-yakuman-wrap`).classList.toggle('hidden', !isYakuman);
    ($(`#${prefix}-han`) as HTMLInputElement).disabled = input.limit !== 'normal';
    ($(`#${prefix}-fu`) as HTMLSelectElement).disabled = input.limit !== 'normal';
    $(`#${prefix}-preview`).textContent = scorePreviewText(input, winner, tsumo);
  };
  document.querySelectorAll<HTMLElement>(`[data-score-update="${prefix}"]`).forEach(el => el.addEventListener('input', update));
  update();
}

function openTsumoSheet(): void {
  closeSheets();
  const winner = selectedPlayer;
  const content = $('#settlement-content');
  content.innerHTML = `
    <div class="settlement-heading">
      <div><span class="eyebrow">自摸</span><h2>${playerLabel(winner)}・${windLabel(winner)}</h2></div>
    </div>
    ${scoreControlHtml('tsumo-score', '和牌點數')}
    <button id="confirm-tsumo" class="primary-button">確認自摸</button>
  `;
  bindScoreControls('tsumo-score', winner, true);
  $('#confirm-tsumo').addEventListener('click', () => {
    const score = readScoreInput('tsumo-score');
    runAction('TSUMO', `${windLabel(winner)} 自摸`, () => {
      const result = RW.settleTsumo(core.game, winner, score, core.config.rules);
      return `${result.description}｜${RW.scoreDeltaText(result.deltas)}`;
    });
    closeSheets();
  });
  openSheet('settlement-sheet');
}

function openRonSheet(): void {
  closeSheets();
  const game = core.game;
  const primaryWinner = selectedPlayer;
  const content = $('#settlement-content');
  const loserOptions = game.scores.map((_, i) => i !== primaryWinner ? `<option value="${i}">${playerLabel(i)}・${windLabel(i)}</option>` : '').join('');

  let winnersHtml = '';
  if (core.config.rules.atamahane) {
    winnersHtml = scoreControlHtml(`ron-${primaryWinner}`, `${playerLabel(primaryWinner)}・${windLabel(primaryWinner)}`);
  } else {
    winnersHtml = game.scores.map((_, i) => {
      if (i === primaryWinner) {
        return `<div class="multi-winner-row active" data-winner-row="${i}"><label class="winner-check"><input type="checkbox" data-winner="${i}" checked disabled> ${playerLabel(i)}・${windLabel(i)}</label>${scoreControlHtml(`ron-${i}`, '番符')}</div>`;
      }
      return `<div class="multi-winner-row" data-winner-row="${i}"><label class="winner-check"><input type="checkbox" data-winner="${i}"> ${playerLabel(i)}・${windLabel(i)}</label><div class="optional-score hidden">${scoreControlHtml(`ron-${i}`, '番符')}</div></div>`;
    }).join('');
  }

  content.innerHTML = `
    <div class="settlement-heading"><div><span class="eyebrow">榮和</span><h2>${core.config.rules.atamahane ? '頭ハネ ON' : '複數榮和可用'}</h2></div></div>
    <label class="full-field">放銃者
      <select id="ron-loser">${loserOptions}</select>
    </label>
    <div class="winner-stack">${winnersHtml}</div>
    <div class="rule-note">${core.config.rules.atamahane ? '目前只結算最先選定的和牌者。' : '可勾選多位和牌者，每人可輸入不同番符；供託給距離放銃者最近的和牌者。'}</div>
    <button id="confirm-ron" class="primary-button">確認榮和</button>
  `;

  if (core.config.rules.atamahane) {
    bindScoreControls(`ron-${primaryWinner}`, primaryWinner, false);
  } else {
    game.scores.forEach((_, i) => {
      const checkbox = document.querySelector<HTMLInputElement>(`input[data-winner="${i}"]`);
      if (!checkbox) return;
      const row = document.querySelector<HTMLElement>(`[data-winner-row="${i}"]`)!;
      const optional = row.querySelector<HTMLElement>('.optional-score');
      if (checkbox.checked || i === primaryWinner) bindScoreControls(`ron-${i}`, i, false);
      checkbox.addEventListener('change', () => {
        row.classList.toggle('active', checkbox.checked);
        optional?.classList.toggle('hidden', !checkbox.checked);
        if (checkbox.checked) bindScoreControls(`ron-${i}`, i, false);
      });
    });
  }

  const loserSelect = $('#ron-loser') as HTMLSelectElement;
  loserSelect.addEventListener('change', () => {
    const loser = Number(loserSelect.value);
    document.querySelectorAll<HTMLInputElement>('input[data-winner]').forEach(cb => {
      const idx = Number(cb.dataset.winner);
      if (idx === primaryWinner) {
        if (loser === idx) loserSelect.value = String(game.scores.map((_, j) => j).find(j => j !== idx) ?? 0);
        return;
      }
      cb.disabled = idx === Number(loserSelect.value);
      if (cb.disabled) cb.checked = false;
      cb.dispatchEvent(new Event('change'));
    });
  });

  $('#confirm-ron').addEventListener('click', () => {
    const loser = Number(($('#ron-loser') as HTMLSelectElement).value);
    const entries: RW.RonEntry[] = [];
    if (core.config.rules.atamahane) {
      entries.push({ winner: primaryWinner, score: readScoreInput(`ron-${primaryWinner}`) });
    } else {
      document.querySelectorAll<HTMLInputElement>('input[data-winner]').forEach(cb => {
        const winner = Number(cb.dataset.winner);
        if (cb.checked && winner !== loser) entries.push({ winner, score: readScoreInput(`ron-${winner}`) });
      });
    }
    runAction('RON', `${windLabel(primaryWinner)} 榮和`, () => {
      const result = RW.settleRon(core.game, entries, loser, core.config.rules);
      return `${result.description}｜${RW.scoreDeltaText(result.deltas)}`;
    });
    closeSheets();
  });
  openSheet('settlement-sheet');
}

function openDrawSheet(): void {
  closeSheets();
  const content = $('#settlement-content');

  const renderMenu = () => {
    content.innerHTML = `
      <div class="settlement-heading"><div><span class="eyebrow">流局</span><h2>選擇流局類型</h2></div></div>
      <div class="draw-mode-grid">
        <button id="draw-normal" class="action-tile"><strong>一般流局</strong><small>選聽牌者，結算 3000 點罰符</small></button>
        <button id="draw-nagashi" class="action-tile win"><strong>流局滿貫</strong><small>滿貫自摸點取代聽牌罰符</small></button>
        <button id="draw-abortive" class="action-tile"><strong>中途流局</strong><small>莊家不換、+1 本場、供託保留</small></button>
      </div>
      <div class="rule-note">天鳳式：流局滿貫仍視為流局，不另外收聽牌罰符；本場 +1，供託留桌上。</div>
    `;

    $('#draw-normal').addEventListener('click', renderNormal);
    $('#draw-nagashi').addEventListener('click', renderNagashi);
    $('#draw-abortive').addEventListener('click', renderAbortive);
  };

  const renderBack = () => '<button id="draw-back" class="text-button">‹ 返回流局選單</button>';

  const renderNormal = () => {
    const rows = core.game.scores.map((score, i) => `
      <label class="tenpai-row">
        <input type="checkbox" data-tenpai="${i}">
        <span><strong>${windLabel(i)}</strong><small>${playerLabel(i)}・${fmt(score)}</small></span>
        <span class="tenpai-state">未聽</span>
      </label>
    `).join('');
    content.innerHTML = `
      ${renderBack()}
      <div class="settlement-heading"><div><span class="eyebrow">一般流局</span><h2>點選聽牌者</h2></div></div>
      <div class="tenpai-list">${rows}</div>
      <div id="draw-preview" class="rule-note">無人聽牌：不交換罰符。</div>
      <button id="confirm-draw" class="primary-button">確認一般流局</button>
    `;

    const update = () => {
      const checked = [...document.querySelectorAll<HTMLInputElement>('input[data-tenpai]')].filter(x => x.checked);
      document.querySelectorAll<HTMLInputElement>('input[data-tenpai]').forEach(cb => {
        const row = cb.closest('.tenpai-row')!;
        row.classList.toggle('active', cb.checked);
        (row.querySelector('.tenpai-state') as HTMLElement).textContent = cb.checked ? '聽牌' : '未聽';
      });
      const count = core.game.scores.length;
      if (!checked.length || checked.length === count) {
        $('#draw-preview').textContent = checked.length === count ? '全員聽牌：不交換罰符。' : '無人聽牌：不交換罰符。';
      } else {
        $('#draw-preview').textContent = `3000 點罰符：聽牌每家 +${fmt(3000 / checked.length)}，未聽每家 -${fmt(3000 / (count - checked.length))}`;
      }
    };

    document.querySelectorAll<HTMLInputElement>('input[data-tenpai]').forEach(cb => cb.addEventListener('change', update));
    $('#draw-back').addEventListener('click', renderMenu);
    $('#confirm-draw').addEventListener('click', () => {
      const tenpai = [...document.querySelectorAll<HTMLInputElement>('input[data-tenpai]')].filter(x => x.checked).map(x => Number(x.dataset.tenpai));
      runAction('DRAW', '一般流局', () => {
        const result = RW.settleDraw(core.game, tenpai);
        return `${result.description}｜${RW.scoreDeltaText(result.deltas)}`;
      });
      closeSheets();
    });
    update();
  };

  const renderNagashi = () => {
    const rows = core.game.scores.map((score, i) => `
      <label class="tenpai-row">
        <input type="checkbox" data-nagashi="${i}">
        <span><strong>${windLabel(i)}</strong><small>${playerLabel(i)}・${fmt(score)}</small></span>
        <span class="tenpai-state">未選</span>
      </label>
    `).join('');
    content.innerHTML = `
      ${renderBack()}
      <div class="settlement-heading"><div><span class="eyebrow">流局滿貫</span><h2>選擇成立者</h2></div></div>
      <div class="tenpai-list">${rows}</div>
      <label class="toggle-row compact-toggle">
        <span><strong>莊家聽牌</strong><small>只影響是否連莊；流局滿貫本身不代表聽牌</small></span>
        <input id="nagashi-dealer-tenpai" class="switch-input" type="checkbox">
      </label>
      <div class="rule-note">滿貫自摸點會取代一般流局的 3000 點聽牌罰符；不吃本場、不拿供託。下一局仍 +1 本場，供託保留。</div>
      <button id="confirm-nagashi" class="primary-button">確認流局滿貫</button>
    `;

    document.querySelectorAll<HTMLInputElement>('input[data-nagashi]').forEach(cb => cb.addEventListener('change', () => {
      const row = cb.closest('.tenpai-row')!;
      row.classList.toggle('active', cb.checked);
      (row.querySelector('.tenpai-state') as HTMLElement).textContent = cb.checked ? '成立' : '未選';
    }));
    $('#draw-back').addEventListener('click', renderMenu);
    $('#confirm-nagashi').addEventListener('click', () => {
      const winners = [...document.querySelectorAll<HTMLInputElement>('input[data-nagashi]')]
        .filter(x => x.checked)
        .map(x => Number(x.dataset.nagashi));
      const dealerTenpai = ($('#nagashi-dealer-tenpai') as HTMLInputElement).checked;
      runAction('NAGASHI_MANGAN', '流局滿貫', () => {
        const result = RW.settleNagashiMangan(core.game, winners, dealerTenpai);
        return `${result.description}｜${RW.scoreDeltaText(result.deltas)}`;
      });
      closeSheets();
    });
  };

  const renderAbortive = () => {
    content.innerHTML = `
      ${renderBack()}
      <div class="settlement-heading"><div><span class="eyebrow">中途流局</span><h2>增加一本場</h2></div></div>
      <div class="rule-note">九種九牌、四風連打、四槓散了等可用這個。莊家不換，+1 本場；已投入的立直棒繼續留在供託。</div>
      <button id="confirm-abortive" class="primary-button">確認中途流局（+1 本場）</button>
    `;
    $('#draw-back').addEventListener('click', renderMenu);
    $('#confirm-abortive').addEventListener('click', () => {
      runAction('ABORTIVE_DRAW', '中途流局', () => {
        const result = RW.settleAbortiveDraw(core.game);
        return result.description;
      });
      closeSheets();
    });
  };

  renderMenu();
  openSheet('settlement-sheet');
}

function updateConfig<K extends keyof RW.Config>(key: K, value: RW.Config[K], label: string): void {
  runAction('SETTING', label, () => {
    core.config[key] = value;
    return label;
  });
}

function updateRule<K extends keyof RW.Rules>(key: K, value: RW.Rules[K], label: string): void {
  runAction('SETTING', label, () => {
    core.config.rules[key] = value;
    return label;
  });
}

function applyManualScores(): void {
  const values = [...document.querySelectorAll<HTMLInputElement>('[data-score-index]')]
    .map(input => ({ index: Number(input.dataset.scoreIndex), value: Number(input.value) }));
  if (values.some(v => !Number.isFinite(v.value))) {
    showToast('請輸入有效分數', true);
    return;
  }
  runAction('MANUAL_SCORE', '手動修改分數', () => {
    const before = core.game.scores.slice();
    values.forEach(v => core.game.scores[v.index] = Math.round(v.value));
    const changes = core.game.scores.map((score, i) => `${playerLabel(i)} ${fmt(before[i])}→${fmt(score)}`).join(' / ');
    return `手動修改分數｜${changes}`;
  });
  showToast('分數已更新');
}

function startNewGame(): void {
  const c = core.config;
  const score = RW.startScore(c, c.mode);
  if (!window.confirm(`新開 ${modeLabel(c.mode)}・${lengthLabel(c.gameLength)}？目前對局會保留在 Log，可用「上一步」復原。`)) return;
  runAction('GAME_START', '新對局', () => {
    core.game = RW.createGame(core.config);
    return `新對局｜${modeLabel(c.mode)}・${lengthLabel(c.gameLength)}・${fmt(score)} 點`;
  });
  activeTab = 'game';
  render();
}

function bindStaticEvents(): void {
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach(el => el.addEventListener('click', () => {
    activeTab = el.dataset.tab as typeof activeTab;
    menuOpen = false;
    render();
  }));
  $('#menu-toggle-button').addEventListener('click', () => {
    menuOpen = !menuOpen;
    renderTabs();
  });
  $('#undo-button').addEventListener('click', undoLast);
  $('#sheet-backdrop').addEventListener('click', closeSheets);
  document.querySelectorAll('[data-close-sheet]').forEach(el => el.addEventListener('click', closeSheets));
  $('#action-ron').addEventListener('click', openRonSheet);
  $('#action-tsumo').addEventListener('click', openTsumoSheet);
  $('#action-draw').addEventListener('click', openDrawSheet);
  $('#center-card').addEventListener('click', () => !core.game.ended && openDrawSheet());

  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach(input => input.addEventListener('change', () => {
    if (input.checked) updateConfig('mode', input.value as RW.Mode, `下次新局模式：${modeLabel(input.value as RW.Mode)}`);
  }));
  document.querySelectorAll<HTMLInputElement>('input[name="length"]').forEach(input => input.addEventListener('change', () => {
    if (input.checked) updateConfig('gameLength', input.value as RW.GameLength, `下次新局場次：${lengthLabel(input.value as RW.GameLength)}`);
  }));
  document.querySelectorAll<HTMLInputElement>('input[name="sanma-third-seat"]').forEach(input => input.addEventListener('change', () => {
    if (input.checked) updateConfig('sanmaThirdSeat', input.value as RW.SanmaThirdSeat, `三麻第三家位置：${input.value === 'top' ? '上方' : '左方'}`);
  }));
  $('#center-text-scale').addEventListener('input', () => {
    const value = Number(($('#center-text-scale') as HTMLInputElement).value);
    core.config.centerTextScale = value;
    $('#center-text-scale-value').textContent = `${value}%`;
    saveApp();
    renderGame();
  });
  $('#center-text-scale').addEventListener('change', () => {
    const value = Number(($('#center-text-scale') as HTMLInputElement).value);
    addLog('SETTING', `中央文字大小：${value}%`);
  });
  $('#start-yonma').addEventListener('change', () => {
    const value = Number(($('#start-yonma') as HTMLInputElement).value);
    if (value >= 0) updateConfig('startYonma', value, `四麻起始點數改為 ${fmt(value)}`);
  });
  $('#start-sanma').addEventListener('change', () => {
    const value = Number(($('#start-sanma') as HTMLInputElement).value);
    if (value >= 0) updateConfig('startSanma', value, `三麻起始點數改為 ${fmt(value)}`);
  });
  $('#rule-kiriage').addEventListener('change', () => {
    const value = ($('#rule-kiriage') as HTMLInputElement).checked;
    updateRule('kiriageMangan', value, `切上滿貫：${value ? 'ON' : 'OFF'}`);
  });
  $('#rule-atamahane').addEventListener('change', () => {
    const value = ($('#rule-atamahane') as HTMLInputElement).checked;
    updateRule('atamahane', value, `頭ハネ：${value ? 'ON' : 'OFF（允許複數榮和）'}`);
  });
  $('#rule-kazoe').addEventListener('change', () => {
    const value = ($('#rule-kazoe') as HTMLInputElement).checked;
    updateRule('kazoeYakuman', value, `數え役滿：${value ? 'ON' : 'OFF'}`);
  });
  $('#rule-multiple-yakuman').addEventListener('change', () => {
    const value = ($('#rule-multiple-yakuman') as HTMLInputElement).checked;
    updateRule('multipleYakuman', value, `複合役滿：${value ? 'ON' : 'OFF'}`);
  });
  $('#apply-manual-score').addEventListener('click', applyManualScores);
  $('#new-game-button').addEventListener('click', startNewGame);
  window.addEventListener('pagehide', saveApp);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveApp();
  });

  $('#clear-log-button').addEventListener('click', () => {
    if (!window.confirm('只清除 Log？目前分數與局況不會改變。')) return;
    journal = [{ id: nowId('system'), ts: Date.now(), kind: 'SYSTEM', label: 'Log 已清除', undoable: false }];
    saveApp();
    render();
  });
}

loadApp();
bindStaticEvents();
render();
