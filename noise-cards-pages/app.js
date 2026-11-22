const s = io("https://noise-cards.onrender.com", {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000
});
const $ = id => document.getElementById(id);
let role = null;
let pendingLogin = null;

function emit(event, data) {
  if (!s.connected) {
    $('msg').textContent = 'جارٍ الاتصال بالسيرفر… انتظر لحظة ثم حاول مجددًا';
    return false;
  }
  s.emit(event, data);
  return true;
}

function login(nextRole) {
  const code = $('code').value.trim().toUpperCase();
  if (!code) {
    $('msg').textContent = 'أدخل رمز الدخول أولاً';
    return;
  }
  role = nextRole;
  localStorage.setItem('noiseRole', nextRole);
  localStorage.setItem('noiseCode', code);
  pendingLogin = { role: nextRole, code };
  $('msg').textContent = s.connected ? 'جارٍ التحقق من الرمز…' : 'جارٍ الاتصال بالسيرفر…';
  if (s.connected) sendPendingLogin();
}

function authenticate(nextRole, code) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  const event = nextRole === 'admin' ? 'adminLogin' : nextRole === 'player' ? 'playerLogin' : 'watchLogin';
  return emit(event, normalizedCode);
}

function sendPendingLogin() {
  if (!pendingLogin || !s.connected) return;
  const request = pendingLogin;
  pendingLogin = null;
  authenticate(request.role, request.code);
}

s.on('connect', () => {
  $('msg').textContent = 'تم الاتصال بالسيرفر — أدخل رمزك واضغط نوع الدخول';
  if (pendingLogin) {
    sendPendingLogin();
    return;
  }
  const savedRole = localStorage.getItem('noiseRole');
  const savedCode = localStorage.getItem('noiseCode');
  if (savedRole && savedCode) {
    role = savedRole;
    pendingLogin = { role: savedRole, code: savedCode };
    sendPendingLogin();
  }
});

s.on('connect_error', error => {
  $('msg').textContent = 'تعذر الاتصال بالسيرفر — جارٍ إعادة المحاولة. ' + (error && error.message ? error.message : '');
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
    pendingLogin = null;
    localStorage.removeItem('noiseRole');
    localStorage.removeItem('noiseCode');
    $('msg').textContent = 'رمز المشرف غير صحيح';
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
  else { pendingLogin = null; localStorage.removeItem('noiseRole'); localStorage.removeItem('noiseCode'); $('msg').textContent = 'رمز لاعب غير صحيح — استخدم الرمز الحالي الظاهر عند المشرف بعد آخر حفظ للإعدادات'; }
});

s.on('watchAuth', ok => {
  if (ok) { role = 'watch'; $('login').hidden = true; $('game').hidden = false; $('admin').hidden = true; emit('requestState'); }
  else { pendingLogin = null; $('msg').textContent = 'رمز مشاهدة غير صحيح'; }
});

s.on('configError', message => { $('msg').textContent = message; });

function config() {
  emit('configure', {
    teams: [
      { name: $('t1').value.trim() || 'الفريق الأول', players: [$('a1').value.trim(), $('a2').value.trim()] },
      { name: $('t2').value.trim() || 'الفريق الثاني', players: [$('b1').value.trim(), $('b2').value.trim()] }
    ],
    rounds: $('rounds').value,
    cards: $('cards').value,
    bombs: $('bombs').value,
    bonuses: $('bonuses').value
  });
}

s.on('state', game => {
  if ($('game').hidden) return;
  $('scores').innerHTML = game.teams.map((team, index) =>
    '<article class="team-score"><b>' + escapeHtml(team.name) + '</b><strong>' + team.score +
    '</strong><small>' + team.players.map(escapeHtml).join(' • ') + '</small><em>نقاط الفريق ' + (index + 1) + '</em></article>'
  ).join('');

  const suffix = game.status === 'roundEnd' ? ' — انتهت الجولة' :
    game.status === 'finished' ? ' — انتهت المواجهة' : '';
  $('turn').textContent = 'الجولة ' + game.round + '/' + game.rounds +
    ' — الدور: ' + game.turn + suffix;
  $('log').hidden = role !== 'admin';
  const boardTitle = $('board-title');
  if (boardTitle) boardTitle.textContent = role === 'admin' ? 'طاولة الكروت — مشاهدة مباشرة' : 'طاولة اللعب';
  const adminView = $('admin-view-note');
  if (adminView) adminView.hidden = role !== 'admin';
  if (window.noiseTurnClock) clearInterval(window.noiseTurnClock);
  const updateClock = () => {
    const seconds = game.turnEndsAt ? Math.max(0, Math.ceil((game.turnEndsAt - Date.now()) / 1000)) : 0;
    $('turn').textContent = 'الجولة ' + game.round + '/' + game.rounds +
      ' — الدور: ' + game.turn + (game.status === 'playing' ? ' — الوقت المتبقي: ' + seconds + ' ثانية' : suffix);
  };
  updateClock();
  if (game.status === 'playing' && game.turnEndsAt) {
    window.noiseTurnClock = setInterval(updateClock, 250);
  }

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