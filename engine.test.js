import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame,moves,play,expire} from './public/engine.js';

test('Расстановка, порядок четырёх цветов, первый ход пешки и добавка',() => {
  const game = newGame(5,3,0);
  assert.equal(game.board.filter(Boolean).length,40);
  assert.deepEqual([2,7,92,97].map(i => game.board[i].type),['x','x','x','x']);
  assert.deepEqual(moves(game,10).map(m => m.to),[20,30,40,50]);
  for (const [from,to] of [[10,50],[89,79],[19,59],[80,70]]) {
    assert.equal(play(game,{from,to},1000),true);
  }
  assert.equal(game.turn,0);
  assert.equal(game.clock[0],302000);
  assert.deepEqual(moves(game,50).map(m => m.to),[60]);
  assert.equal(expire(game,303000),true);
  assert.equal(game.result.winner,1);
});

test('БРИКС прыгает на внешнюю границу квадрата, включая смещённые цели',() => {
  const game = newGame(5,0,0);
  game.board.fill(null);
  game.board[4] = {color:0,type:'k',moved:true};
  game.board[94] = {color:3,type:'k',moved:true};
  game.board[44] = {color:0,type:'x',moved:true};
  game.board[54] = {color:0,type:'p',moved:true};
  const destinations = moves(game,44).map(m => m.to);
  assert.equal(destinations.length,24);
  assert.ok(destinations.includes(75));
  assert.ok(!destinations.includes(55));
});

test('Рокировка доступна со всеми нетронутыми фигурами команды на горизонтали',() => {
  const game = newGame(5,0,0);
  const castleTargets = () => moves(game,4).filter(m => m.castle).map(m => m.to);
  assert.deepEqual(castleTargets(),[0,1,2,3,5,6,7,8,9]);
  game.board[0].moved = true;
  game.board[1] = {color:2,type:'p',moved:false};
  game.board[2] = {color:1,type:'r',moved:false};
  game.board[13] = {color:0,type:'n',moved:false};
  game.board[14] = {color:1,type:'r',moved:false};
  assert.deepEqual(castleTargets(),[3,5,6,7,8,9]);
  assert.equal(play(game,{from:4,to:9},100),true);
  assert.deepEqual(game.board[9],{color:0,type:'k',moved:true});
  assert.deepEqual(game.board[4],{color:2,type:'r',moved:true});
  assert.equal(game.history[0].capture,false);
  assert.equal(game.history[0].castle,true);
  game.turn = 0;
  assert.ok(!moves(game,9).some(m => m.castle));
});

test('Пешка требует явного выбора фигуры при превращении',() => {
  const game = newGame(5,0,0);
  game.board[80] = {color:0,type:'p',moved:true};
  game.board[90] = null;
  assert.equal(play(game,{from:80,to:90},100),false);
  assert.equal(play(game,{from:80,to:90,promotion:'x'},100),true);
  assert.equal(game.board[90].type,'x');
});


test('В БРИКС король остаётся под угрозой и партия завершается его взятием',() => {
  const game = newGame(5,0,0);
  game.board.fill(null);
  game.board[4] = {color:0,type:'k',moved:true};
  game.board[94] = {color:3,type:'k',moved:true};
  game.board[14] = {color:1,type:'r',moved:true};
  game.board[10] = {color:0,type:'p',moved:false};
  assert.equal(play(game,{from:10,to:20},100),true);
  assert.equal(game.result,null);
  assert.ok(moves(game,14).some(m => m.to === 4));
  assert.equal(play(game,{from:14,to:4},200),true);
  assert.deepEqual(game.result,{winner:1,reason:'Король взят'});
  assert.equal(game.board[4].type,'r');
});
