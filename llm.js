import {botMove} from './public/bot.js';
import {applyMove,checks,legalMoves,newMatch,square,variantOf} from './public/match.js';

const {CHESSBRICS_LLM_URL:url, CHESSBRICS_LLM_MODEL:model, CHESSBRICS_LLM_KEY:key} = process.env;
export const llmEnabled = Boolean(url && model);
let inFlight = 0;
const recent = [];

async function chat(messages,maxTokens,timeout) {
  const now = Date.now();
  while (recent.length && now - recent[0] >= 60000) recent.shift();
  if (!llmEnabled || inFlight >= 2 || recent.length >= 12) return null;
  recent.push(now);
  inFlight++;
  try {
    const response = await fetch(url,{
      method:'POST', redirect:'error', signal:AbortSignal.timeout(timeout),
      headers:{'Content-Type':'application/json', ...(key ? {Authorization:'Bearer ' + key} : {})},
      body:JSON.stringify({model,messages,max_tokens:maxTokens,stream:false})
    });
    if (response.ok) {
      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content === 'string') return content.trim() || null;
    }
  } catch {
    // The caller handles provider errors and timeouts.
  } finally {
    inFlight--;
  }
  return null;
}

function describe(game) {
  const variant = variantOf(game);
  const size = Math.sqrt(game.board.length);
  const pieces = game.board.flatMap((p,i) => p ?
    [square(i,size) + '=' + p.color + p.type + (p.moved ? '*' : '')] : []);
  const rules = variant === 'classic' ? 'Standard chess. Color 0 is White, color 1 is Black.' : [
    variant === 'brics-duel' ? 'Two players, color 0 (red, bottom) and color 1 (orange, top), alternate on a 10x10 board.' :
      'Four colors on a 10x10 board play in order 0, 1, 2, 3. Colors 0 and 2 are allies, 1 and 3 are allies.',
    'Capturing the opposing king wins; checks do not restrict moves. No legal moves means a draw.',
    'An unmoved king can swap with an unmoved non-pawn teammate on the same rank. Piece x jumps to the edge of a 7x7 square.',
    'Pawns may initially advance up to four squares and capture diagonally by one square. No en passant. Asterisk means the piece has moved.'
  ].join(' ');
  return [rules,'Current color: ' + game.turn,'Position: ' + (game.fen ?? pieces.join(' '))];
}

const notation = (game,move) => {
  const size = Math.sqrt(game.board.length);
  return move.san ?? square(move.from,size) + (move.castle ? '↔' : '-') + square(move.to,size) +
    (move.promotion ? '=' + move.promotion : '');
};

export async function chooseLLMMove(game) {
  const moves = legalMoves(game);
  if (!moves.length) return null;
  const content = game.history.length < 240 ? await chat([
    {role:'system',content:'Choose a strong chess move. Output only the integer index of one supplied legal move.'},
    {role:'user',content:[...describe(game),'Legal moves:',...moves.map((move,i) => i + ': ' + notation(game,move))].join('\n')}
  ],64,8000) : null;
  return (/^\d{1,3}$/.test(content ?? '') && moves[Number(content)]) || botMove(game,'medium');
}

export async function explainMove(position,move) {
  const game = {...newMatch(variantOf(position),10,0,0,position.fen),...position};
  const moved = game.board[move.from].type;
  const captured = move.castle ? null : game.board[move.to]?.type ?? (move.capture ? 'p' : null);
  const label = notation(game,move);
  if (!applyMove(game,move,0)) return null;
  const replies = legalMoves(game);
  return (await chat([
    {role:'system',content:'You are a chess tutor. Write 2–4 short sentences in Russian about the supplied legal move. Explain its concrete purpose and what to watch for. Use only the supplied position, rules and verified facts. Do not replace the move or claim a forced win without evidence. When the purpose is unclear, say so.'},
    {role:'user',content:[...describe(position),'Move to explain: ' + label,'Moved piece: ' + moved,
      'Captured piece: ' + (captured ?? 'none'), 'Result after move: ' + (game.result?.reason ?? 'ongoing'),
      'King threats after move, sides 0 and 1: ' + checks(game).join(', '),
      'Legal captures or check-giving replies (up to 20): ' + replies.filter(reply =>
        reply.capture || (game.fen ? /[+#]/.test(reply.san) : !reply.castle && game.board[reply.to]))
        .slice(0,20).map(reply => notation(game,reply)).join(', ')].join('\n')}
  ],384,30000))?.slice(0,1800) ?? null;
}
