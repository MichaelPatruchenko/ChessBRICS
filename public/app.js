import {createAudio} from './audio-player.js';
import {initAccounts} from './account-ui.js';
import {variants,sideOf,square,newMatch,legalMoves,checks,applyMove,expire,pgn,readClassicStudy,replayPosition,captureHistory} from './match.js';
import {readAnalysisPosition} from './search.js';

const $ = id => document.getElementById(id);
const names = {p:'Пешка',r:'Ладья',n:'Конь',b:'Слон',q:'Ферзь',k:'Король',x:'БРИКС'};
const id = new URL(location.href).searchParams.get('room');
const seatKey = room => 'brics-seat-' + room;
let variant = 'brics';
let size = 10;
let colors = variants.brics.colors;
let demo = newMatch(variant,10,3);
const coord = index => square(index,size);
const palette = color => variant === 'classic' ? (color ? 'classic-black' : 'classic-white') : 'c' + color;
const pieceMarkup = ({type,color}) => {
  const theme = palette(color);
  return '<svg class="piece ' + theme + '" aria-hidden="true" viewBox="0 0 48 48"><use href="/pieces.svg#' + type +
    '"/></svg><span class="piece-art piece-' + type + ' ' + theme + '" aria-hidden="true"></span>';
};
let state = null;
let practice = false;
let hotseat = false;
let replayIndex = null;
let replayBoard = null;
let studyMode = null;
let puzzleFen = null;
let analyst = null;
let analysisRequest = null;
let analysisMove = null;
let config = {};
const audio = createAudio();
let audioGame;
let audioClock;
let selected = null;
let available = [];
let received = 0;
let busy = false;
let bot = null;
let worker = null;
let botLevel = 'medium';
function stopBot() {
  clearTimeout(bot);
  worker?.terminate();
  worker = null;
}
let promotion = null;
let lastLog = null;
let captures = [];
let focusIndex = 10;
let connection = '';
let missing = false;
const setText = (id,value) => {
  if ($(id).textContent !== value) $(id).textContent = value;
};
const cells = [];

function localGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function localSet(key,value) {
  try { localStorage.setItem(key,value); } catch { /* Storage may be disabled. */ }
}

function buildBoard() {
  size = variants[variant].size;
  colors = variants[variant].colors;
  demo = newMatch(variant,10,3);
  focusIndex = size;
  cells.length = 0;
  $('board').replaceChildren();
  $('board').style.setProperty('--board-size',size);
  for (let rank = size - 1; rank >= 0; rank--) {
    for (let file = 0; file < size; file++) {
      const index = rank * size + file;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell ' + ((rank + file) % 2 ? 'light' : 'dark');
      cell.tabIndex = index === focusIndex ? 0 : -1;
      cell.addEventListener('focus',() => {
        cells[focusIndex].tabIndex = -1;
        cell.tabIndex = 0;
        focusIndex = index;
      });
      cell.addEventListener('click',() => choose(index));
      cell.addEventListener('keydown',event => {
        if (event.key === 'Escape' && selected !== null) {
          event.preventDefault();
          selected = null;
          setText('boardMessage','Выбор отменён');
          render();
          return;
        }
        const offset = {ArrowUp:size,ArrowDown:-size,ArrowLeft:-1,ArrowRight:1}[event.key];
        if (!offset) return;
        event.preventDefault();
        if ((file === 0 && offset === -1) || (file === size - 1 && offset === 1)) return;
        cells[index + offset]?.focus();
      });
      cells[index] = cell;
      $('board').append(cell);
    }
  }
  const ranks = colors.length === 2 ? [['north',[1]],['south',[0]]] : [['north',[3,1]],['south',[0,2]]];
  for (const [container,players] of ranks) {
    const pair = $(container);
    pair.replaceChildren();
    pair.classList.toggle('single-seat',players.length === 1);
    for (const i of players) {
      const card = document.createElement('div');
      card.className = 'seat ' + palette(i);
      card.id = 'seat' + i;
      card.innerHTML = '<i></i><div><b></b><small></small></div><time></time>' +
        '<div class="captures" hidden><span>Взятые</span><ul class="captured-pieces" aria-label="Взятые фигуры — ' +
        colors[i].toLowerCase() + '" role="list"></ul></div>';
      pair.append(card);
    }
  }
  document.querySelector('.rulebook-art').hidden = variant === 'classic';
  $('classicRules').hidden = variant !== 'classic';
  $('bricsRules').hidden = variant === 'classic';
  $('teamRules').hidden = variant !== 'brics';
  $('duelRules').hidden = variant !== 'brics-duel';
  $('promoteBrics').hidden = variant === 'classic';
  setText('introVariant',variant === 'classic' ? 'Классические шахматы. Два игрока. Доска 8×8.' :
    variant === 'brics-duel' ? 'Дуэль БРИКС. Два игрока. Доска 10×10.' : 'Четыре цвета. Две команды. Доска 10×10.');
  setText('footerVariant',size + ' × ' + size + (colors.length === 2 ? ' · 2 ЦВЕТА' : ' · 4 ЦВЕТА'));
  $('variantHint').textContent = variant === 'classic' ? 'Классика · доска 8×8, два игрока.' :
    variant === 'brics-duel' ? 'БРИКС 1×1 · каждый игрок управляет всей своей стороной.' :
      'БРИКС 2×2 · доска 10×10, четыре игрока и две команды.';
  updateBotOptions();
}

