import {sideOf} from './public/match.js';

export const ratingPool = (variant,minutes,increment) => {
  const seconds = minutes * 60 + 40 * increment;
  return variant + '/' + (seconds < 180 ? 'bullet' : seconds < 600 ? 'blitz' : seconds < 1800 ? 'rapid' : 'classical');
};

export function playerStats(rooms) {
  const stats = new Map();
  const get = (id,pool) => {
    if (!stats.has(id)) stats.set(id,{});
    return stats.get(id)[pool] ??= {rating:1500,rated:0,wins:0,draws:0,losses:0};
  };
  const finished = [...rooms.values()].filter(room => room.game?.result)
    .sort((a,b) => (a.finishedAt ?? a.game.since) - (b.finishedAt ?? b.game.since));
  for (const room of finished) {
    const pool = ratingPool(room.variant ?? 'brics',room.minutes,room.increment);
    const {winner} = room.game.result;
    const entries = room.seats.flatMap((seat,index) => seat?.user ? [{
      side:sideOf(room.game,index), stats:get(seat.user,pool)
    }] : []);
    for (const entry of entries) {
      entry.stats[winner === null ? 'draws' : winner === entry.side ? 'wins' : 'losses']++;
    }
    if (!room.rated || entries.length !== room.seats.length || room.game.history.length < 2) continue;
    const averages = [0,1].map(side => {
      const players = entries.filter(entry => entry.side === side);
      return players.reduce((sum,entry) => sum + entry.stats.rating,0) / players.length;
    });
    const expected = 1 / (1 + 10 ** ((averages[1] - averages[0]) / 400));
    const score = winner === null ? .5 : winner === 0 ? 1 : 0;
    const delta = Math.round(24 * (score - expected));
    for (const entry of entries) {
      entry.stats.rating += entry.side === 0 ? delta : -delta;
      entry.stats.rated++;
    }
  }
  return stats;
}

export function archive(rooms,user) {
  return [...rooms.values()].reverse().flatMap(room => {
    const color = room.seats.findIndex(seat => seat?.user === user);
    if (color < 0) return [];
    return [{
      id:room.id, variant:room.variant ?? 'brics', minutes:room.minutes, increment:room.increment,
      rated:!!room.rated, players:room.seats.map(seat => seat?.name ?? null),
      result:room.game?.result ?? null, started:!!room.game,
      score:room.game?.result ? (room.game.result.winner === null ? 'draw' : room.game.result.winner === sideOf(room.game,color) ? 'win' : 'loss') : null,
      date:room.finishedAt ?? room.createdAt ?? room.game?.since
    }];
  });
}
