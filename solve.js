import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {newMatch,square,variantOf} from './public/match.js';
import {readAnalysisPosition,searchBrics,solveBrics} from './public/search.js';
import {bricsVariants,recordOpenings} from './record-search.js';
import {recordArrangements} from './arrangements.js';

try {
  const {values,positionals} = parseArgs({allowPositionals:true,options:{
    exact:{type:'boolean'}, record:{type:'boolean'}, output:{type:'string',default:'data/search'},
    depth:{type:'string'}, nodes:{type:'string',default:'25000'},
    arrangements:{type:'boolean'}, variant:{type:'string'}, pieces:{type:'string'},
    positions:{type:'string'}, skip:{type:'string'}, kings:{type:'string'}
  }});
  if (positionals.length > 1) throw new Error('Укажите путь к одному JSON-файлу или "-" для stdin.');
  const depth = Number(values.depth ?? (values.arrangements ? 1 : values.record ? 4 : 3));
  const maxNodes = Number(values.nodes);
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 20 ||
      !Number.isSafeInteger(maxNodes) || maxNodes < 1) throw new Error('Глубина 1–20, лимит узлов — целое положительное число.');
  const [path] = positionals;
  if (values.arrangements) {
    if (path || values.record || values.exact) throw new Error('--arrangements запускается отдельной командой.');
    const variant = values.variant;
    const pieces = Number(values.pieces ?? 2);
    const limit = values.positions === undefined ? undefined : Number(values.positions);
    if (variant && !bricsVariants.includes(variant)) throw new Error('Укажите brics или brics-duel.');
    if (!Number.isInteger(pieces) || pieces < 2 || pieces > 40) throw new Error('Число фигур от 2 до 40.');
    if (pieces > 2 && limit === undefined) throw new Error('Для 3–40 фигур задайте размер партии позиций через --positions.');
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('Размер партии должен быть положительным целым числом.');
    if (values.skip !== undefined && !/^\d+$/.test(values.skip)) throw new Error('--skip ожидает неотрицательное целое число.');
    const skip = BigInt(values.skip ?? 0);
    let kingPair = null;
    if (values.kings !== undefined) {
      const cells = values.kings.split(',');
      if (cells.length !== 2 || cells[0] === cells[1] || cells.some(cell => !/^[a-j](?:[1-9]|10)$/.test(cell))) {
        throw new Error('Передайте разные клетки королей через запятую, например e1,e10.');
      }
      kingPair = cells.map(cell => (Number(cell.slice(1)) - 1) * 10 + cell.charCodeAt(0) - 97);
    }
    console.log(JSON.stringify(await recordArrangements({variant,pieces,limit,skip,kingPair,depth,output:values.output}),null,2));
  } else if (values.record) {
    if (path || values.exact) throw new Error('--record обходит стартовые позиции обоих вариантов.');
    console.log(JSON.stringify(await recordOpenings({depth,output:values.output}),null,2));
  } else {
    const game = path ? readAnalysisPosition(JSON.parse(readFileSync(path === '-' ? 0 : path,'utf8'))) :
      newMatch('brics-duel',10,0,0);
    const variant = variantOf(game);
    if (variant === 'classic') throw new Error('Для классики используйте Stockfish. Этот перебор рассчитан на БРИКС.');
    const result = values.exact ? solveBrics(game,{maxNodes}) : searchBrics(game,{depth,maxNodes});
    const move = result.move;
    const notation = move ? square(move.from) + (move.castle ? '↔' : '–') + square(move.to) +
      (move.promotion ? '=' + move.promotion : '') : null;
    console.log(JSON.stringify({variant,...result,notation},null,2));
    if (result.complete === false) process.exitCode = 2;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