function updateBotOptions() {
  const enabled = config.stockfishEnabled && variant === 'classic';
  $('stockfishOption').hidden = $('stockfishOption').disabled = !enabled;
  if (!enabled && $('botLevel').value === 'stockfish') $('botLevel').value = 'medium';
}

function selectVariant(next) {
  if (variant === next) return;
  variant = next;
  selected = null;
  lastLog = null;
  buildBoard();
}

function update(value) {
  if (state && value.version < state.version) return;
  const changed = state?.version !== value.version || state?.you !== value.you;
  if (state?.version !== value.version) {
    clearAnalysis();
    selected = null;
    if ($('promote').open) $('promote').close();
  }
  state = value;
  selectVariant(value.variant ?? 'brics');
  received = performance.now();
  if (changed) render();
}

function render() {
  const game = state?.game ?? demo;
  const display = replayBoard ?? game;
  const last = display.history.at(-1);
  if (lastLog !== game.history.length) captures = captureHistory(game);
  const captureLimit = replayIndex ?? game.history.length;
  const checked = state?.game && checks(display);
  available = selected === null ? [] : legalMoves(game,selected);
  for (const [i,cell] of cells.entries()) {
    const p = display.board[i];
    const markup = (p ? pieceMarkup(p) : '') +
      (i % size === 0 ? '<span class="coord rank">' + (Math.floor(i / size) + 1) + '</span>' : '') +
      (i < size ? '<span class="coord file">' + coord(i)[0] + '</span>' : '');
    if (cell.dataset.piece !== (p ? p.color + p.type : '')) {
      cell.dataset.piece = p ? p.color + p.type : '';
      cell.innerHTML = markup;
    }
    const target = available.some(move => move.to === i);
    cell.classList.toggle('target',target);
    cell.classList.toggle('occupied',!!p);
    cell.classList.toggle('selected',selected === i);
    cell.classList.toggle('last',last?.from === i || last?.to === i);
    cell.classList.toggle('check',p?.type === 'k' && !!checked?.[sideOf(game,p.color)]);
    cell.setAttribute('aria-label',coord(i) + (p ? ', ' + names[p.type] + ', ' + colors[p.color] : '') + (target ? ', доступный ход' : ''));
    cell.setAttribute('aria-pressed',selected === i);
  }
  for (let i = 0; i < colors.length; i++) {
    const card = $('seat' + i);
    card.classList.toggle('active',!!state?.game && !game.result && game.turn === i);
    card.querySelector('b').textContent = colors[i];
    card.querySelector('small').textContent = state ? (state.seats[i] ?? 'Свободное место') + (state.you === i && !hotseat ? ' · вы' : '') : colors.length === 2 ? 'Стартовая позиция' : 'Команда ' + (sideOf(game,i) + 1);
    const taken = captures.filter(piece => piece.by === i && piece.ply <= captureLimit);
    const list = card.querySelector('.captured-pieces');
    list.parentElement.hidden = !taken.length;
    if (list.children.length !== taken.length || lastLog === null) {
      list.innerHTML = taken.map(piece => {
        const label = names[piece.type] + ', ' + colors[piece.color].toLowerCase();
        return '<li title="' + label + '">' + pieceMarkup(piece) + '<span class="sr-only">' + label + '</span></li>';
      }).join('');
    }
  }
  tick();
  const online = !!id;
  const training = practice || !!state?.bot;
  const waiting = online && state && !state.game;
  const yourTurn = !!state?.game && !hotseat && !game.result && game.turn === state.you;
  $('setup').hidden = online || practice;
  document.querySelector('.team-art').hidden = online || practice || variant !== 'brics';
  $('room').hidden = !(online || practice);
  $('invite').hidden = !waiting || state.you < 0 || !!state?.rated;
  $('joinBox').hidden = !waiting || state.you >= 0 || !!state?.rated;
  $('cancelQuick').hidden = !waiting || state.you < 0 || !state?.rated;
  $('resign').hidden = !!studyMode || !state?.game || !!game.result || state.you < 0;
  const drawAvailable = online && !state?.bot && state?.game && !game.result && state.you >= 0;
  const votes = state?.draw ?? [];
  $('drawOffer').hidden = !drawAvailable || votes.includes(state?.you);
  $('drawDecline').hidden = !drawAvailable || !votes.length;
  $('drawNotice').hidden = !drawAvailable || !votes.length;
  setText('drawNotice',votes.length ? 'Согласны на ничью: ' + votes.length + ' из ' + colors.length : '');
  setText('drawOffer',votes.length ? 'Принять ничью' : 'Предложить ничью');
  setText('drawDecline',votes.includes(state?.you) ? 'Отозвать согласие' : 'Отклонить ничью');
  $('rematch').hidden = studyMode === 'import' || !practice || !game.result;
  setText('rematch',studyMode === 'puzzle' ? 'Решить ещё раз' : hotseat ? 'Новая локальная партия' : 'Новая тренировка');
  $('replayControls').hidden = !game.result || !game.history.length;
  $('prevMove').disabled = replayIndex === 0;
  $('nextMove').disabled = replayIndex === null;
  setText('replayStatus',replayIndex === null ? 'Финальная позиция' : 'После хода ' + replayIndex + ' из ' + game.history.length);
  $('export').hidden = !state?.game || !game.history.length;
  $('fenExport').hidden = variant !== 'classic' || !state?.game;
  $('analyze').hidden = !game.result || studyMode === 'puzzle';
  $('explain').hidden = $('analyze').hidden || !config.llmEnabled;
  $('boardStatus').classList.toggle('your-turn',yourTurn);
  $('boardStatus').classList.toggle('preview',!online && !practice);
  const layout = document.querySelector('.layout');
  if (layout.classList.contains('playing') !== !!state?.game) {
    const controls = layout.querySelector('.controls-stack');
    const playArea = layout.querySelector('.play');
    if (state?.game) {
      playArea.after(controls);
      setText('notice','');
    }
    else playArea.before(controls);
    layout.classList.toggle('playing',!!state?.game);
  }
  layout.querySelector('.log').hidden = !state?.game;
  setText('roomLabel',studyMode ? 'УЧЕБНЫЙ РЕЖИМ' : hotseat ? 'НА ОДНОМ ЭКРАНЕ' : training ? 'ТРЕНИРОВКА · ' + ({easy:'ЛЁГКИЙ',medium:'СРЕДНИЙ',hard:'СИЛЬНЫЙ',llm:'LLM',stockfish:'Stockfish'}[state?.bot ?? botLevel]) : 'ОНЛАЙН · ' + colors.length + ' ИГРОКА');
  setText('roomTitle',studyMode === 'import' ? 'Разбор записи' : studyMode === 'puzzle' ? 'Мат в один ход' : hotseat ? 'Локальная партия' : training ? (colors.length === 2 ? 'Партия с ботом' : 'Партия с ботами') : waiting && state.rated ? 'Поиск соперников' : waiting && state.you < 0 ? 'Вас пригласили в партию' : variants[variant].title);
  setText('roomDetails',studyMode === 'import' ? 'Используйте стрелки журнала для просмотра позиции.' : studyMode === 'puzzle' ? 'Найдите ход, которым можно сразу поставить мат.' : hotseat ? 'Передавайте устройство следующему игроку после каждого хода.' : training ? ('Вы играете за ' + (variant === 'classic' ? 'белых.' : 'красных.') + (variant === 'brics' ? ' Зелёные — ваши союзники.' : '')) :
    waiting && state.rated ? 'Подбираем игроков с близким рейтингом и тем же контролем времени.' :
    waiting && state.you >= 0 ? 'Отправьте ссылку друзьям. Партия начнётся, когда все займут места.' :
    waiting ? 'Займите свободное место. Цвет будет назначен автоматически.' :
    state?.you >= 0 ? 'Ваш цвет — ' + colors[state.you].toLowerCase() + '.' : '');
  $('roomDetails').hidden = !$('roomDetails').textContent;
  setText('clockLabel',state ? state.minutes + ' мин + ' + state.increment + ' с' : '');
  if (!state?.game) {
    setText('status',missing ? 'Комната не найдена' : waiting ? 'Ожидаем игроков' : online ? 'Подключение к комнате…' : 'Стартовая расстановка');
    setText('roomHint',waiting ? state.seats.filter(Boolean).length + ' из ' + colors.length + ' мест занято' :
      missing ? 'Проверьте ссылку или вернитесь в игровой зал.' : '');
  } else if (game.result) {
    setText('status',studyMode === 'import' ? 'Разбор позиции' : studyMode === 'puzzle' ? 'Задача решена' : game.result.winner === null ? 'Ничья' : colors.length === 2 ? colors[game.result.winner] + ' победили' : 'Победа команды ' + (game.result.winner + 1));
    setText('roomHint',studyMode === 'import' ? 'Положение фигур можно скачать в FEN.' : game.result.reason);
  } else {
    setText('status',yourTurn ? 'Ваш ход' : 'Ходят ' + colors[game.turn].toLowerCase());
    setText('roomHint',(yourTurn ? colors[game.turn] + (available.length ? ' · выберите клетку' : ' · выберите фигуру') :
      hotseat ? 'Выберите фигуру текущего цвета' : state.you < 0 ? 'Вы наблюдаете за партией' : 'Ваш цвет — ' + colors[state.you].toLowerCase()) +
      (checked[sideOf(game,game.turn)] ? (variant === 'classic' ? ' · шах' : ' · король под ударом') : ''));
  }
  observeAudio(state?.game,checked);
  if (lastLog !== game.history.length) {
    lastLog = game.history.length;
    $('count').textContent = lastLog;
    $('empty').hidden = !!lastLog;
    $('history').replaceChildren(...game.history.map(move => {
      const li = document.createElement('li');
      const marker = document.createElement('i');
      marker.className = palette(move.color);
      li.append(marker,names[move.type] + ' ' + coord(move.from) + (move.castle ? ' ⇄ ' : move.capture ? ' × ' : ' → ') +
        coord(move.to) + (move.promotion ? ' = ' + names[move.promotion] : ''));
      return li;
    }));
    $('history').scrollTop = $('history').scrollHeight;
  }
}

