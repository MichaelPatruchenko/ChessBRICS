import {botMove} from './bot.js';
import {searchBrics} from './search.js';
self.onmessage = event => {
  const {game,level,analyze} = event.data;
  if (analyze) self.postMessage(game.variant === 'classic' ? {move:botMove(game,'hard')} : searchBrics(game));
  else self.postMessage(botMove(game,level));
};
