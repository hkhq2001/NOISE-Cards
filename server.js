const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { connectionStateRecovery: { maxDisconnectionDuration: 7200000, skipMiddlewares: true } });
app.use(express.static(__dirname));

const makeCode = () => crypto.randomBytes(4).toString("hex").toUpperCase();
let game;
let turnTimer = null;

function resetGame() {
  game = {
    admin: "NOISE2026", watch: makeCode(), codes: {},
    teams: [
      { name: "الفريق الأول", players: [], score: 0 },
      { name: "الفريق الثاني", players: [], score: 0 }
    ],
    rounds: 1, round: 1, pairs: 8, bombs: 1, bonuses: 2,
    board: [], team: 0, player: 0, turnIndex: 0,
    status: "lobby", log: [], revealed: [], busy: false,
    online: { admin: new Set(), players: [new Set(), new Set(), new Set(), new Set()], watchers: new Set() }
  };
}

function stopTurnTimer() {
  if (turnTimer) clearTimeout(turnTimer);
  turnTimer = null;
  if (game) game.turnEndsAt = null;
}

function startTurnTimer() {
  stopTurnTimer();
  if (game.status !== "playing") return;
  game.turnEndsAt = Date.now() + 30000;
  turnTimer = setTimeout(() => {
    turnTimer = null;
    if (game.status === "playing" && !game.busy) advanceTurn();
  }, 30000);
}

function getState() {
  return {
    status: game.status,
    teams: game.teams.map(team => ({
      name: team.name, players: team.players.map(p => p.name), score: team.score
    })),
    round: game.round, rounds: game.rounds,
    board: game.board.map(card => ({
      id: card.id, up: card.up, gone: card.gone,
      value: card.up ? card.value : null,
      kind: card.up ? card.kind : null
    })),
    team: game.team, player: game.player,
    turn: game.teams[game.team]?.players[game.player]?.name || "",\n    turnEndsAt: game.turnEndsAt || null,
    log: game.log.slice(-25),
    presence: {
      admin: game.online.admin.size > 0,
      players: game.teams.flatMap((team, ti) => team.players.map((p, pi) => ({ name: p.name, team: ti, player: pi, online: game.online.players[ti * 2 + pi].size > 0 }))),
      watchers: game.online.watchers.size
    }
  };
}