function tick() {
  const game = state?.game;
  if (practice && !studyMode && game && expire(game,Date.now())) {
    stopBot();
    render();
    return;
  }
  for (let i = 0; i < colors.length; i++) {
    const elapsed = game && !studyMode && !game.result && game.turn === i ?
      (practice ? Date.now() : state.now + performance.now() - received) - game.since : 0;
    const seconds = Math.max(0,Math.ceil(((game?.clock[i] ?? (state?.minutes ?? 10) * 60000) - elapsed) / 1000));
    if (game && !studyMode && !game.result && game.turn === i && (hotseat || state.you === i) && seconds > 0 && seconds <= 10) {
      const mark = game.history.length + '/' + seconds;
      if (audioClock !== mark) {
        audioClock = mark;
        audio.effect(seconds % 2 ? 'clock-1' : 'clock-2');
      }
    }
    const clock = $('seat' + i).querySelector('time');
    clock.hidden = !!studyMode;
    clock.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2,'0');
  }
}

async function api(path, data) {
  const key = id && localGet(seatKey(id));
  const response = await fetch('/api/rooms' + path,{
    signal:AbortSignal.timeout(5000),
    method:data ? 'POST' : 'GET',
    headers:{...(data ? {'Content-Type':'application/json'} : {}), ...(key ? {Authorization:'Bearer ' + key} : {})},
    body:data ? JSON.stringify(data) : undefined
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error),{status:response.status});
  return value;
}

