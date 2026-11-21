const s = io();
const $ = id => document.getElementById(id);
let role = null;

function emit(event, data) { s.emit(event, data); }

function login(nextRole) {
  role = nextRole;
  emit(nextRole === 'admin' ? 'adminLogin' : nextRole === 'player' ? 'playerLogin' : 'watchLogin', $('code').value.trim());
}

function showGame() {
  $('login').hidden = true;
  $('game').hidden = false;
  $('admin').hidden = role !== 'admin';
  emit('requestState');
}

s.on('auth', data => {
  if (!data.ok) {
    $('msg').textContent = 'رمز غير صحيح';
    return;
  }
  role = 'admin';
  $('login').hidden = true;
  $('admin').hidden = false;
  $('game').hidden = false;
  $('codes').innerHTML = 'رمز المشرف: ' + escapeHtml(data.admin) +
    '<br>رمز المشاهدة: ' + escapeHtml(data.watch) + '<br>' +
    Object.entries(data.codes).map(([code, player]) =>
      'لاعب ' + (player.team + 1) + '-' + (player.player + 1) + ': ' + escapeHtml(code)
    ).join('<br>');
  emit('requestState');
});

s.on('playerAuth', ok => {
  if (ok) { role = 'player'; showGame(); }
  else $('msg').textContent = 'رمز لاعب غير صحيح';
});

s.on('watchAuth', ok => {
  if (ok) { role = 'watch'; showGame(); }
  else $('msg').textContent = 'رمز مشاهدة غير صحيح';
});

s.on('configError', message => { $('msg').textContent = message; });

function config() {
  emit('configure', {
    teams: [
      { name: $('t1').value.trim() || 'الفريق الأول', players: [$('a1').value.trim(), $('a2').value.trim()] },
      { name: $('t2').value.trim() || 'الفريق الثاني', players: [$('b1').value.trim(), $('b2').value.trim()] }
    ],
    rounds: $('rounds').value,
    pairs: $('pairs').value,
    bombs: $('bombs').value,
    bonuses: $('bonuses').value
  });
}

s.on('state', game => {
  if ($('game').hidden) return;
  $('scores').innerHTML = game.teams.map(team =>
    '<article><b>' + escapeHtml(team.name) + '</b><strong>' + team.score +
    '</strong><small>' + team.players.map(escapeHtml).join(' • ') + '</small></article>'
  ).join('');

  const suffix = game.status === 'roundEnd' ? ' — انتهت الجولة' :
    game.status === 'finished' ? ' — انتهت المواجهة' : '';
  $('turn').textContent = 'الجولة ' + game.round + '/' + game.rounds +
    ' — الدور: ' + game.turn + suffix;

  $('board').innerHTML = game.board.map(card => {
    const label = card.gone ? '' : card.up ?
      (card.kind === 'bomb' ? '💣' : card.kind === 'bonus' ? '+' + card.value + ' 🎁' : '✦') : '?';
    const disabled = card.gone || card.up || game.status !== 'playing' || role !== 'player';
    return '<button class="card ' + (card.gone ? 'gone' : '') + '"' +
      (disabled ? ' disabled' : '') + ' onclick="flip(' + card.id + ')">' + label + '</button>';
  }).join('');
  $('log').innerHTML = game.log.map(escapeHtml).join('<br>');
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function flip(id) {
  if (role === 'player') emit('flip', id);
}
