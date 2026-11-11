import {advancePosition,allMoves,hasMoves,team} from './engine.js';
import {newMatch,variants} from './match.js';

const values = {p:100,n:320,b:335,r:500,q:900,k:0,x:540};
const mate = 100000;
const budgetExceeded = Symbol('budget exceeded');

export function readAnalysisPosition(input) {
  const {variant} = input ?? {};
  if (typeof variant !== 'string' || !Object.hasOwn(variants,variant)) throw new Error('Неизвестный вариант.');
  if (variant === 'classic') {
    if (typeof input.fen !== 'string' || !/^[prnbqkPRNBQK1-8/]+ [wb] (?:-|[KQkq]{1,4}) (?:-|[a-h][36]) \d{1,4} \d{1,6}$/.test(input.fen)) {
      throw new Error('Некорректная позиция FEN.');
    }
    return newMatch(variant,10,0,0,input.fen);
  }
  const seats = variants[variant].colors.length;
  if (!Number.isInteger(input.turn) || input.turn < 0 || input.turn >= seats ||
      !Array.isArray(input.board) || input.board.length !== 100) throw new Error('Некорректная позиция БРИКС.');
  const kings = [0,0], pieces = [0,0];
  const board = input.board.map(piece => {
    if (piece === null) return null;
    if (!piece || !Number.isInteger(piece.color) || piece.color < 0 || piece.color >= seats ||
        typeof piece.type !== 'string' || !/^[prnbqkx]$/.test(piece.type) || typeof piece.moved !== 'boolean') {
      throw new Error('Некорректная фигура БРИКС.');
    }
    const {color,type,moved} = piece;
    pieces[team(color)]++;
    if (type === 'k') kings[team(color)]++;
    return {color,type,moved};
  });
  if (kings.some(count => count !== 1) || pieces.some(count => count > 20)) {
    throw new Error('У каждой стороны должен быть один король и максимум 20 фигур.');
  }
  return {variant,board,turn:input.turn,result:null};
}

export function evaluateBrics(position,ply) {
  if (position.result) return ply - mate;
  if (!hasMoves(position)) return 0;
  const side = team(position.turn);
  return position.board.reduce((score,piece,i) => {
    if (!piece) return score;
    const distance = Math.abs(i % 10 - 4.5) + Math.abs(Math.floor(i / 10) - 4.5);
    const value = values[piece.type] + (piece.type === 'k' ? 0 : (10 - distance) * 4);
    return score + (team(piece.color) === side ? value : -value);
  },0);
}

function orderedMoves(position) {
  const priority = move => {
    const target = move.castle ? null : position.board[move.to];
    return (target?.type === 'k' ? mate : values[target?.type] ?? 0) + (values[move.promotion] ?? 0);
  };
  return allMoves(position).sort((a,b) => priority(b) - priority(a));
}

export function searchBrics(position,{depth = 3,maxNodes = 30000,seed = null} = {}) {
  let nodes = 0;
  function visit(current,remaining,ply,alpha,beta) {
    if (nodes === maxNodes) throw budgetExceeded;
    nodes++;
    if (current.result) return {score:ply - mate,move:null};
    if (!remaining) return {score:evaluateBrics(current,ply),move:null};
    const moves = orderedMoves(current);
    if (!moves.length) return {score:0,move:null};
    if (ply === 0 && best.move) {
      const preferred = moves.findIndex(move => sameMove(move,best.move));
      if (preferred > 0) moves.unshift(...moves.splice(preferred,1));
    }
    let score = -Infinity, move = null;
    for (const candidate of moves) {
      const value = -visit(advancePosition(current,candidate),remaining - 1,ply + 1,-beta,-alpha).score;
      if (value > score) {
        score = value;
        move = candidate;
      }
      alpha = Math.max(alpha,value);
      if (alpha >= beta) break;
    }
    return {score,move};
  }
  let best = seed ?? {move:orderedMoves(position)[0] ?? null,score:null,depth:0};
  if (seed && Math.abs(seed.score) >= mate - seed.depth) return {...best,nodes};
  for (let level = best.depth + 1; level <= depth; level++) {
    try {
      best = {...visit(position,level,0,-Infinity,Infinity),depth:level};
      if (!best.move || Math.abs(best.score) >= mate - level) break;
    } catch (error) {
      if (error !== budgetExceeded) throw error;
      break;
    }
  }
  return {...best,nodes};
}

