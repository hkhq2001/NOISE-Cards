const s = io();
const $ = id => document.getElementById(id);
let role = null;

function emit(event, data) { s.emit(event, data); }

function login(nextRole) {
  role = nextRole;
  const code = $('code').value.trim().toUpperCase();
  localStorage.setItem('noiseRole', nextRole);
  localStorage.setItem('noiseCode', code);
  authenticate(nextRole, code);
}

function authenticate(nextRole, code) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  emit(nextRole === 'admin' ? 'adminLogin' : nextRole === 'player' ? 'playerLogin' : 'watchLogin', normalizedCode);
}

s.on('connect', () => {
  const savedRole = localStorage.getItem('noiseRole');
  const savedCode = localStorage.getItem('noiseCode');
  if (savedRole && savedCode) {
    role = savedRole;
    authenticate(savedRole, savedCode);
  }
});

s.on('disconnect', () => {
  $('msg').textContent = 'انقطع الاتصال مؤقتًا — جارٍ إعادة الاتصال تلقائيًا';
});

function showGame() {
  $('login').hidden = true;
  $('game').hidden = false;
  $('admin').hidden = role !== 'admin';
  emit('requestState');
}

s.on('auth', data => {
  if (!data.ok) {
    localStorage.removeItem('noiseRole');
    localStorage.removeItem('noiseCode');
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
  if (ok) { role = 'player'; $('login').hidden = true; $('game').hidden = false; $('admin').hidden = true; emit('requestState'); }
  else $('msg').textContent = 'رمز لاعب غير صحيح';
});

s.on('watchAuth', ok => {
  if (ok) { role = 'watch'; $('login').hidden = true; $('game').hidden = false; $('admin').hidden = true; emit('requestState'); }
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
      (card.kind === 'bomb' ? '💣' : card.kind === 'bonus' ? '+' + card.value + ' 🎁' : String(card.value + 1)) : '?';
    const disabled = card.gone || card.up || game.status !== 'playing' || role !== 'player';
    return '<button type="button" class="card ' + (card.gone ? 'gone' : '') + (card.up ? ' revealed' : '') + '"' +
      ' data-card-id="' + card.id + '"' + (disabled ? ' disabled' : '') +
      ' aria-label="' + (card.gone ? 'بطاقة مستخدمة' : card.up ? 'بطاقة مكشوفة' : 'اكشف البطاقة') + '">' +
      '<span class="card-content">' + label + '</span></button>';
  }).join('');
  $('log').innerHTML = game.log.map(escapeHtml).join('<br>');
  if ($('presence')) {
    const people = game.presence.players.map(p =>
      '<div class="presence-person"><span>' + escapeHtml(p.name) + '</span><b class="' + (p.online ? 'online' : 'offline') + '">' + (p.online ? 'متصل' : 'خرج من الصفحة') + '</b></div>'
    ).join('');
    $('presence').innerHTML = '<div class="presence-person"><span>المشرف</span><b class="' +
      (game.presence.admin ? 'online' : 'offline') + '">' + (game.presence.admin ? 'متصل' : 'غير متصل') +
      '</b></div>' + people + '<small>المشاهدون المتصلون: ' + game.presence.watchers + '</small>';
  }
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

$('board').addEventListener('click', event => {
  const card = event.target.closest('button[data-card-id]');
  if (!card || card.disabled || role !== 'player') return;
  emit('flip', Number(card.dataset.cardId));
});