async function run(button, action, message = 'notice') {
  if (busy) return;
  busy = true;
  if (button) button.disabled = true;
  setText(message,'');
  try { await action(); }
  catch (error) {
    if (message === 'boardMessage' && error.status === 422) audio.effect('invalid');
    setText(message,error.status ? error.message : 'Не удалось связаться с сервером. Повторите попытку.'); }
  finally {
    busy = false;
    if (button) button.disabled = false;
  }
}

function options() {
  return {variant, name:$('name').value, minutes:Number($('minutes').value), increment:Number($('increment').value), public:$('publicRoom').checked};
}
const lastRoom = localGet('brics-last-room');
if (!id && /^[\w-]{12}$/.test(lastRoom ?? '') ) {
  $('resume').href = '?room=' + lastRoom;
  $('resume').hidden = false;
}
if (id) {
  const link = new URL('/',location.href);
  link.searchParams.set('room',id);
  $('inviteLink').value = link.href;
}

$('name').value = $('joinName').value = localGet('brics-name') ?? '';
$('form').addEventListener('submit',event => {
  event.preventDefault();
  run(event.submitter,async () => {
    await createRoom(options());
  });
});
function openRoom(value) {
  if (value.key) localSet(seatKey(value.id),value.key);
  localSet('brics-last-room',value.id);
  localSet('brics-name',$('name').value);
  location.search = '?room=' + value.id;
}
async function createRoom(input) {
  openRoom(await api('',input));
}
initAccounts({quickOptions:options,onQuick:openRoom});
$('cancelQuick').onclick = () => run($('cancelQuick'),async () => {
  await api('/' + id + '/cancel',{});
  localSet('brics-last-room','');
  location.href = '/';
});
$('form').addEventListener('change',event => {
  if (event.target.name !== 'variant') return;
  selectVariant(event.target.value);
  render();
});
fetch('/api/config').then(response => response.json()).then(value => {
  config = value;
  $('llmOption').hidden = $('llmOption').disabled = !config.llmEnabled;
  updateBotOptions();
  render();
}).catch(() => {});
async function loadLobby() {
  setText('lobbyStatus','Загрузка…');
  try {
    const response = await fetch('/api/lobby',{signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error();
    const {rooms} = await response.json();
    $('lobbyList').replaceChildren(...rooms.map(room => {
      const row = document.createElement('li');
      const link = document.createElement('a');
      link.href = '?room=' + room.id;
      link.textContent = variants[room.variant].title + ' · ' + room.minutes + '+' + room.increment +
        ' · места ' + room.occupied + '/' + room.capacity;
      row.append(link);
      return row;
    }));
    setText('lobbyStatus',rooms.length ? '' : 'Сейчас открытых комнат нет. Создайте свою и отметьте показ в лобби.');
  } catch {
    setText('lobbyStatus','Не удалось загрузить комнаты.');
  }
}
$('lobbyOpen').onclick = () => {
  $('lobby').showModal();
  loadLobby();
};
$('lobbyRefresh').onclick = loadLobby;
function download(text,filename) {
  const blob = new Blob([text],{type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
$('export').onclick = () => {
  const game = state?.game;
  if (!game) return;
  const classic = variant === 'classic';
  download(classic ? pgn(game) : JSON.stringify({variant,...game},null,2),classic ? 'classic.pgn' : 'brics.json');
};
$('fenExport').onclick = () => download((replayBoard ?? state.game).fen,'position.fen');
function clearAnalysis() {
  analysisRequest?.abort();
  analysisRequest = null;
  analysisMove = null;
  analyst?.terminate();
  analyst = null;
  $('analyze').disabled = false;
  $('explain').disabled = true;
  setText('analysisText','');
  setText('mentorText','');
}
function analysisPosition(game) {
  return variant === 'classic' ? {variant,fen:game.fen} : {variant,board:game.board,turn:game.turn};
}
async function requestAnalysis(tool,body,signal,timeout) {
  const response = await fetch('/api/analysis/' + tool,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
    signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)])
  });
  if (!response.ok) throw new Error('Сервис разбора недоступен');
  return response.json();
}
function showCandidate(result,source) {
  const {move,score,depth} = result;
  analysisMove = move;
  $('analyze').disabled = false;
  $('explain').disabled = !move;
  if (!move) return setText('analysisText','В этой позиции допустимых ходов нет.');
  const label = move.san ?? coord(move.from) + (move.castle ? ' ⇄ ' : ' → ') + coord(move.to) +
    (move.promotion ? ' = ' + names[move.promotion] : '');
  const detail = score?.kind === 'cp' ? ' · оценка стороны хода ' + (score.value / 100).toFixed(2) :
    score?.kind === 'mate' ? ' · ' + (score.value > 0 ? 'мат сопернику за ' : 'мат стороне хода через ') + Math.abs(score.value) :
      depth ? ' · поиск на глубину ' + depth + ' полухода' : '';
  setText('analysisText',source + ' · ' + label + detail);
}
$('analyze').onclick = async () => {
  const game = replayBoard ?? state.game;
  if (!state.game.result || studyMode === 'puzzle') return;
  clearAnalysis();
  if (game.result?.reason === 'Король взят') {
    setText('analysisText','Откройте позицию перед взятием короля.');
    return;
  }
  const {signal} = analysisRequest = new AbortController();
  $('analyze').disabled = true;
  setText('analysisText','Ищем ход…');
  if (variant === 'classic' && config.stockfishEnabled) {
    try {
      const result = await requestAnalysis('stockfish',{position:analysisPosition(game)},signal,5000);
      if (!signal.aborted) showCandidate(result,'Stockfish');
      return;
    } catch {
      if (signal.aborted) return;
    }
  }
  const failed = () => {
    analyst?.terminate();
    analyst = null;
    $('analyze').disabled = false;
    setText('analysisText','Не удалось выполнить разбор.');
  };
  try {
    analyst = new Worker('/bot-worker.js',{type:'module'});
    analyst.onmessage = event => {
      if (signal.aborted) return;
      analyst.terminate();
      analyst = null;
      showCandidate(event.data,variant === 'classic' ? 'Кандидат' : 'Поиск БРИКС');
    };
    analyst.onerror = () => { if (!signal.aborted) failed(); };
    analyst.postMessage({game:{...game,result:null},analyze:true});
  } catch { failed(); }
};
$('explain').onclick = async () => {
  if (!analysisMove || !analysisRequest || !state.game.result) return;
  const {signal} = analysisRequest;
  $('explain').disabled = true;
  setText('mentorText','Наставник разбирает ход…');
  try {
    const {explanation} = await requestAnalysis('mentor',{
      position:analysisPosition(replayBoard ?? state.game),move:analysisMove
    },signal,32000);
    if (!signal.aborted) setText('mentorText',explanation);
  } catch {
    if (!signal.aborted) setText('mentorText','Наставник временно недоступен. Повторите попытку.');
  } finally {
    if (!signal.aborted) $('explain').disabled = false;
  }
};
function openStudy(game,mode,fen = null) {
  stopBot();
  clearAnalysis();
  studyMode = mode;
  puzzleFen = fen;
  practice = true;
  hotseat = false;
  selected = replayIndex = replayBoard = lastLog = null;
  setText('boardMessage','');
  selectVariant(game.variant ?? 'brics');
  state = {you:mode === 'puzzle' ? game.turn : -1, minutes:10,increment:0,game,seats:colors};
  if ($('studyDialog').open) $('studyDialog').close();
  render();
  $('status').tabIndex = -1;
  $('status').focus();
}
$('studyOpen').onclick = () => $('studyDialog').showModal();
$('studyForm').onsubmit = event => {
  event.preventDefault();
  try {
    const format = $('studyFormat').value, value = $('studyText').value;
    if (format === 'brics') {
      const position = readAnalysisPosition(JSON.parse(value));
      if (position.variant === 'classic') throw new Error('Ожидается позиция БРИКС');
      openStudy({...newMatch(position.variant,10,0,0),...position,result:{winner:null,reason:'Импортированная позиция'}},'import');
    } else openStudy(readClassicStudy(value,format),'import');
    setText('studyNotice','');
  } catch {
    setText('studyNotice','Не удалось открыть запись или позицию. Проверьте выбранный формат и данные.');
  }
};
const puzzles = [
  ['Ферзь у края','7k/5Q2/6K1/8/8/8/8/8 w - - 0 1'],
  ['Ладья на последней горизонтали','6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1'],
  ['Ферзь против белого короля','8/8/8/8/8/1k6/2q5/K7 b - - 0 1']
];
for (const [name,fen] of puzzles) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name;
  button.onclick = () => openStudy(newMatch('classic',10,0,0,fen),'puzzle',fen);
  $('puzzles').append(button);
}