export const sameMove = (a,b) => a.from === b.from && a.to === b.to && a.promotion === b.promotion;
const pieceCodes = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrst';
export const positionKey = position => position.turn + position.board.map(piece => piece ?
  pieceCodes['prnbqkx'.indexOf(piece.type) * 8 + piece.color * 2 + Number(piece.moved)] : '.').join('');

export function endgameKey(position) {
  const cells = [-1,-1];
  const moved = [0,0];
  for (let i = 0; i < 100; i++) {
    const piece = position.board[i];
    if (!piece) continue;
    const side = team(piece.color);
    const expectedColor = side === 0 ? 0 : position.variant === 'brics-duel' ? 1 : 3;
    if (piece.type !== 'k' || piece.color !== expectedColor || cells[side] >= 0) return null;
    cells[side] = i;
    moved[side] = Number(piece.moved);
  }
  if (cells.includes(-1)) return null;
  return ((cells[0] * 100 + cells[1]) * 4 + position.turn) * 4 + moved[0] * 2 + moved[1];
}

export function relativeBricsScore(score,ply,depth) {
  return Math.abs(score) >= mate - depth ? score + Math.sign(score) * ply : score;
}

// Enumerate reachable positions, then propagate forced wins and losses backwards.
// Unresolved cycles represent infinite play, valued as draws by the solver.
export function solveBrics(position,{maxNodes = 25000} = {}) {
  const solved = solveBricsPositions([position],{maxNodes});
  if (!solved.complete) return {complete:false,nodes:solved.nodes,outcome:null,move:null};
  return {complete:true,nodes:solved.nodes,...solved.results[0]};
}

export function solveBricsPositions(positions,{maxNodes}) {
  const states = [];
  const ids = new Map();
  function intern(current) {
    const key = positionKey(current);
    if (ids.has(key)) return ids.get(key);
    if (states.length === maxNodes) throw budgetExceeded;
    const id = states.length;
    ids.set(key,id);
    states.push({position:current,parents:[],remaining:0,outcome:0,distance:0});
    return id;
  }
  const queue = [];
  const roots = [];
  const rootMoves = new Map();
  try {
    for (const position of positions) {
      const id = intern(position);
      roots.push(id);
      rootMoves.set(id,[]);
    }
    for (let id = 0; id < states.length; id++) {
      const state = states[id];
      const current = state.position;
      state.position = null;
      if (current.result) {
        state.outcome = -1;
        queue.push(id);
        continue;
      }
      const moves = allMoves(current);
      state.remaining = moves.length;
      for (const move of moves) {
        const next = intern(advancePosition(current,move));
        states[next].parents.push(id);
        rootMoves.get(id)?.push({next,move});
      }
    }
  } catch (error) {
    if (error !== budgetExceeded) throw error;
    return {complete:false,nodes:states.length};
  }
  for (let i = 0; i < queue.length; i++) {
    const child = states[queue[i]];
    for (const id of child.parents) {
      const parent = states[id];
      if (parent.outcome) continue;
      if (child.outcome === 1 && --parent.remaining > 0) continue;
      parent.outcome = -child.outcome;
      parent.distance = child.distance + 1;
      queue.push(id);
    }
  }
  const results = roots.map(id => {
    const root = states[id];
    const choice = rootMoves.get(id).find(({next}) => {
      const child = states[next];
      return child.outcome === -root.outcome && (!root.outcome || child.distance + 1 === root.distance);
    });
    return {outcome:['loss','draw','win'][root.outcome + 1],distance:root.outcome ? root.distance : null,
      move:choice?.move ?? null};
  });
  return {complete:true,nodes:states.length,results};
}
