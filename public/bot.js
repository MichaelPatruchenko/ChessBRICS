import {Chess} from './vendor/chess.js';
import {applyMove, legalMoves, sideOf, variantOf} from './match.js';
import {endgameKey,positionKey,sameMove,searchBrics} from './search.js';
import openingBook from './brics-opening-book.js';
import endgames from './brics-endgames.js';

const values = {p:100,n:320,b:335,r:500,q:900,k:0,x:540};
function positionScore(game,side) {
  if (game.result) return game.result.winner === null ? 0 : game.result.winner === side ? 100000 : -100000;
  const size = Math.sqrt(game.board.length);
  return game.board.reduce((score,piece,i) => {
    if (!piece) return score;
    const own = sideOf(game,piece.color) === side;
    const distance = Math.abs(i % size - (size - 1)/2) + Math.abs(Math.floor(i / size) - (size - 1)/2);
    return score + (own ? 1 : -1) * (values[piece.type] + (piece.type === 'k' ? 0 : (size - distance) * 4));
  },0);
}

function classicScore(chess,depth,alpha,beta) {
  if (chess.isCheckmate()) return -100000-depth;
  if (chess.isDraw()) return 0;
  if (!depth) {
    const turn = chess.turn();
    return chess.board().flat().reduce((sum,p) => sum + (p ? (p.color === turn ? 1 : -1) * values[p.type] : 0),0);
  }
  let best = -Infinity;
  for (const move of chess.moves({verbose:true}).sort((a,b) => (values[b.captured] ?? 0) - (values[a.captured] ?? 0))) {
    chess.move(move.san);
    best = Math.max(best,-classicScore(chess,depth-1,-beta,-alpha));
    chess.undo();
    alpha = Math.max(alpha,best);
    if (alpha >= beta) break;
  }
  return best;
}

export function botMove(game,level = 'medium',random = Math.random) {
  const variant = variantOf(game);
  const classic = variant === 'classic';
  if (!classic && level === 'hard') {
    if (game.result) return null;
    const target = endgames[variant]?.[endgameKey(game)];
    if (target !== undefined) {
      const move = legalMoves(game).find(candidate => candidate.to === target);
      if (move) return move;
    }
    const record = openingBook[variant]?.[positionKey(game)];
    let seed = null;
    if (record) {
      const [from,to,promotion,score,depth] = record;
      const move = legalMoves(game,from).find(candidate => sameMove(candidate,{from,to,promotion:promotion ?? undefined}));
      if (move) seed = {move,score,depth};
    }
    return searchBrics(game,{depth:5,maxNodes:150000,seed}).move;
  }
  const legal = legalMoves(game);
  if (!legal.length) return null;
  if (level === 'easy') return legal[Math.floor(random() * legal.length)];
  const side = sideOf(game,game.turn);
  const chess = classic && new Chess(game.fen);
  let best = -Infinity;
  let chosen = legal[0];
  for (const move of legal) {
    let score;
    if (classic) {
      chess.move(move.san);
      score = -classicScore(chess,level === 'hard' ? 1 : 0,-Infinity,Infinity);
      chess.undo();
    } else {
      const next = structuredClone(game);
      applyMove(next,move,game.since);
      score = positionScore(next,side);
    }
    score += random() * (level === 'hard' ? 3 : 20);
    if (score > best) {
      best = score;
      chosen = move;
    }
  }
  return chosen;
}

