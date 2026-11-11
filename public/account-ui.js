const $ = id => document.getElementById(id);
const gameNames = {brics:'БРИКС 2×2','brics-duel':'БРИКС 1×1',classic:'Классика'};
const speeds = {bullet:'Пуля',blitz:'Блиц',rapid:'Рапид',classical:'Длинные партии'};
const poolName = value => {
  const [game,speed] = value.split('/');
  return gameNames[game] + ' · ' + speeds[speed];
};
async function request(path,input) {
  const response = await fetch('/api/' + path,{
    method:input ? 'POST' : 'GET', signal:AbortSignal.timeout(8000),
    headers:input ? {'Content-Type':'application/json'} : undefined,
    body:input ? JSON.stringify(input) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error);
  return payload;
}

function item(text,href) {
  const li = document.createElement('li');
  if (href) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = text;
    li.append(link);
  } else li.textContent = text;
  return li;
}

export function initAccounts({quickOptions,onQuick}) {
  let user = null;
  let pools = {};
  let accountBusy = false;
  function showAccount(account) {
    user = account.user;
    $('accountLabel').textContent = user ? 'Профиль' : 'Аккаунт';
    $('accountOpen').setAttribute('aria-label',user ? 'Профиль' : 'Аккаунт');
    $('credentials').hidden = !!user;
    $('accountProfile').hidden = !user;
    if (!user) return;
    $('profileLogin').textContent = '@' + user.login;
    $('profileName').value = user.name;
    $('profileBio').value = user.bio;
    $('profileVisible').checked = user.visible;
    $('profileStats').replaceChildren(...Object.entries(account.stats ?? {}).map(([pool,row]) =>
      item(poolName(pool) + ' · ' + (row.rated ? row.rating + ' Elo · ' : '') +
        [row.wins,row.draws,row.losses].join('/') + ' В/Н/П')));
    $('profileHistory').replaceChildren(...(account.history ?? []).map(row => item(
      gameNames[row.variant] + ' · ' + row.minutes + '+' + row.increment + ' · ' +
      ({win:'победа',draw:'ничья',loss:'поражение'}[row.score] ?? (row.started ? 'идёт партия' : 'ожидание')) +
      (row.date ? ' · ' + new Date(row.date).toLocaleDateString('ru-RU') : ''), '?room=' + row.id)));
  }
  async function refreshAccount() { showAccount(await request('account')); }
  async function action(fn) {
    if (accountBusy) return;
    accountBusy = true;
    $('accountNotice').textContent = '';
    try { await fn(); }
    catch (error) { $('accountNotice').textContent = error.message; }
    finally { accountBusy = false; }
  }
  function openAccount() {
    if (!$('accountDialog').open) $('accountDialog').showModal();
    action(refreshAccount);
  }
  refreshAccount().catch(() => {});
  $('accountOpen').onclick = openAccount;
  $('accountMode').onchange = () => {
    const mode = $('accountMode').value;
    $('recoveryField').hidden = mode !== 'recover';
    $('recoveryCode').required = mode === 'recover';
    $('accountPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  };
  $('credentials').onsubmit = event => {
    event.preventDefault();
    action(async () => {
      const mode = $('accountMode').value;
      const response = await request('account/' + mode,{
        login:$('accountLogin').value,password:$('accountPassword').value,code:$('recoveryCode').value
      });
      $('accountPassword').value = $('recoveryCode').value = '';
      showAccount(response);
      $('recoveryResult').hidden = !response.recovery;
      $('issuedCode').value = response.recovery ?? '';
      if (response.recovery) {
        $('issuedCode').focus();
        $('issuedCode').select();
      }
      await refreshAccount();
    });
  };
  $('profileForm').onsubmit = event => {
    event.preventDefault();
    action(async () => {
      await request('account/profile',{name:$('profileName').value,bio:$('profileBio').value,visible:$('profileVisible').checked});
      await refreshAccount();
      $('accountNotice').textContent = 'Профиль сохранён';
    });
  };
  $('logout').onclick = () => action(async () => {
    await request('account/logout',{});
    $('recoveryResult').hidden = true;
    $('issuedCode').value = '';
    await refreshAccount();
  });
  $('quick').onclick = () => action(async () => {
    if (!user) {
      openAccount();
      $('accountNotice').textContent = 'Войдите, чтобы искать рейтинговую партию.';
      return;
    }
    try { onQuick(await request('quick',quickOptions())); }
    catch (error) { openAccount(); $('accountNotice').textContent = error.message; }
  });

  function showPool() {
    const rows = pools[$('ratingPool').value] ?? [];
    $('communityList').replaceChildren(...rows.map(row => {
      const entry = item('');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quiet';
      button.textContent = row.name + ' · ' + row.rating + ' Elo';
      button.onclick = async () => {
        try {
          const profile = await request('players/' + row.login);
          $('communityStatus').textContent = profile.name + ' (@' + profile.login + ')' + (profile.bio ? ' · ' + profile.bio : '');
        } catch (error) { $('communityStatus').textContent = error.message; }
      };
      entry.append(button);
      return entry;
    }));
  }
  $('ratingPool').onchange = showPool;
  async function community(ranking) {
    $('communityTitle').textContent = ranking ? 'Таблица рейтингов' : 'Партии в эфире';
    $('ratingPoolLabel').hidden = true;
    $('communityList').replaceChildren();
    $('communityStatus').textContent = 'Загрузка…';
    $('communityDialog').showModal();
    try {
      const payload = await request(ranking ? 'leaderboard' : 'live');
      if (ranking) {
        pools = payload.pools;
        const options = Object.keys(pools).map(pool => new Option(poolName(pool),pool));
        $('ratingPool').replaceChildren(...options);
        $('ratingPoolLabel').hidden = !options.length;
        $('communityStatus').textContent = options.length ? '' : 'Пока нет публичных рейтингов.';
        showPool();
      } else {
        $('communityList').replaceChildren(...payload.rooms.map(room =>
          item(gameNames[room.variant] + ' · ' + room.minutes + '+' + room.increment,'?room=' + room.id)));
        $('communityStatus').textContent = payload.rooms.length ? '' : 'Пока нет открытых партий.';
      }
    } catch (error) { $('communityStatus').textContent = error.message; }
  }
  $('leadersOpen').onclick = () => community(true);
  $('liveOpen').onclick = () => community(false);
  async function tournamentAction(fn) {
    $('tournamentNotice').textContent = '';
    try { await fn(); }
    catch (error) { $('tournamentNotice').textContent = error.message; }
  }
  async function loadTournaments() {
    const {tournaments} = await request('tournaments');
    $('tournamentList').replaceChildren(...tournaments.map(tournament => {
      const card = document.createElement('article');
      card.className = 'panel';
      const heading = document.createElement('h3');
      heading.textContent = tournament.title;
      const caption = document.createElement('p');
      caption.textContent = tournament.participants.join(', ') + ' · ' + tournament.participants.length + '/' + tournament.capacity +
        ' · ' + tournament.minutes + '+' + tournament.increment;
      card.append(heading,caption);
      if (!tournament.rounds.length && !tournament.joined) {
        const join = document.createElement('button');
        join.textContent = 'Участвовать';
        join.onclick = () => tournamentAction(async () => {
          join.disabled = true;
          try {
            await request('tournaments/' + tournament.id + '/join',{});
            await loadTournaments();
          } finally { join.disabled = false; }
        });
        card.append(join);
      }
      if (tournament.winner) {
        const winner = document.createElement('p');
        winner.textContent = 'Победитель · ' + tournament.winner;
        card.append(winner);
      }
      tournament.rounds.forEach((round,i) => {
        const title = document.createElement('h4');
        title.textContent = round.length === 1 ? 'Финал' : 'Раунд ' + (i+1);
        const list = document.createElement('ul');
        list.append(...round.flatMap(pair => pair.games.map((game,n) => item(
          pair.players.join(' — ') + (n ? ' · переигровка ' + n : '') +
          (game.result ? ' · ' + game.result.reason : ' · идёт партия') +
          (pair.winner && n === pair.games.length-1 ? ' · ' + pair.winner : ''),'?room=' + game.id))));
        card.append(title,list);
      });
      return card;
    }));
  }
  $('tournamentsOpen').onclick = () => {
    const {minutes,increment} = quickOptions();
    $('tournamentTime').textContent = 'Контроль из игрового зала · ' + minutes + '+' + increment;
    $('tournamentDialog').showModal();
    tournamentAction(loadTournaments);
  };
  $('tournamentRefresh').onclick = () => tournamentAction(loadTournaments);
  $('tournamentForm').onsubmit = event => {
    event.preventDefault();
    tournamentAction(async () => {
      event.submitter.disabled = true;
      try {
        await request('tournaments',{...quickOptions(),title:$('tournamentName').value,capacity:Number($('tournamentSize').value)});
        $('tournamentName').value = '';
        await loadTournaments();
      } finally { event.submitter.disabled = false; }
    });
  };

}