function observeAudio(game,checked) {
  audio.setScene(game && !game.result && !studyMode ? 'match' : 'lobby');
  const next = {
    active:!!game && !studyMode,
    count:game?.history.length ?? 0,
    finished:!!game?.result,
    occupied:state?.seats.filter(Boolean).length ?? 0
  };
  const before = audioGame;
  audioGame = next;
  if (!before || studyMode) return;
  if (!next.active) {
    if (id && !before.active && before.occupied && next.occupied > before.occupied && state.you >= 0) audio.effect('invite');
    return;
  }
  if (!before.active) {
    if (!next.finished && !next.count) audio.effect('start');
    return;
  }
  if (next.count > before.count) {
    const move = game.history.at(-1);
    audio.effect(game.result?.reason === 'Король взят' ? 'king-capture' : move.promotion ? 'promotion' :
      move.castle ? 'castle' : move.type === 'x' ? 'brics-jump' : move.capture ? 'capture' : 'move');
    if (!next.finished) {
      if (checked?.[sideOf(game,game.turn)]) audio.effect('check');
      else if (!hotseat && state.you === game.turn) audio.effect('your-turn');
    }
  }
  if (next.finished && !before.finished) {
    audio.effect(game.result.winner === null ? 'draw' :
      state.you < 0 || hotseat || sideOf(game,state.you) === game.result.winner ? 'victory' : 'defeat');
  }
}

