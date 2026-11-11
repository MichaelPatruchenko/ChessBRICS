import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {createReadStream,statSync,existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {newMatch, applyMove, expire, legalMoves, sideOf, variants} from './public/match.js';
import {chooseLLMMove,explainMove,llmEnabled} from './llm.js';
import {analyzeStockfish,stockfishEnabled} from './stockfish.js';
import {readAnalysisPosition} from './public/search.js';
import {botMove} from './public/bot.js';
import {accounts} from './accounts.js';
import {archive,playerStats,ratingPool} from './ratings.js';
import {tournamentService} from './tournaments.js';
import {audioPath,effects,playlists} from './public/audio-assets.js';

const data = resolve(process.env.DATA_DIR || fileURLToPath(new URL('./data',import.meta.url)));
mkdirSync(data,{recursive:true});
const auth = accounts(data);
const file = resolve(data,'rooms.json');
const snapshot = existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) : [];
const rooms = new Map(Array.isArray(snapshot) ? snapshot : snapshot.rooms);
const token = () => randomBytes(24).toString('hex');
const supportCredit = process.env.CHESSBRICS_SUPPORT_CREDIT !== '0';
const save = () => {
  writeFileSync(file + '.tmp',JSON.stringify({rooms:[...rooms],tournaments:tournaments.data()}),{mode:0o600});
  renameSync(file + '.tmp',file);
};
const assets = new Map(Object.entries({
  '/':['index.html','text/html'], '/style.css':['style.css','text/css'],
  '/match.js':['match.js','text/javascript'], '/vendor/chess.js':['vendor/chess.js','text/javascript'],
  '/bot.js':['bot.js','text/javascript'], '/bot-worker.js':['bot-worker.js','text/javascript'],
  '/search.js':['search.js','text/javascript'],
  '/brics-opening-book.js':['brics-opening-book.js','text/javascript'],
  '/brics-endgames.js':['brics-endgames.js','text/javascript'],
  '/audio-player.js':['audio-player.js','text/javascript'], '/audio-assets.js':['audio-assets.js','text/javascript'],
  '/account-ui.js':['account-ui.js','text/javascript'],
  '/app.js':['app.js','text/javascript'], '/engine.js':['engine.js','text/javascript'],
  '/pieces.svg':['pieces.svg','image/svg+xml'], '/brand.svg':['brand.svg','image/svg+xml'],
  '/art-pieces.webp':['art-pieces.webp','image/webp'], '/art-icons.webp':['art-icons.webp','image/webp'],
  '/art-brand.webp':['art-brand.webp','image/webp'],
  '/red-soft.png':['red-soft.png','image/png'],
  '/art-board-light.webp':['art-board-light.webp','image/webp'], '/art-board-dark.webp':['art-board-dark.webp','image/webp'],
  '/club-background.webp':['club-background.webp','image/webp'],
  '/hall.webp':['hall.webp','image/webp'], '/brics-leap.webp':['brics-leap.webp','image/webp'], '/teams.webp':['teams.webp','image/webp'],
}).map(([path,[name,type]]) => {
  const file = new URL('./public/' + name,import.meta.url);
  const body = path === '/' && !supportCredit ?
    readFileSync(file,'utf8').replace(/<!-- support-credit:start -->[\s\S]*?<!-- support-credit:end -->\r?\n/,'') :
    readFileSync(file);
  return [path,{body,type}];
}));
const media = new Map([...effects,...Object.values(playlists).flat()].map(name => {
  const path = audioPath(name);
  const file = fileURLToPath(new URL('./public' + path,import.meta.url));
  return [path,{file,size:statSync(file).size}];
}));
function serveAudio(req,res,{file,size}) {
  let start = 0, end = size - 1;
  const range = req.headers.range;
  const headers = {'Content-Type':'audio/mpeg','Accept-Ranges':'bytes','Cache-Control':'public, max-age=3600'};
  if (range) {
    const parts = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!parts || (!parts[1] && !parts[2])) {
      res.writeHead(416,{...headers,'Content-Range':'bytes */' + size}).end();
      return;
    }
    if (parts[1]) {
      start = Number(parts[1]);
      if (parts[2]) end = Math.min(end,Number(parts[2]));
    } else {
      start = Math.max(0,size - Number(parts[2]));
    }
    if (start >= size || end < start) {
      res.writeHead(416,{...headers,'Content-Range':'bytes */' + size}).end();
      return;
    }
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(range ? 206 : 200,headers);
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file,{start,end});
  stream.on('error',error => res.destroy(error));
  res.on('close',() => stream.destroy());
  stream.pipe(res);
}
const reply = (res,status,body) => {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
};
function fail(status,message) {
  throw Object.assign(new Error(message),{status});
}
async function readBody(req) {
  if (req.headers['content-type'] !== 'application/json') fail(415,'Ожидается JSON');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) fail(413,'Запрос слишком большой');
  }
  let value;
  try { value = JSON.parse(body); } catch { fail(400,'Некорректный запрос'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') fail(400,'Некорректный запрос');
  return value;
}
const playerName = input => typeof input === 'string' ? input.trim().slice(0,28) || 'Гость' : 'Гость';

function seatOf(room,key,user) {
  return room.seats.findIndex(seat => seat && (seat.user ? seat.user === user?.id : key && seat.key === key));
}
function view(room, key, now, user) {
  const {id,seats,minutes,increment,game,version} = room;
  return {
    id, minutes, increment, version, game, now, variant:room.variant ?? 'brics', bot:room.bot ?? null,
    you:seatOf(room,key,user), rated:!!room.rated, tournament:room.tournament ?? null, draw:room.draw ?? [],
    seats:seats.map(p => p?.name ?? null)
  };
}

function validateGame(input) {
  if (![1,3,5,10,15,20,30,60].includes(input.minutes) || ![0,2,3,5,10,15,30].includes(input.increment)) fail(400,'Проверьте настройки часов');
  const variant = input.variant ?? 'brics';
  if (typeof variant !== 'string' || !Object.hasOwn(variants,variant)) fail(400,'Неизвестный вариант игры');
  return variant;
}
function joinSeat(room,slot,input,user,now) {
  const key = user ? null : token();
  room.seats[slot] = user ? {name:user.name,user:user.id} : {name:playerName(input.name),key};
  if (room.seats.every(Boolean) && !room.game) room.game = newMatch(room.variant ?? 'brics',room.minutes,room.increment,now);
  room.version++;
  return key;
}
function createRoom(input,user,variant,bot,rated,now) {
  if (rooms.size >= 1000) fail(503,'Достигнут лимит комнат');
  const id = randomBytes(9).toString('base64url');
  const seats = Array(variants[variant].colors.length).fill(bot ? {name:'ИИ'} : null);
  const room = {id,seats,variant,bot,rated,minutes:input.minutes,increment:input.increment,
    version:-1,createdAt:now, public:!bot && !rated && input.public === true,
    game:bot ? newMatch(variant,input.minutes,input.increment,now) : null};
  const key = joinSeat(room,0,input,user,now);
  rooms.set(id,room);
  return {room,key};
}
function checkpoint(room,now) {
  if (room.game?.result) room.finishedAt ??= now;
  tournaments.finish(room,now);
  save();
}

const tournaments = tournamentService(snapshot.tournaments ?? [],rooms,(entry,players,now) => {
  const id = randomBytes(9).toString('base64url');
  rooms.set(id,{id,variant:'classic',minutes:entry.minutes,increment:entry.increment,
    seats:players.map(player => ({name:player.name,user:player.id})),public:true,rated:false,bot:null,
    tournament:entry.id,version:0,createdAt:now,game:newMatch('classic',entry.minutes,entry.increment,now)});
  return id;
},save);

const botTasks = new Set();
async function advanceBot(room) {
  if (!room.bot || !room.game || room.game.result || room.game.turn === 0 || botTasks.has(room.id)) return;
  const version = room.version;
  botTasks.add(room.id);
  try {
    const move = room.bot === 'stockfish' ?
      (await analyzeStockfish(room.game))?.move ?? botMove(room.game,'medium') : await chooseLLMMove(room.game);
    if (room.version !== version || room.game.result) return;
    const now = Date.now();
    if (expire(room.game,now) || (move && applyMove(room.game,move,now))) {
      room.version++;
      checkpoint(room,now);
    }
  } catch (error) {
    console.error('Bot move failed:',error.message);
  } finally {
    botTasks.delete(room.id);
  }
}

const server = createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if (req.method === 'GET' && path === '/healthz') return reply(res,200,{status:'ok'});
    if (req.method === 'GET' && path === '/api/config') return reply(res,200,{llmEnabled,stockfishEnabled});
    if (req.method === 'POST' && (path === '/api/analysis/stockfish' || path === '/api/analysis/mentor')) {
      const input = await readBody(req);
      let position;
      try { position = readAnalysisPosition(input.position); }
      catch { fail(400,'Некорректная позиция для разбора'); }
      if (path.endsWith('/stockfish')) {
        if (position.variant !== 'classic') fail(400,'Stockfish доступен для классики');
        if (!stockfishEnabled) fail(503,'Stockfish не настроен');
        const analysis = await analyzeStockfish(position);
        if (!analysis) fail(503,'Stockfish не вернул ход');
        return reply(res,200,analysis);
      }
      if (!llmEnabled) fail(503,'Наставник не настроен');
      const move = legalMoves(position).find(candidate => candidate.from === input.move?.from &&
        candidate.to === input.move?.to && candidate.promotion === input.move?.promotion);
      if (!move) fail(422,'Ход недоступен в этой позиции');
      const explanation = await explainMove(position,move);
      if (!explanation) fail(503,'Наставник временно недоступен');
      return reply(res,200,{explanation});
    }
    const user = auth.current(req);
    const accountAction = /^\/api\/account(?:\/(register|login|recover|logout|profile))?$/.exec(path);
    if (accountAction) {
      const action = accountAction[1];
      if (req.method === 'GET' && !action) {
        return reply(res,200,user ? {user:auth.profile(user),stats:playerStats(rooms).get(user.id) ?? {},history:archive(rooms,user.id)} : {user:null});
      }
      if (req.method !== 'POST' || !action) fail(405,'Метод недоступен');
      const input = await readBody(req);
      if (action === 'logout') return reply(res,200,auth.logout(req,res));
      if (action === 'profile') {
        if (!user) fail(401,'Войдите в аккаунт');
        return reply(res,200,{user:auth.edit(user,input)});
      }
      return reply(res,200,await auth[action](req,res,input));
    }
    const tournamentRoute = /^\/api\/tournaments(?:\/([\w-]{12})\/join)?$/.exec(path);
    if (tournamentRoute) {
      if (req.method === 'GET' && !tournamentRoute[1]) {
        const now = Date.now();
        for (const room of [...rooms.values()]) {
          if (room.tournament && !room.game.result && expire(room.game,now)) {
            room.version++;
            checkpoint(room,now);
          }
        }
        return reply(res,200,{tournaments:tournaments.list(user)});
      }
      if (req.method !== 'POST') fail(405,'Метод недоступен');
      if (!user) fail(401,'Войдите в аккаунт для участия в турнире');
      const input = await readBody(req);
      const now = Date.now();
      if (tournamentRoute[1]) return reply(res,200,tournaments.join(tournamentRoute[1],user,now));
      validateGame({...input,variant:'classic'});
      return reply(res,201,tournaments.create(input,user,now));
    }
    if (req.method === 'GET' && path === '/api/leaderboard') {
      const stats = playerStats(rooms);
      const pools = {};
      for (const profile of auth.list()) {
        if (!profile.visible) continue;
        for (const [pool,record] of Object.entries(stats.get(profile.id) ?? {})) {
          if (record.rated) (pools[pool] ??= []).push({login:profile.login,name:profile.name,rating:record.rating,rated:record.rated});
        }
      }
      for (const records of Object.values(pools)) {
        records.sort((a,b) => b.rating - a.rating || b.rated - a.rated || a.login.localeCompare(b.login));
        records.splice(50);
      }
      return reply(res,200,{pools});
    }
    const publicProfile = /^\/api\/players\/([a-z0-9_]{3,24})$/.exec(path);
    if (req.method === 'GET' && publicProfile) {
      const profile = auth.list().find(entry => entry.login === publicProfile[1] && entry.visible);
      if (!profile) fail(404,'Публичный профиль не найден');
      return reply(res,200,{name:profile.name,login:profile.login,bio:profile.bio,stats:playerStats(rooms).get(profile.id) ?? {}});
    }
    if (req.method === 'GET' && path === '/api/live') {
      return reply(res,200,{rooms:[...rooms.values()].reverse()
        .filter(room => room.public && room.game && !room.game.result && !room.bot).slice(0,40)
        .map(room => ({id:room.id,variant:room.variant,minutes:room.minutes,increment:room.increment}))});
    }
    if (req.method === 'GET' && path === '/api/lobby') {
      const available = [...rooms.values()].filter(room => room.public && !room.game && !room.bot)
        .slice(-40).reverse().map(room => ({
          id:room.id, variant:room.variant, minutes:room.minutes, increment:room.increment,
          occupied:room.seats.filter(Boolean).length, capacity:room.seats.length
        }));
      return reply(res,200,{rooms:available});
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && media.has(path)) return serveAudio(req,res,media.get(path));
    if (req.method === 'GET' && assets.has(path)) {
      const {type,body} = assets.get(path);
      res.writeHead(200,{'Content-Type':type + '; charset=utf-8'});
      return res.end(body);
    }
    if ((path === '/api/rooms' || path === '/api/quick') && req.method === 'POST') {
      const input = await readBody(req);
      const variant = validateGame(input);
      const now = Date.now();
      if (path === '/api/quick') {
        if (!user) fail(401,'Войдите в аккаунт для рейтингового подбора');
        for (const [id,room] of rooms) {
          if (room.rated && !room.game && now - room.createdAt >= 600000) rooms.delete(id);
        }
        const own = [...rooms.values()].find(room => room.rated && !room.game && seatOf(room,null,user) >= 0);
        if (own) return reply(res,200,view(own,null,now,user));
        const pool = ratingPool(variant,input.minutes,input.increment);
        const stats = playerStats(rooms);
        const rating = id => stats.get(id)?.[pool]?.rating ?? 1500;
        const match = [...rooms.values()].find(room => room.rated && !room.game && room.variant === variant &&
          room.minutes === input.minutes && room.increment === input.increment &&
          room.seats.every(seat => !seat || Math.abs(rating(user.id) - rating(seat.user)) <= (now-room.createdAt >= 30000 ? 400 : 200)));
        if (match) {
          joinSeat(match,match.seats.indexOf(null),input,user,now);
          save();
          return reply(res,200,view(match,null,now,user));
        }
        const {room} = createRoom(input,user,variant,null,true,now);
        save();
        return reply(res,201,view(room,null,now,user));
      }
      if (input.bot !== undefined && !(
        (input.bot === 'llm' && llmEnabled) ||
        (input.bot === 'stockfish' && stockfishEnabled && variant === 'classic')
      )) fail(400,'Этот бот недоступен для выбранного варианта');
      const {room,key} = createRoom(input,user,variant,input.bot ?? null,false,now);
      save();
      return reply(res,201,{...view(room,key,now,user),...(key ? {key} : {})});
    }
    const match = /^\/api\/rooms\/([\w-]{12})(?:\/(join|move|resign|cancel|draw))?$/.exec(path);
    if (!match) fail(404,'Страница не найдена');
    const room = rooms.get(match[1]);
    if (!room) fail(404,'Комната не найдена');
    const action = match[2];
    const key = req.headers.authorization?.replace(/^Bearer /,'');
    if (!action && req.method === 'GET') {
      const now = Date.now();
      if (room.game && expire(room.game,now)) {
        room.version++;
        checkpoint(room,now);
      }
      if (seatOf(room,key,user) === 0) void advanceBot(room);
      return reply(res,200,view(room,key,now,user));
    }
    if (!action || req.method !== 'POST') fail(405,'Метод недоступен');
    const input = await readBody(req);
    const now = Date.now();
    const you = seatOf(room,key,user);
    if (action === 'join') {
      if (you >= 0) return reply(res,200,view(room,key,now,user));
      if (room.rated) fail(403,'Место в рейтинговой комнате выдаёт автоподбор');
      const slot = room.seats.indexOf(null);
      if (slot < 0) fail(409,'Все места уже заняты');
      const newKey = joinSeat(room,slot,input,user,now);
      save();
      return reply(res,200,{...view(room,newKey,now,user),...(newKey ? {key:newKey} : {})});
    }
    if (you < 0) fail(403,'Для этого действия нужно занять место');
    if (action === 'cancel') {
      if (!room.rated || room.game) fail(409,'Поиск уже завершён');
      room.seats[you] = null;
      room.version++;
      if (!room.seats.some(Boolean)) rooms.delete(room.id);
      save();
      return reply(res,200,{ok:true});
    }
    if (!room.game || room.game.result) fail(409,'Партия не активна');
    if (expire(room.game,now)) {
      room.version++;
      checkpoint(room,now);
      fail(409,'Время вышло');
    }
    if (room.version !== input.version) fail(409,'Позиция уже изменилась');
    if (action === 'draw') {
      if (room.bot || typeof input.accept !== 'boolean') fail(422,'Предложение ничьей недоступно');
      const votes = room.draw ?? [];
      room.draw = input.accept ? [...new Set([...votes,you])] : [];
      if (room.draw.length === room.seats.length) {
        room.game.result = {winner:null,reason:'Ничья по соглашению'};
        room.draw = [];
      }
    } else if (action === 'resign') {
      room.game.result = {winner:1-sideOf(room.game,you),reason:'Сдача'};
      room.draw = [];
    } else {
      if (you !== room.game.turn) fail(409,'Сейчас ход другого цвета');
      if (![input.from,input.to].every(n => Number.isInteger(n) && n >= 0 && n < room.game.board.length) || !applyMove(room.game,input,now)) {
        fail(422,'Этот ход недоступен');
      }
      room.draw = [];
    }
    room.version++;
    checkpoint(room,now);
    return reply(res,200,view(room,key,now,user));
  } catch (error) {
    if (!error.status) console.error(error);
    if (!res.headersSent) reply(res,error.status || 500,{error:error.status ? error.message : 'Ошибка сервера'});
  }
});
server.listen(Number(process.env.PORT || 3000),process.env.HOST || '0.0.0.0',() => {
  console.log('Шахматы БРИКС · http://localhost:' + server.address().port);
});






