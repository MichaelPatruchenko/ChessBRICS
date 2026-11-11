import test from 'node:test';
import assert from 'node:assert/strict';
import {newMatch,legalMoves,applyMove,expire,pgn,replayPosition,square,captureHistory,readClassicStudy} from './public/match.js';
import {botMove} from './public/bot.js';
import {readAnalysisPosition,searchBrics,solveBrics} from './public/search.js';
import {arrangements} from './arrangements.js';

function move(game,san) {
  const m = legalMoves(game).find(m => m.san === san);
  assert.ok(m,san);
  assert.equal(applyMove(game,m,game.since),true);
}

test('Классическая доска, мат и PGN',() => {
  const game = newMatch('classic',10,3,0);
  assert.equal(game.board.length,64);
  assert.equal(legalMoves(game).length,20);
  for (const san of ['f3','e5','g4','Qh4#']) move(game,san);
  assert.deepEqual(game.result,{winner:1,reason:'Мат'});
  assert.match(pgn(game),/1\. f3 e5 2\. g4 Qh4# 0-1/);
});

test('Взятие на проходе и рокировка в классике',() => {
  const game = newMatch('classic',10,0,0);
  for (const san of ['e4','a6','e5','d5','exd6']) move(game,san);
  assert.equal(game.board[35],null);
  assert.equal(game.board[43].type,'p');
  const expected = [{ply:5,by:0,color:1,type:'p'}];
  assert.deepEqual(captureHistory(JSON.parse(JSON.stringify(game))),expected);
  assert.deepEqual(captureHistory(readClassicStudy(pgn(game),'pgn')),expected);
  const castle = newMatch('classic',10,0,0,'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  move(castle,'O-O');
  assert.equal(castle.board[6].type,'k');
  assert.equal(castle.board[5].type,'r');
  assert.deepEqual(captureHistory(castle),[]);
});

test('История взятий БРИКС сохраняет цвет соперника и пропускает рокировку-обмен',() => {
  const duel = newMatch('brics-duel',10,0,0);
  for (const [from,to] of [[4,5],[88,78],[10,50],[81,61],[50,61]]) {
    assert.equal(applyMove(duel,{from,to},0),true);
  }
  assert.deepEqual(captureHistory(duel),[{ply:5,by:0,color:1,type:'p'}]);

  const team = newMatch('brics',10,0,0);
  for (const [from,to] of [[14,54],[89,79],[15,25],[83,63],[54,63]]) {
    assert.equal(applyMove(team,{from,to},0),true);
  }
  assert.deepEqual(captureHistory(JSON.parse(JSON.stringify(team))),[{ply:5,by:0,color:3,type:'p'}]);
});

test('Троекратное повторение сохраняется в сериализуемой истории',() => {
  let game = newMatch('classic',10,0,0);
  for (const san of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1']) move(game,san);
  game = JSON.parse(JSON.stringify(game));
  move(game,'Ng8');
  assert.deepEqual(game.result,{winner:null,reason:'Троекратное повторение'});
});

test('Боты всех вариантов выбирают допустимый ход',() => {
  for (const variant of ['classic','brics','brics-duel']) {
    for (const level of ['easy','medium','hard']) {
      const game = newMatch(variant,10,0,0);
      const move = botMove(game,level,() => .5);
      assert.ok(move,square(move?.from));
      assert.ok(applyMove(game,move,0));
    }
  }
});

test('Дуэль БРИКС объединяет фигуры стороны, чередует два места и сохраняет позицию при просмотре',() => {
  const game = newMatch('brics-duel',5,3,0);
  assert.deepEqual(game.clock,[300000,300000]);
  assert.equal(game.board.filter(piece => piece?.color === 0).length,20);
  assert.equal(game.board.filter(piece => piece?.color === 1).length,20);
  assert.equal(applyMove(game,{from:19,to:59},1000),true);
  assert.equal(game.turn,1);
  assert.equal(applyMove(game,{from:80,to:40},2000),true);
  assert.equal(game.turn,0);
  assert.deepEqual(game.clock,[302000,302000]);
  const replay = replayPosition(JSON.parse(JSON.stringify(game)),1);
  assert.equal(replay.variant,'brics-duel');
  assert.equal(replay.turn,1);
  assert.equal(replay.board[59].color,0);
  assert.equal(expire(game,304000),true);
  assert.equal(game.result.winner,1);
});

test('Поиск БРИКС находит взятие короля и сообщает о неполном обходе графа',() => {
  const board = Array(100).fill(null);
  board[44] = {color:0,type:'k',moved:true};
  board[45] = {color:1,type:'k',moved:true};
  const position = readAnalysisPosition({variant:'brics-duel',board,turn:0});
  const move = {from:44,to:45};
  assert.deepEqual(searchBrics(position).move,move);
  assert.deepEqual(solveBrics(position,{maxNodes:1}),{complete:false,nodes:1,outcome:null,move:null});
  const solved = solveBrics(position);
  assert.equal(solved.complete,true);
  assert.equal(solved.outcome,'win');
  assert.equal(solved.distance,1);
  assert.deepEqual(solved.move,move);
  assert.deepEqual(botMove(position,'hard'),move);
  const seeded = searchBrics(position,{depth:5,maxNodes:1,seed:{move,score:20,depth:2}});
  assert.deepEqual(seeded,{move,score:20,depth:2,nodes:1});

  board[45] = null;
  board[99] = {color:1,type:'k',moved:true};
  const draw = solveBrics(readAnalysisPosition({variant:'brics-duel',board,turn:0}));
  assert.equal(draw.outcome,'draw');
  assert.ok(draw.move);
});

test('Перебор произвольных расстановок учитывает оба признака движения королей и очередность',() => {
  const positions = [...arrangements('brics',2,[4,94])];
  assert.equal(positions.length,16);
  assert.deepEqual(positions.slice(0,4).map(position => position.turn),[0,1,2,3]);
  assert.equal(positions[0].board[94].color,3);
  assert.equal(positions[0].board[94].moved,false);
  assert.equal(positions[4].board[94].moved,true);
  const position = arrangements('brics-duel',3,[0,99]).next().value;
  assert.equal(position.board.filter(Boolean).length,3);
  assert.equal(position.board[0].color,0);
  assert.equal(position.board[99].color,1);
});