function boardSettings() {
  $('board').dataset.theme = $('boardTheme').value;
  $('board').classList.toggle('hide-coordinates',!$('showCoordinates').checked);
  audio.configure({
    effects:$('soundEnabled').checked,
    music:$('musicEnabled').checked,
    effectsVolume:Number($('effectsVolume').value) / 100,
    musicVolume:Number($('musicVolume').value) / 100
  });
}
$('boardTheme').value = localGet('brics-board-theme') ?? 'sage';
$('showCoordinates').checked = localGet('brics-board-coordinates') !== 'off';
$('soundEnabled').checked = localGet('brics-board-sound') === 'on';
$('musicEnabled').checked = localGet('brics-music') === 'on';
$('effectsVolume').value = localGet('brics-effects-volume') ?? '65';
$('musicVolume').value = localGet('brics-music-volume') ?? '30';
boardSettings();
$('settingsOpen').onclick = () => $('settingsDialog').showModal();
$('settingsDialog').oninput = boardSettings;
$('settingsDialog').onchange = () => {
  boardSettings();
  localSet('brics-board-theme',$('boardTheme').value);
  localSet('brics-board-coordinates',$('showCoordinates').checked ? 'on' : 'off');
  localSet('brics-board-sound',$('soundEnabled').checked ? 'on' : 'off');
  localSet('brics-music',$('musicEnabled').checked ? 'on' : 'off');
  localSet('brics-effects-volume',$('effectsVolume').value);
  localSet('brics-music-volume',$('musicVolume').value);
  audio.activate();
};
document.addEventListener('pointerdown',audio.activate);
document.addEventListener('keydown',audio.activate);
$('joinBox').addEventListener('submit',event => {
  event.preventDefault();
  run($('join'),async () => {
    const value = await api('/' + id + '/join',{name:$('joinName').value});
    if (value.key) localSet(seatKey(id),value.key);
    localSet('brics-last-room',id);
    localSet('brics-name',$('joinName').value);
    update(value);
    $('status').tabIndex = -1;
    $('status').focus();
  });
});
$('inviteLink').addEventListener('focus',() => $('inviteLink').select());
$('copy').onclick = () => run($('copy'),async () => {
  const field = $('inviteLink');
  try {
    await navigator.clipboard.writeText(field.value);
    setText('notice','Ссылка скопирована');
    audio.effect('invite');
  } catch {
    field.focus();
    field.select();
    setText('notice','Ссылка выделена. Скопируйте её вручную.');
  }
});
const visualKey = 'brics-extra-visual';
function setVisual(enabled) {
  document.documentElement.classList.toggle('extra-visual',enabled);
  $('visualToggle').setAttribute('aria-pressed',String(enabled));
  $('siteIcon').href = enabled ? '/art-brand.webp' : '/brand.svg';
  if (enabled) $('visualToggle').title = 'Выключить дополнительный визуал';
  else $('visualToggle').title = 'Включить дополнительный визуал';
  if (enabled) {
    loadArt('.intro-art img');
    if (!id) loadArt('.team-art img');
    if ($('rulebook').open) loadArt('.rulebook-art img');
  }
}
function loadArt(selector) {
  const art = document.querySelector(selector);
  if (!art.hasAttribute('src')) art.src = art.dataset.visualSrc;
}
setVisual(localGet(visualKey) !== 'off');
$('visualToggle').onclick = () => {
  const enabled = $('visualToggle').getAttribute('aria-pressed') === 'false';
  localSet(visualKey,enabled ? 'on' : 'off');
  setVisual(enabled);
};
$('rules').onclick = () => {
  if (variant !== 'classic' && document.documentElement.classList.contains('extra-visual')) loadArt('.rulebook-art img');
  $('rulebook').showModal();
};

