import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {advancePosition,allMoves,team} from './public/engine.js';
import {newMatch,variants} from './public/match.js';
import {endgameKey,positionKey,solveBricsPositions} from './public/search.js';
import {bricsVariants,gzipJournal,newRun,recordTree,treeColumns,writeBook} from './record-search.js';

const tableFile = new URL('./public/brics-endgames.js',import.meta.url);

export function* arrangements(variant,pieceCount,kingPair = null) {
  const start = newMatch(variant,10,0,0);
  const kings = [0,1].map(side => start.board.findIndex(piece => piece?.type === 'k' && team(piece.color) === side));
  const colors = variants[variant].colors.map((_,color) => color);
  const capacity = colors.map(color => start.board.filter(piece => piece?.color === color).length);
  const pawnCapacity = colors.map(color => start.board.filter(piece => piece?.color === color && piece.type === 'p').length);
  const board = Array(100).fill(null);
  const count = colors.map(color => Number(kings.some(i => start.board[i].color === color)));
  const pawns = colors.map(() => 0);
  const choices = board.map((_,cell) => colors.flatMap(color => {
    const rank = Math.floor(cell / 10);
    const types = (team(color) === 0 ? rank >= 2 && rank <= 8 : rank >= 1 && rank <= 7) ? 'prnbqx' : 'rnbqx';
    const pieces = [...types].map(type => ({color,type,moved:true}));
    const initial = start.board[cell];
    if (initial?.color === color && initial.type !== 'k') pieces.push(initial);
    return pieces;
  }));
  function* place(from,left) {
    if (!left) {
      for (const turn of colors) yield {variant,board:board.slice(),turn,result:null};
      return;
    }
    for (let i = from; i <= 100 - left; i++) {
      if (board[i]) continue;
      for (const piece of choices[i]) {
        const {color,type} = piece;
        const isPawn = type === 'p';
        if (count[color] === capacity[color] || (isPawn && pawns[color] === pawnCapacity[color])) continue;
        board[i] = piece;
        count[color]++;
        if (isPawn) pawns[color]++;
        yield* place(i + 1,left - 1);
        if (isPawn) pawns[color]--;
        count[color]--;
        board[i] = null;
      }
    }
  }
  const pairs = kingPair ? [kingPair] : Array.from({length:9900},(_,i) => {
    const a = Math.floor(i / 99), b = i % 99;
    return [a,b + Number(b >= a)];
  });
  for (const [a,b] of pairs) {
    for (const firstMoved of a === kings[0] ? [false,true] : [true]) {
      board[a] = {...start.board[kings[0]],moved:firstMoved};
      for (const secondMoved of b === kings[1] ? [false,true] : [true]) {
        board[b] = {...start.board[kings[1]],moved:secondMoved};
        yield* place(0,pieceCount - 2);
        board[b] = null;
      }
      board[a] = null;
    }
  }
}

export async function recordArrangements({variant,pieces,limit,skip,kingPair,depth,output}) {
  const exact = pieces === 2 && !kingPair && !skip && limit === undefined;
  const directory = await newRun(output,exact ? 'two-kings' : 'arrangements');
  const table = {};
  const report = {};
  for (const name of variant ? [variant] : bricsVariants) {
    const positions = arrangements(name,pieces,kingPair);
    const file = name + '.jsonl.gz';
    let count = 0, moves = 0, exhausted = true;
    const outcomes = {win:0,draw:0,loss:0};
    let solved, roots, ids;
    if (exact) {
      roots = [...positions];
      solved = solveBricsPositions(roots,{maxNodes:roots.length + 1000});
      if (!solved.complete) throw new Error('Не удалось построить полный граф двух королей.');
      ids = new Map(roots.map((position,id) => [positionKey(position),id]));
      table[name] = {};
    }
    function* rows() {
      yield JSON.stringify({variant:name,pieces,kingPair,skip:String(skip),exact,depth:exact ? null : depth,
        treeColumns:exact ? null : treeColumns}) + '\n';
      if (exact) {
        for (const [id,position] of roots.entries()) {
          const result = solved.results[id];
          outcomes[result.outcome]++;
          if (result.move) table[name][endgameKey(position)] = result.move.to;
          const edges = allMoves(position).map(move => {
            const next = advancePosition(position,move);
            const target = ids.get(positionKey(next));
            if (target === undefined && !next.result) throw new Error('Позиция за пределами таблицы.');
            return {...move,next:target ?? null};
          });
          count++;
          moves += edges.length;
          yield JSON.stringify({id,...position,...result,edges}) + '\n';
        }
        return;
      }
      let ordinal = 0n;
      for (const position of positions) {
        if (ordinal++ < skip) continue;
        if (count === limit) {
          exhausted = false;
          break;
        }
        count++;
        yield JSON.stringify({id:String(ordinal - 1n),...position}) + '\n';
        const counts = Array(depth).fill(0);
        const best = {};
        yield* recordTree(position,depth,counts,best,{json:true});
        moves += counts.reduce((sum,value) => sum + value,0);
        yield JSON.stringify({best:best[positionKey(position)] ?? null,movesByPly:counts}) + '\n';
      }
    }
    await gzipJournal(join(directory,file),rows());
    report[name] = {file,pieces,positions:count,moves,exact,exhausted,nextSkip:exhausted ? null : String(skip + BigInt(count)),
      ...(exact ? {outcomes,bookPositions:Object.keys(table[name]).length} : {depth})};
    console.error(name + ' · ' + count + ' позиций, ' + moves + ' переходов записано');
  }
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2) + '\n');
  if (exact && !variant) await writeBook(tableFile,table);
  return {directory,report};
}
