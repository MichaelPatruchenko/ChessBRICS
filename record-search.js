import {createWriteStream} from 'node:fs';
import {mkdir,mkdtemp,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {advancePosition,allMoves} from './public/engine.js';
import {newMatch,variantOf} from './public/match.js';
import {evaluateBrics,positionKey,relativeBricsScore} from './public/search.js';

export const bricsVariants = ['brics','brics-duel'];
const bookFile = new URL('./public/brics-opening-book.js',import.meta.url);

export async function writeBook(file,book) {
  const temporary = new URL(file.href + '.' + process.pid + '.tmp');
  await writeFile(temporary,'export default ' + JSON.stringify(book) + ';\n');
  await rename(temporary,file);
}

export async function newRun(output,prefix) {
  await mkdir(output,{recursive:true});
  return mkdtemp(join(output,prefix + '-'));
}

export async function gzipJournal(file,rows) {
  function* chunks() {
    let buffer = '';
    for (const row of rows) {
      buffer += row;
      if (buffer.length >= 65536) {
        yield buffer;
        buffer = '';
      }
    }
    if (buffer) yield buffer;
  }
  await pipeline(chunks(),createGzip({level:3}),createWriteStream(file,{flags:'wx'}));
}

export function* recordTree(position,depth,counts,book,{json = false} = {}) {
  let nextId = 0;
  function* visit(current,ply,parentId,move) {
    const id = nextId++;
    const moves = ply < depth ? allMoves(current) : [];
    let score, bestMove;
    if (!moves.length) score = evaluateBrics(current,ply);
    else {
      score = -Infinity;
      for (const candidate of moves) {
        const value = -(yield* visit(advancePosition(current,candidate),ply + 1,id,candidate));
        if (value > score) {
          score = value;
          bestMove = candidate;
        }
      }
    }
    if (book && bestMove && (ply === 0 || (ply <= 2 && depth - ply >= 2))) {
      const key = positionKey(current);
      if (!book[key] || book[key][4] < depth - ply) {
        book[key] = [bestMove.from,bestMove.to,bestMove.promotion ?? null,
          relativeBricsScore(score,ply,depth),depth - ply];
      }
    }
    if (move) {
      counts[ply - 1]++;
      const row = [id,parentId,ply,move.from,move.to,move.promotion ?? '',Number(Boolean(move.castle)),-score];
      yield (json ? JSON.stringify(row) : row.join('\t')) + '\n';
    }
    return score;
  }
  yield* visit(position,0,-1,null);
}

export const treeColumns = ['id','parent','ply','from','to','promotion','castle','score'];

export async function recordOpenings({depth,output}) {
  const directory = await newRun(output,'openings');
  const book = {};
  const report = {};
  for (const variant of bricsVariants) {
    const position = newMatch(variant,10,0,0);
    const counts = Array(depth).fill(0);
    book[variant] = {};
    const file = variant + '.tsv.gz';
    function* rows() {
      yield JSON.stringify({variant:variantOf(position),board:position.board,turn:position.turn,depth,columns:treeColumns}) + '\n';
      yield* recordTree(position,depth,counts,book[variant]);
    }
    await gzipJournal(join(directory,file),rows());
    report[variant] = {file,depth,movesByPly:counts,moves:counts.reduce((sum,count) => sum + count,0),
      bookPositions:Object.keys(book[variant]).length,best:book[variant][positionKey(position)]};
    console.error(variant + ' · ' + report[variant].moves + ' переходов записано');
  }
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2) + '\n');
  await writeBook(bookFile,book);
  return {directory,report};
}