function startPractice(local = false) {
  const input = options();
  hotseat = local;
  botLevel = $('botLevel').value;
  if (!hotseat && ['llm','stockfish'].includes(botLevel)) return run($('practice'),() => createRoom({...input,bot:botLevel}));
  const {name,minutes,increment} = input;
  practice = true;
  stopBot();
  clearAnalysis();
  selected = null;
  replayIndex = replayBoard = null;
  setText('boardMessage','');
  audioGame = {active:false, count:0, finished:false, occupied:0};
  audioClock = null;
  state = {you:0, minutes, increment, game:newMatch(variant,minutes,increment), seats:colors.map((_,i) => hotseat ? 'Игрок ' + (i + 1) : i ? 'Бот' : name.trim() || 'Гость')};
  render();
  $('status').tabIndex = -1;
  $('status').focus();
}
$('practice').onclick = () => startPractice();
$('localDuel').onclick = () => startPractice(true);
$('rematch').onclick = () => {
  if (studyMode === 'puzzle') openStudy(newMatch('classic',10,0,0,puzzleFen),'puzzle',puzzleFen);
  else startPractice(hotseat);
};

function goToPosition(index) {
  const game = state.game;
  replayIndex = index < game.history.length ? Math.max(0,index) : null;
  replayBoard = null;
  if (replayIndex !== null) replayBoard = replayPosition(game,replayIndex);
  clearAnalysis();
  render();
}
$('prevMove').onclick = () => goToPosition((replayIndex ?? state.game.history.length) - 1);
$('nextMove').onclick = () => goToPosition(replayIndex + 1);

