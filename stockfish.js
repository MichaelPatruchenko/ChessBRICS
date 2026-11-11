import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {checks,legalMoves,square,variantOf} from './public/match.js';

const executable = process.env.CHESSBRICS_STOCKFISH_PATH;
export const stockfishEnabled = Boolean(executable);
let inFlight = 0;

export async function analyzeStockfish(game) {
  if (!stockfishEnabled || inFlight >= 2 || variantOf(game) !== 'classic') return null;
  const legal = legalMoves(game);
  if (!legal.length || checks(game)[1 - game.turn]) return null;
  const notation = move => square(move.from,8) + square(move.to,8) + (move.promotion ?? '');
  // Only send canonical FEN from the rules engine to the subprocess.
  if (!/^[prnbqkPRNBQK1-8/]+ [wb] (?:-|[KQkq]{1,4}) (?:-|[a-h][36]) \d+ \d+$/.test(game.fen)) return null;
  inFlight++;
  try {
    return await new Promise(resolve => {
      const engine = spawn(executable,[],{stdio:['pipe','pipe','ignore'],windowsHide:true});
      const lines = createInterface({input:engine.stdout});
      let evaluation = null;
      let phase = 'uci';
      let finished = false;
      function finish(result) {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        lines.close();
        engine.kill();
        resolve(result);
      }
      const timeout = setTimeout(() => finish(null),4000);
      engine.on('error',() => finish(null));
      engine.on('exit',() => finish(null));
      engine.stdin.on('error',() => finish(null));
      lines.on('line',line => {
        if (phase === 'uci' && line === 'uciok') {
          phase = 'ready';
          engine.stdin.write('setoption name Threads value 1\nsetoption name Hash value 16\nisready\n');
        } else if (phase === 'ready' && line === 'readyok') {
          phase = 'search';
          engine.stdin.write('position fen ' + game.fen + '\ngo movetime 700\n');
        } else if (phase === 'search') {
          const info = /^info depth (\d+).*?\bscore (cp|mate) (-?\d+)\b.*?\bpv ([a-h][1-8][a-h][1-8][qrbn]?)/.exec(line);
          if (info && !/\b(?:lowerbound|upperbound)\b/.test(line)) {
            evaluation = {depth:Number(info[1]),kind:info[2],value:Number(info[3]),first:info[4]};
          }
          const best = /^bestmove (\S+)/.exec(line);
          if (best) {
            const move = legal.find(candidate => notation(candidate) === best[1]);
            const score = evaluation?.first === best[1] ?
              {kind:evaluation.kind,value:evaluation.value,depth:evaluation.depth} : null;
            finish(move ? {move,score} : null);
          }
        }
      });
      engine.stdin.write('uci\n');
    });
  } finally {
    inFlight--;
  }
}