function sendState() {
  const state = getState();
  for (const socket of io.sockets.sockets.values()) {
    if (["admin", "player", "watch"].includes(socket.data.role)) socket.emit("state", state);
  }
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function createBoard() {
  const cards = [];
  for (let i = 0; i < game.pairs; i++) {
    cards.push({ kind: "match", value: i }, { kind: "match", value: i });
  }
  for (let i = 0; i < game.bombs; i++) cards.push({ kind: "bomb", value: "💣" });
  for (let i = 0; i < game.bonuses; i++) {
    cards.push({ kind: "bonus", value: [5, 10, 15][Math.floor(Math.random() * 3)] });
  }
  game.board = shuffle(cards).map((card, id) => ({ ...card, id, up: false, gone: false }));
  game.revealed = [];
  game.busy = false;
}

function advanceTurn() {
  game.turnIndex = (game.turnIndex + 1) % 4;
  game.team = Math.floor(game.turnIndex / 2);
  game.player = game.turnIndex % 2;
  game.revealed = [];
  game.busy = false;
  sendState();
}

function checkRoundEnd() {
  if (game.board.every(card => card.gone)) {
    game.status = game.round >= game.rounds ? "finished" : "roundEnd";
    game.log.push(game.status === "finished" ? "انتهت المواجهة" : "انتهت الجولة");
  }
}

function isAdmin(socket) { return socket.data.role === "admin"; }

function leavePresence(socket) {
  const key = socket.data.presenceKey;
  if (!key) return;
  const set = key === "admin" ? game.online.admin : key === "watch" ? game.online.watchers : game.online.players[Number(key)];
  if (set) set.delete(socket.id);
  socket.data.presenceKey = null;
  sendState();
}

function joinPresence(socket, key) {
  leavePresence(socket);
  const set = key === "admin" ? game.online.admin : key === "watch" ? game.online.watchers : game.online.players[Number(key)];
  if (set) set.add(socket.id);
  socket.data.presenceKey = key;
  sendState();
}

io.on("connection", socket => {
  socket.on("adminLogin", code => {
    if (code !== game.admin) return socket.emit("auth", { ok: false });
    socket.data.role = "admin";
    joinPresence(socket, "admin");
    socket.emit("auth", { ok: true, admin: game.admin, watch: game.watch, codes: game.codes });
  });

  socket.on("watchLogin", code => {
    const ok = code === game.watch;
    if (ok) { socket.data.role = "watch"; joinPresence(socket, "watch"); }
    socket.emit("watchAuth", ok);
    if (ok) socket.emit("state", getState());
  });

  socket.on("playerLogin", code => {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const player = game.codes[normalizedCode];
    if (!player) return socket.emit("playerAuth", false);
    socket.data.role = "player";
    socket.data.player = player;
    joinPresence(socket, String(player.team * 2 + player.player));
    socket.emit("playerAuth", true);
    socket.emit("state", getState());
  });

  socket.on("requestState", () => {
    if (["admin", "player", "watch"].includes(socket.data.role)) socket.emit("state", getState());
  });

  socket.on("configure", data => {
    if (!isAdmin(socket)) return;
    const teams = Array.isArray(data?.teams) ? data.teams : [];
    if (teams.length !== 2 || teams.some(t => !Array.isArray(t.players) || t.players.length !== 2 || t.players.some(n => !String(n).trim()))) {
      return socket.emit("configError", "أدخل اسماء اللاعبين الأربعة قبل حفظ الإعدادات");
    }

    game.teams = teams.map(team => ({
      name: String(team.name || "").trim() || "فريق",
      players: team.players.map(name => ({ name: String(name).trim() })),
      score: 0
    }));
    game.rounds = Math.max(1, Math.min(50, Number(data.rounds) || 1));
    game.pairs = Math.max(1, Math.min(40, Number(data.pairs) || 8));
    game.bombs = Math.max(0, Math.min(20, Number(data.bombs) || 0));
    game.bonuses = Math.max(0, Math.min(20, Number(data.bonuses) || 0));
    game.codes = {};
    game.teams.forEach((team, teamIndex) => team.players.forEach((player, playerIndex) => {
      let code;
      do { code = makeCode(); } while (game.codes[code]);
      game.codes[code] = { team: teamIndex, player: playerIndex };
    }));
    game.status = "lobby";
    game.round = 1;
    game.board = [];
    game.log = [];
    game.teams.forEach(team => team.score = 0);
    socket.emit("auth", { ok: true, admin: game.admin, watch: game.watch, codes: game.codes });
    sendState();
  });

  socket.on("start", () => {
    if (!isAdmin(socket) || game.teams.some(t => t.players.length !== 2)) return;
    game.status = "playing";
    game.round = 1;
    game.teams.forEach(team => team.score = 0);
    game.turnIndex = 0;
    game.team = 0;
    game.player = 0;
    game.log = [];
    createBoard();
    sendState();
  });

  socket.on("flip", id => {
    const player = socket.data.player;
    if (socket.data.role !== "player" || !player || game.status !== "playing" ||
        game.busy || player.team !== game.team || player.player !== game.player) return;

    const card = game.board.find(item => item.id === Number(id));
    if (!card || card.up || card.gone || game.revealed.length >= 2) return;

    card.up = true;
    game.revealed.push(card.id);

    if (card.kind === "bomb" || card.kind === "bonus") {
      game.busy = true;
      sendState();
      setTimeout(() => {
        if (card.kind === "bomb") {
          game.teams[game.team].score = 0;
          game.log.push("قنبلة! تم تصفير نقاط " + game.teams[game.team].name);
        } else {
          game.teams[game.team].score += card.value;
          game.log.push("بطاقة مكافأة: +" + card.value);
        }
        card.gone = true;
        card.up = false;
        for (const revealedId of game.revealed) {
          const revealedCard = game.board.find(item => item.id === revealedId);
          if (revealedCard && !revealedCard.gone) revealedCard.up = false;
        }
        game.revealed = [];
        game.busy = false;
        checkRoundEnd();
        if (card.kind === "bomb" && game.status === "playing") advanceTurn();
        else sendState();
      }, 900);
      return;
    }

    if (game.revealed.length === 2) {
      const [first, second] = game.revealed.map(cardId => game.board.find(item => item.id === cardId));
      if (first.value === second.value) {
        first.gone = second.gone = true;
        first.up = second.up = false;
        game.teams[game.team].score += 1;
        game.log.push("تطابق صحيح! +1 نقطة");
        game.revealed = [];
        checkRoundEnd();
        sendState();
      } else {
        game.busy = true;
        sendState();
        setTimeout(() => {
          first.up = false;
          second.up = false;
          game.log.push("لم يحدث تطابق");
          advanceTurn();
        }, 1000);
      }
    } else {
      sendState();
    }
  });

  socket.on("next", () => {
    if (!isAdmin(socket)) return;
    if (game.status !== "roundEnd") {
      if (game.status === "finished") sendState();
      return;
    }
    game.round += 1;
    game.status = "playing";
    game.turnIndex = 0;
    game.team = 0;
    game.player = 0;
    createBoard();
    sendState();
  });

  socket.on("disconnect", () => leavePresence(socket));

  socket.on("reset", () => {
    if (!isAdmin(socket)) return;
    resetGame();
    socket.emit("auth", { ok: true, admin: game.admin, watch: game.watch, codes: game.codes });
    sendState();
  });
});

resetGame();
const port = process.env.PORT || 3000;
server.listen(port, () => console.log("NOISE Cards running on port " + port));