function voteDraw(accept) {
  const button = $(accept ? 'drawOffer' : 'drawDecline');
  run(button,async () => update(await api('/' + id + '/draw',{accept,version:state.version})),'boardMessage');
}
$('drawOffer').onclick = () => voteDraw(true);
$('drawDecline').onclick = () => voteDraw(false);
$('resign').onclick = () => {
  setText('resignTitle',colors.length === 2 ? 'Сдаться?' : 'Сдаться за команду?');
  setText('resignDetails',colors.length === 2 ? 'Партия завершится, победа будет засчитана сопернику.' :
    'Партия завершится, победа будет засчитана соперникам.');
  $('resignDialog').returnValue = '';
  $('resignDialog').showModal();
};
$('resignDialog').addEventListener('close',() => {
  if ($('resignDialog').returnValue !== 'resign') return;
  run($('resign'),async () => {
    if (practice) {
      stopBot();
      state.game.result = {winner:1-sideOf(state.game,state.you),reason:'Сдача'};
      selected = null;
      render();
    } else update(await api('/' + id + '/resign',{version:state.version}));
    $('status').tabIndex = -1;
    $('status').focus();
  },'boardMessage');
});

function choose(i) {
  const game = state?.game;
  if (busy || connection || !game || game.result || game.turn !== state.you) return;
  const candidates = available.filter(move => move.to === i);
  if (candidates.length > 1) {
    promotion = {moves:candidates,version:state.version};
    $('promote').returnValue = '';
    $('promote').dataset.palette = palette(game.turn);
    $('promote').showModal();
  } else if (candidates.length) {
    submit(candidates[0]);
  } else {
    const p = game.board[i];
    const invalid = selected !== null && selected !== i && p?.color !== state.you;
    if (invalid) {
      setText('boardMessage','Эта клетка недоступна. Выберите подсвеченную клетку.');
      if (!studyMode) audio.effect('invalid');
      return;
    }
    selected = selected !== i && p?.color === state.you ? i : null;
    render();
    setText('boardMessage',selected !== null && !available.length ? 'У этой фигуры нет доступных ходов.' : '');
  }
}
$('promote').addEventListener('close',() => {
  const choice = promotion?.moves.find(move => move.promotion === $('promote').returnValue);
  if (choice && promotion.version === state.version) submit(choice);
  promotion = null;
});
function submit(move) {
  run(null,async () => {
    if (studyMode === 'puzzle') {
      const attempt = structuredClone(state.game);
      applyMove(attempt,move,0);
      if (attempt.result?.reason === 'Мат') state.game = attempt;
      else setText('boardMessage','Этот ход не ставит мат. Попробуйте другой.');
      selected = null;
      render();
    } else if (practice) {
      applyMove(state.game,move,Date.now());
      if (hotseat) state.you = state.game.turn;
      selected = null;
      render();
      if (!hotseat) scheduleBot();
    } else update(await api('/' + id + '/move',{...move,version:state.version}));
  },'boardMessage');
}

function scheduleBot() {
  const game = state.game;
  if (game.result || game.turn === state.you) return;
  bot = setTimeout(() => {
    if (game.result || state.game !== game) return;
    const finish = move => {
      worker?.terminate();
      worker = null;
      if (game.result || state.game !== game) return;
      if (move) applyMove(game,move,Date.now());
      render();
      scheduleBot();
    };
    try {
      worker = new Worker('/bot-worker.js',{type:'module'});
      worker.onmessage = event => finish(event.data);
      worker.onerror = event => {
        event.preventDefault();
        finish(legalMoves(game)[0]);
      };
      worker.postMessage({game,level:botLevel});
    } catch {
      finish(legalMoves(game)[0]);
    }
  },350);
}

function showConnection(message) {
  if (connection === message) return;
  connection = message;
  $('connection').hidden = !message;
  setText('connection',message);
  if (message) {
    selected = null;
    if ($('promote').open) $('promote').close();
    render();
  }
}
async function poll() {
  if (!busy) {
    try {
      update(await api('/' + id));
      showConnection('');
    } catch (error) {
      if (error.status === 404 && !state) {
        missing = true;
        if (lastRoom === id) localSet('brics-last-room','');
        render();
        return;
      }
      showConnection('Связь прервалась. Переподключаемся…');
    }
  }
  setTimeout(poll,900);
}
buildBoard();
render();
setInterval(tick,200);
if (id) poll();



