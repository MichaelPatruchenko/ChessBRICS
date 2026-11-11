import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newMatch} from './public/match.js';

test('Четыре клиента играют по одной ссылке и сохраняют места после перезапуска',{timeout:15000},async t => {
  const data = await mkdtemp(join(tmpdir(),'brics-test-'));
  const uci = join(data,'uci.cjs');
  await writeFile(uci,`
if (process.argv.length === 1) {
  const lines = require('node:readline').createInterface({input:process.stdin,terminal:false});
  let move;
  lines.on('line',line => {
    if (line === 'uci') console.log('id name Test Engine\\nuciok');
    if (line === 'isready') console.log('readyok');
    if (line.startsWith('position fen ')) move = line.split(' ')[3] === 'w' ? 'e2e4' : 'e7e5';
    if (line.startsWith('go movetime ')) console.log('info depth 12 score cp 31 nodes 42 pv ' + move + '\\nbestmove ' + move);
  });
}
`);
  let child;
  const requests = [];
  const provider = createServer(async (req,res) => {
    let body = '';
    for await (const part of req) body += part;
    const payload = JSON.parse(body);
    requests.push({body:payload, auth:req.headers.authorization});
    const content = payload.messages[0].content.includes('tutor') ?
      'Фигура БРИКС выходит к центру.' : requests.length === 1 ? '999' : '0';
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{message:{content}}]}));
  });
  provider.listen(0,'127.0.0.1');
  await once(provider,'listening');
  t.after(() => provider.close());
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child,'exit');
      child.kill();
      await exited;
    }
  }
  t.after(async () => {
    await stop();
    await rm(data,{recursive:true,force:true});
  });
  let base;
  async function start() {
    child = spawn(process.execPath,['server.js'],{
      env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:data,
        CHESSBRICS_LLM_URL:'http://127.0.0.1:' + provider.address().port + '/chat',
        CHESSBRICS_LLM_MODEL:'test-model', CHESSBRICS_LLM_KEY:'test-key',
        CHESSBRICS_STOCKFISH_PATH:process.execPath,
        NODE_OPTIONS:[process.env.NODE_OPTIONS,'--require "' + uci.replaceAll('\\','/') + '"'].filter(Boolean).join(' ')
      }, stdio:['ignore','pipe','inherit']
    });
    const [chunk] = await Promise.race([
      once(child.stdout,'data'),
      once(child,'exit').then(([code]) => { throw new Error('Сервер завершился: ' + code); })
    ]);
    base = 'http://127.0.0.1:' + chunk.toString().match(/localhost:(\d+)/)[1];
  }
  async function call(path,{key,data,status=200}={}) {
    const response = await fetch(base + '/api/rooms' + path,{
      method:data ? 'POST' : 'GET',
      headers:{...(data ? {'Content-Type':'application/json'} : {}),...(key ? {Authorization:'Bearer ' + key} : {})},
      body:data ? JSON.stringify(data) : undefined
    });
    assert.equal(response.status,status);
    return response.json();
  }
  await start();
  for (const path of ['/','/app.js','/engine.js','/style.css','/pieces.svg']) {
    const response = await fetch(base + path);
    assert.equal(response.status,200);
    await response.arrayBuffer();
  }
  const music = await fetch(base + '/audio/lobby-cozy-evening.mp3',{method:'HEAD'});
  assert.equal(music.status,200);
  assert.equal(music.headers.get('content-type'),'audio/mpeg');
  assert.ok(Number(music.headers.get('content-length')) > 1000000);
  const part = await fetch(base + '/audio/lobby-cozy-evening.mp3',{headers:{Range:'bytes=100-199'}});
  assert.equal(part.status,206);
  assert.match(part.headers.get('content-range'),/^bytes 100-199\//);
  assert.equal((await part.arrayBuffer()).byteLength,100);
  assert.equal((await fetch(base + '/audio/move.mp3',{headers:{Range:'bytes=999999-'}})).status,416);
  const room = await call('',{data:{name:'Красный',minutes:5,increment:3},status:201});
  const path = '/' + room.id;
  assert.equal(room.game,null);
  const seats = [room];
  for (const name of ['Оранжевый','Зелёный','Синий']) seats.push(await call(path + '/join',{data:{name}}));
  const live = await call(path);
  assert.equal(live.game.turn,0);
  assert.equal(live.you,-1);
  assert.ok(!JSON.stringify(live).includes(room.key));
  await call(path + '/move',{key:seats[1].key,data:{from:10,to:50,version:live.version},status:409});
  await call(path + '/move',{key:room.key,data:{from:10,to:60,version:live.version},status:422});
  const moved = await call(path + '/move',{key:room.key,data:{from:10,to:50,version:live.version}});
  assert.equal(moved.game.turn,1);
  await stop();
  await start();
  const resumed = await call(path,{key:seats[2].key});
  assert.equal(resumed.you,2);
  assert.equal(resumed.game.board[50].type,'p');
  await call(path + '/move',{key:seats[1].key,data:{from:89,to:79,version:live.version},status:409});
  const result = await call(path + '/resign',{key:seats[1].key,data:{version:moved.version}});
  assert.equal(result.game.result.winner,0);

  const duel = await call('',{data:{name:'Красный',minutes:5,increment:3,variant:'brics-duel'},status:201});
  assert.equal(duel.seats.length,2);
  const duelPath = '/' + duel.id;
  const orange = await call(duelPath + '/join',{data:{name:'Оранжевый'}});
  assert.equal(orange.game.variant,'brics-duel');
  await call(duelPath + '/join',{data:{},status:409});
  const duelMove = await call(duelPath + '/move',{key:duel.key,data:{from:19,to:59,version:orange.version}});
  assert.equal(duelMove.game.turn,1);
  const duelReply = await call(duelPath + '/move',{key:orange.key,data:{from:80,to:40,version:duelMove.version}});
  assert.equal(duelReply.game.turn,0);

  const classic = await call('',{data:{name:'Белые',minutes:3,increment:2,variant:'classic',public:true},status:201});
  const lobby = await (await fetch(base + '/api/lobby')).json();
  assert.deepEqual(lobby.rooms.map(r => [r.id,r.capacity]),[[classic.id,2]]);
  const black = await call('/' + classic.id + '/join',{data:{name:'Чёрные'}});
  assert.equal(black.game.board.length,64);
  assert.equal(black.you,1);
  await call('/' + classic.id + '/join',{data:{name:'Лишнее место'},status:409});

  const training = await call('',{data:{name:'Белые',minutes:3,increment:2,variant:'classic',bot:'llm'},status:201});
  const botPath = '/' + training.id;
  async function afterBot(from,to,version,count) {
    await call(botPath + '/move',{key:training.key,data:{from,to,version}});
    for (let i = 0; i < 30; i++) {
      const current = await call(botPath,{key:training.key});
      if (current.game.history.length === count) return current;
      await new Promise(resolve => setTimeout(resolve,30));
    }
    assert.fail('Бот не сделал ход');
  }
  const fallback = await afterBot(12,28,0,2);
  assert.equal(fallback.game.turn,0);
  const next = await afterBot(11,19,fallback.version,4);
  assert.equal(next.game.turn,0);
  assert.equal(requests.length,2);
  assert.equal(requests[0].auth,'Bearer test-key');
  assert.equal(requests[0].body.model,'test-model');
  assert.match(requests[0].body.messages[1].content,/Legal moves:/);
  assert.ok(!JSON.stringify(next).includes('test-key'));

  async function account(path,data,cookie,status=200) {
    const res = await fetch(base + '/api/' + path,{
      method:data ? 'POST' : 'GET',
      headers:{...(data ? {'Content-Type':'application/json'} : {}),...(cookie ? {Cookie:cookie} : {})},
      body:data ? JSON.stringify(data) : undefined
    });
    assert.equal(res.status,status);
    const header = res.headers.get('set-cookie');
    if (header) assert.match(header,/HttpOnly; SameSite=Strict/);
    return {payload:await res.json(),cookie:header?.split(';')[0]};
  }
  const startFen = newMatch('classic',10,0,0).fen;
  const analyzed = await account('analysis/stockfish',{position:{variant:'classic',fen:startFen}});
  assert.equal(analyzed.payload.move.san,'e4');
  assert.deepEqual(analyzed.payload.score,{kind:'cp',value:31,depth:12});
  const position = {variant:'brics-duel',turn:0,board:newMatch('brics-duel',10,0,0).board};
  await account('analysis/stockfish',{position},null,400);
  await account('analysis/mentor',{position,move:{from:2,to:12}},null,422);
  assert.equal(requests.length,2);
  const mentor = await account('analysis/mentor',{position,move:{from:2,to:34}});
  assert.equal(mentor.payload.explanation,'Фигура БРИКС выходит к центру.');
  assert.match(requests.at(-1).body.messages[1].content,/Move to explain: c1-e4/);
  assert.equal(requests.at(-1).auth,'Bearer test-key');
  await call('',{data:{name:'Красный',minutes:5,increment:3,variant:'brics-duel',bot:'stockfish'},status:400});
  const stockfish = await call('',{data:{name:'Белые',minutes:3,increment:2,variant:'classic',bot:'stockfish'},status:201});
  const stockfishPath = '/' + stockfish.id;
  await call(stockfishPath + '/move',{key:stockfish.key,data:{from:12,to:28,version:0}});
  let stockfishGame;
  for (let i = 0; i < 40; i++) {
    stockfishGame = (await call(stockfishPath,{key:stockfish.key})).game;
    if (stockfishGame.history.length === 2) break;
    await new Promise(resolve => setTimeout(resolve,30));
  }
  assert.equal(stockfishGame.history[1]?.san,'e5');

  const password = 'a long test password';
  const alice = await account('account/register',{login:'alice',password});
  const bob = await account('account/register',{login:'bob',password});
  assert.match(alice.payload.recovery,/^[\w-]{32}$/);
  assert.ok(!JSON.stringify(alice.payload.user).includes('password'));
  await account('players/alice',null,null,404);
  await account('account/profile',{name:'Алиса',bio:'Тестовый профиль',visible:true},alice.cookie);
  assert.equal((await account('players/alice')).payload.bio,'Тестовый профиль');
  await account('quick',{variant:'classic',minutes:3,increment:2},null,401);
  const queue = {variant:'classic',minutes:3,increment:2};
  const waiting = (await account('quick',queue,alice.cookie,201)).payload;
  assert.equal(waiting.game,null);
  assert.equal((await account('quick',queue,alice.cookie)).payload.id,waiting.id);
  await call('/' + waiting.id + '/join',{data:{name:'Гость'},status:403});
  const paired = (await account('quick',queue,bob.cookie)).payload;
  assert.equal(paired.id,waiting.id);
  assert.equal(paired.you,1);
  const route = 'rooms/' + waiting.id;
  const white = (await account(route + '/move',{from:12,to:28,version:paired.version},alice.cookie)).payload;
  const blackMove = (await account(route + '/move',{from:52,to:36,version:white.version},bob.cookie)).payload;
  await account(route + '/resign',{version:blackMove.version},bob.cookie);
  const profile = (await account('account',null,alice.cookie)).payload;
  assert.equal(profile.stats['classic/blitz'].rating,1512);
  assert.equal(profile.history[0].score,'win');
  assert.deepEqual((await account('leaderboard')).payload.pools['classic/blitz'].map(row => row.login),['alice']);
  await stop();
  await start();
  assert.equal((await account(route,null,alice.cookie)).payload.you,0);
  assert.equal((await account('account',null,alice.cookie)).payload.history[0].id,waiting.id);
  const reset = await account('account/recover',{login:'alice',password:'new long test password',code:alice.payload.recovery});
  assert.notEqual(reset.payload.recovery,alice.payload.recovery);
  assert.equal((await account('account',null,alice.cookie)).payload.user,null);
  await account('account/login',{login:'alice',password},null,401);
  await account('account/recover',{login:'alice',password,code:alice.payload.recovery},null,401);
  const cancelled = (await account('quick',queue,reset.cookie,201)).payload;
  await account('rooms/' + cancelled.id + '/cancel',{},reset.cookie);
  await account('rooms/' + cancelled.id,null,reset.cookie,404);

  const third = await account('account/register',{login:'charlie',password});
  const fourth = await account('account/register',{login:'dana',password});
  const tournament = (await account('tournaments',{...queue,title:'Кубок',capacity:4},reset.cookie,201)).payload;
  const tournamentJoin = 'tournaments/' + tournament.id + '/join';
  await account(tournamentJoin,{},bob.cookie);
  await account(tournamentJoin,{},third.cookie);
  const seeded = (await account(tournamentJoin,{},fourth.cookie)).payload;
  const [first,second] = seeded.rounds[0];
  const firstRoom = 'rooms/' + first.games[0].id;
  const offer = (await account(firstRoom + '/draw',{accept:true,version:0},reset.cookie)).payload;
  await account(firstRoom + '/draw',{accept:true,version:offer.version},bob.cookie);
  const getTournament = async () => (await account('tournaments')).payload.tournaments.find(t => t.id === tournament.id);
  const replay = (await getTournament()).rounds[0][0].games[1];
  const replayRoom = 'rooms/' + replay.id;
  assert.equal((await account(replayRoom,null,reset.cookie)).payload.you,1);
  await account(replayRoom + '/resign',{version:0},bob.cookie);
  await account('rooms/' + second.games[0].id + '/resign',{version:0},fourth.cookie);
  const final = (await getTournament()).rounds[1][0].games[0];
  await account('rooms/' + final.id + '/resign',{version:0},third.cookie);
  assert.equal((await getTournament()).winner,'Алиса');
  await stop();
  await start();
  assert.equal((await getTournament()).winner,'Алиса');
});


