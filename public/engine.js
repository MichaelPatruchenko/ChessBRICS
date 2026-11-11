export const colors = ['Красные', 'Оранжевые', 'Зелёные', 'Синие'];
export const team = color => color % 2;
export const square = index => 'abcdefghij'[index % 10] + (1 + Math.floor(index / 10));
const lines = [[1,0],[-1,0],[0,1],[0,-1]];
const diagonals = [[1,1],[-1,1],[1,-1],[-1,-1]];
const directions = [...lines, ...diagonals];
const knight = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
const at = (x,y) => x >= 0 && x < 10 && y >= 0 && y < 10 ? y * 10 + x : -1;

export function newGame(minutes, increment, now = Date.now(), duel = false) {
  const board = Array(100).fill(null);
  for (const rank of [0,9]) {
    for (let x = 0; x < 10; x++) {
      const color = duel ? Number(rank === 9) : rank === 0 ? (x < 5 ? 0 : 2) : (x < 5 ? 3 : 1);
      board[at(x,rank)] = {color, type:'rnxbkqbxnr'[x], moved:false};
      board[at(x,rank === 0 ? 1 : 8)] = {color, type:'p', moved:false};
    }
  }
  return {...(duel ? {variant:'brics-duel'} : {}), board, turn:0, history:[],
    clock:Array(duel ? 2 : 4).fill(minutes * 60000), increment:increment * 1000, since:now, result:null};
}

function targets(board, from, attack = false) {
  const {color,type,moved} = board[from];
  const side = team(color);
  const x = from % 10, y = Math.floor(from / 10);
  const result = [];
  const push = to => {
    if (to >= 0 && (!board[to] || team(board[to].color) !== side)) result.push(to);
  };
  if (type === 'p') {
    const dy = side === 0 ? 1 : -1;
    for (const dx of [-1,1]) {
      const to = at(x + dx,y + dy);
      if (attack || board[to]) push(to);
    }
    if (!attack) {
      for (let n = 1; n <= (moved ? 1 : 4); n++) {
        const to = at(x,y + n * dy);
        if (to < 0 || board[to]) break;
        result.push(to);
      }
    }
    return result;
  }
  if (type === 'x') {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (Math.max(Math.abs(dx),Math.abs(dy)) === 3) push(at(x + dx,y + dy));
      }
    }
    return result;
  }
  const steps = {n:knight, b:diagonals, r:lines, k:directions, q:directions}[type];
  for (const [dx,dy] of steps) {
    for (let n = 1; n <= ('kn'.includes(type) ? 1 : 9); n++) {
      const to = at(x + n * dx,y + n * dy);
      if (to < 0) break;
      push(to);
      if (board[to]) break;
    }
  }
  return result;
}

export function inCheck(board, side) {
  const king = board.findIndex(p => p?.type === 'k' && team(p.color) === side);
  return king >= 0 && board.some((p,i) => p && team(p.color) !== side && targets(board,i,true).includes(king));
}

function after(board, move) {
  const {from,to,castle,promotion} = move;
  const copy = board.slice();
  copy[from] = castle ? {...board[to], moved:true} : null;
  copy[to] = {...board[from], type:promotion || board[from].type, moved:true};
  return copy;
}

export function moves(game, from) {
  const board = game.board;
  const p = board[from];
  if (game.result || !p || p.color !== game.turn) return [];
  const side = team(p.color);
  const legal = targets(board,from).flatMap(to => {
    if (p.type === 'p' && Math.floor(to / 10) === (side === 0 ? 9 : 0)) {
      return [...'qrbnx'].map(promotion => ({from,to,promotion}));
    }
    return [{from,to}];
  });
  if (p.type === 'k' && !p.moved) {
    const first = from - from % 10;
    for (let to = first; to < first + 10; to++) {
      const partner = board[to];
      if (to !== from && partner && !partner.moved && partner.type !== 'p' && team(partner.color) === side) {
        legal.push({from,to,castle:true});
      }
    }
  }
  return legal;
}

export function allMoves(game) {
  return game.board.flatMap((_,from) => moves(game,from));
}

export function hasMoves(game) {
  return !game.result && game.board.some((piece,from) => piece?.color === game.turn && moves(game,from).length > 0);
}

export function advancePosition(game,move) {
  const captured = move.castle ? null : game.board[move.to];
  const board = after(game.board,move);
  const turn = (game.turn + 1) % (game.variant === 'brics-duel' ? 2 : 4);
  const result = captured?.type === 'k' ? {winner:team(game.turn),reason:'Король взят'} : null;
  return {variant:game.variant,board,turn,result};
}

export function expire(game, now) {
  if (!game.result && now - game.since >= game.clock[game.turn]) {
    game.clock[game.turn] = 0;
    game.result = {winner:1 - team(game.turn), reason:'Время вышло'};
    return true;
  }
  return false;
}

export function play(game, input, now) {
  if (expire(game,now) || game.result) return false;
  const move = moves(game,input.from).find(m => m.to === input.to && m.promotion === input.promotion);
  if (!move) return false;
  const captured = move.castle ? null : game.board[move.to];
  const type = game.board[move.from].type;
  const next = advancePosition(game,move);
  game.board = next.board;
  game.clock[game.turn] += game.increment - (now - game.since);
  game.since = now;
  game.history.push({...move, color:game.turn, capture:!!captured, type});
  game.turn = next.turn;
  if (next.result) game.result = next.result;
  else if (!hasMoves(game)) game.result = {winner:null,reason:'Нет доступных ходов'};
  return true;
}

