import * as brics from './engine.js';
import {Chess, DEFAULT_POSITION} from './vendor/chess.js';

export const variants = {
  brics:{size:10, colors:brics.colors, sides:['команда 1','команда 2'], title:'БРИКС 2×2'},
  'brics-duel':{size:10, colors:brics.colors.slice(0,2), sides:['красные','оранжевые'], title:'БРИКС 1×1'},
  classic:{size:8, colors:['Белые','Чёрные'], sides:['белые','чёрные'], title:'Классические шахматы'}
};
export const variantOf = game => game?.variant ?? 'brics';
export const sideOf = (game,color) => variantOf(game) === 'classic' ? color : brics.team(color);
export const square = (index,size = 10) => 'abcdefghij'[index % size] + (1 + Math.floor(index / size));
const indexOf = cell => (Number(cell[1]) - 1) * 8 + cell.charCodeAt(0) - 97;

function boardOf(chess) {
  return chess.board().reverse().flat().map(piece => piece && ({
    color:piece.color === 'w' ? 0 : 1, type:piece.type
  }));
}
export function newMatch(variant,minutes,increment,now = Date.now(),fen = DEFAULT_POSITION) {
  if (variant !== 'classic') return brics.newGame(minutes,increment,now,variant === 'brics-duel');
  const chess = new Chess(fen);
  return {variant, board:boardOf(chess), turn:chess.turn() === 'w' ? 0 : 1, history:[],
    clock:Array(2).fill(minutes * 60000), increment:increment * 1000, since:now,
    startFen:chess.fen(), fen:chess.fen(), result:null};
}

const positionKey = fen => fen.split(' ').slice(0,4).join(' ');
const asMove = move => ({
  from:indexOf(move.from), to:indexOf(move.to), ...(move.promotion ? {promotion:move.promotion} : {}),
  type:move.piece, castle:move.isKingsideCastle() || move.isQueensideCastle(),
  capture:!!move.captured, san:move.san
});

export function legalMoves(game,from) {
  if (variantOf(game) !== 'classic') return from === undefined ? brics.allMoves(game) : brics.moves(game,from);
  if (game.result || (from !== undefined && game.board[from]?.color !== game.turn)) return [];
  return new Chess(game.fen).moves({verbose:true,...(from === undefined ? {} : {square:square(from,8)})}).map(asMove);
}

export function checks(game) {
  if (variantOf(game) !== 'classic') return [0,1].map(side => brics.inCheck(game.board,side));
  const chess = new Chess(game.fen);
  return [0,1].map(side => {
    const king = game.board.findIndex(piece => piece?.type === 'k' && piece.color === side);
    return chess.isAttacked(square(king,8),side === 0 ? 'b' : 'w');
  });
}

export const expire = brics.expire;

export function applyMove(game,input,now) {
  if (variantOf(game) !== 'classic') return brics.play(game,input,now);
  if (expire(game,now) || game.result || ![input.from,input.to].every(i => Number.isInteger(i) && i >= 0 && i < 64)) return false;
  const chess = new Chess(game.fen);
  let move;
  try {
    move = chess.move({from:square(input.from,8),to:square(input.to,8),promotion:input.promotion});
  } catch {
    return false;
  }
  if (move.promotion !== input.promotion) return false;
  game.board = boardOf(chess);
  game.fen = chess.fen();
  const position = positionKey(game.fen);
  const repeats = game.history.filter(entry => entry.position === position).length + (positionKey(game.startFen) === position ? 1 : 0);
  game.history.push({...asMove(move),color:game.turn,position});
  game.clock[game.turn] += game.increment - (now - game.since);
  game.since = now;
  game.turn = 1 - game.turn;
  if (chess.isCheckmate()) game.result = {winner:1-game.turn,reason:'Мат'};
  else {
    const reason = chess.isStalemate() ? 'Пат' : chess.isInsufficientMaterial() ? 'Недостаточно фигур' :
      repeats >= 2 ? 'Троекратное повторение' : chess.isDrawByFiftyMoves() ? 'Правило 50 ходов' : null;
    if (reason) game.result = {winner:null,reason};
  }
  return true;
}

export function pgn(game) {
  const chess = new Chess(game.startFen);
  for (const {san} of game.history) chess.move(san);
  chess.setHeader('Result',game.importedResult ?? (!game.result ? '*' :
    game.result.winner === null ? '1/2-1/2' : game.result.winner === 0 ? '1-0' : '0-1'));
  return chess.pgn();
}

export function readClassicStudy(text,kind) {
  if (typeof text !== 'string' || !text.trim() || text.length > 30000) throw new Error('Введите позицию FEN или запись PGN до 30 000 символов.');
  const chess = new Chess();
  if (kind === 'fen') chess.load(text.trim());
  else {
    chess.loadPgn(text);
    if (!chess.history().length) throw new Error('В записи PGN нет ходов.');
  }
  const entries = chess.history({verbose:true});
  const startFen = entries[0]?.before ?? chess.fen();
  const game = newMatch('classic',10,0,0,startFen);
  game.board = boardOf(chess);
  game.turn = chess.turn() === 'w' ? 0 : 1;
  game.fen = chess.fen();
  game.history = entries.map(entry => ({...asMove(entry),color:entry.color === 'w' ? 0 : 1,position:positionKey(entry.after)}));
  game.importedResult = chess.getHeaders().Result ?? '*';
  game.result = {winner:null,reason:'Импортированная запись'};
  return game;
}

export function captureHistory(game) {
  const lastCapture = game.history.findLastIndex(move => move.capture);
  if (lastCapture < 0) return [];
  const captures = [];
  const variant = variantOf(game);
  const chess = variant === 'classic' ? new Chess(game.startFen) : null;
  let position = chess ? null : newMatch(variant,10,0,0);
  for (let index = 0; index <= lastCapture; index++) {
    const entry = game.history[index];
    let piece;
    if (chess) {
      const move = chess.move(entry.san);
      if (move.captured) piece = {color:1 - entry.color,type:move.captured};
    } else {
      if (!entry.castle) piece = position.board[entry.to];
      position = brics.advancePosition(position,entry);
    }
    if (piece) captures.push({ply:index + 1,by:entry.color,color:piece.color,type:piece.type});
  }
  return captures;
}

export function replayPosition(game,count) {
  const replay = newMatch(variantOf(game),10,0,0,game.startFen);
  if (variantOf(game) === 'classic') {
    const chess = new Chess(game.startFen);
    for (const entry of game.history.slice(0,count)) chess.move(entry.san);
    replay.board = boardOf(chess);
    replay.fen = chess.fen();
    replay.turn = chess.turn() === 'w' ? 0 : 1;
    replay.history = game.history.slice(0,count);
  } else {
    for (const move of game.history.slice(0,count)) applyMove(replay,move,0);
  }
  return replay;
}

