import {randomBytes} from 'node:crypto';

const reject = (status,message) => { throw Object.assign(new Error(message),{status}); };
const member = ({id,name}) => ({id,name});
export function tournamentService(entries,rooms,makeGame,save) {
  const tournaments = new Map(entries);
  function addRound(tournament,players,now) {
    const pairings = [];
    for (let i = 0; i < players.length; i += 2) {
      const pair = [players[i],players[i+1]];
      pairings.push({players:pair, games:[makeGame(tournament,pair,now)],winner:null});
    }
    tournament.rounds.push(pairings);
  }
  function advance(tournament,now) {
    if (!tournament.rounds.length || tournament.winner) return false;
    const round = tournament.rounds.at(-1);
    let changed = false;
    for (const pairing of round) {
      if (pairing.winner) continue;
      const game = rooms.get(pairing.games.at(-1));
      if (!game?.game.result) continue;
      const winner = game.game.result.winner;
      if (winner === null && pairing.games.length < 3) {
        const order = game.seats.map(seat => pairing.players.find(player => player.id === seat.user));
        pairing.games.push(makeGame(tournament,order.reverse(),now));
      } else {
        pairing.winner = pairing.players.find(player => player.id === game.seats[winner ?? 1].user);
      }
      changed = true;
    }
    if (round.every(pairing => pairing.winner)) {
      if (round.length === 1) tournament.winner = round[0].winner;
      else addRound(tournament,round.map(pairing => pairing.winner),now);
      changed = true;
    }
    return changed;
  }
  const view = (entry,user) => ({
    id:entry.id,title:entry.title,capacity:entry.capacity,minutes:entry.minutes,increment:entry.increment,
    participants:entry.players.map(player => player.name), joined:entry.players.some(player => player.id === user?.id),
    winner:entry.winner?.name ?? null,
    rounds:entry.rounds.map(round => round.map(pair => ({
      players:pair.players.map(player => player.name),winner:pair.winner?.name ?? null,
      games:pair.games.map(id => ({id,result:rooms.get(id)?.game.result ?? null}))
    })))
  });
  return {
    data:() => [...tournaments],
    list(user) { return [...tournaments.values()].reverse().map(entry => view(entry,user)); },
    create(input,user,now) {
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      if (!title || title.length > 60 || ![4,8].includes(input.capacity)) reject(400,'Укажите название и число участников: 4 или 8.');
      if (tournaments.size >= 50) reject(503,'Достигнут лимит турниров.');
      if ([...tournaments.values()].some(t => t.owner === user.id && !t.winner)) reject(409,'У вас уже есть незавершённый турнир.');
      const entry = {id:randomBytes(9).toString('base64url'),title,capacity:input.capacity,
        minutes:input.minutes,increment:input.increment,owner:user.id,players:[member(user)],rounds:[],winner:null,createdAt:now};
      tournaments.set(entry.id,entry);
      save();
      return view(entry,user);
    },
    join(id,user,now) {
      const entry = tournaments.get(id);
      if (!entry) reject(404,'Турнир не найден.');
      if (entry.players.some(player => player.id === user.id)) return view(entry,user);
      if (entry.rounds.length) reject(409,'Турнир уже начался.');
      entry.players.push(member(user));
      if (entry.players.length === entry.capacity) addRound(entry,entry.players,now);
      save();
      return view(entry,user);
    },
    finish(room,now) {
      if (!room.tournament || !room.game?.result) return;
      const entry = tournaments.get(room.tournament);
      if (entry) advance(entry,now);
    }
  };
}
