const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const makeCode = () => crypto.randomBytes(4).toString("hex").toUpperCase();

let game;

function resetGame() {
  game = {
    admin: "NOISE2026",
    watch: makeCode(),
    codes: {},
    teams: [
      { name: "الفريق الأول", players: [], score: 0 },
      { name: "الفريق الثاني", players: [], score: 0 }
    ],
    rounds: 1,
    round: 1,
    pairs: 8,
    bombs: 1,
    bonuses: 2,
    board: [],
    team: 0,
    player: 0,
    turnIndex: 0,
    status: "lobby",
    log: [],
    revealed: [],
    busy: false
  };
}

function getState() {
  return {
    status: game.status,
    teams: game.teams.map(team => ({
      name: team.name,
      players: team.players.map(p => p.name),
      score: team.score
    })),
    round: game.round,
    rounds: game.rounds,
    board: game.board.map(card => ({
      id: card.id,
      up: card.up,
      gone: card.gone,
      value: card.up || card.gone ? card.value : null,
      kind: card.up || card.gone ? card.kind : null
    })),
    team: game.team,
    player: game.player,
    turn: game.teams[game.team]?.players[game.player]?.name || "",
    log: game.log.slice(-25)
  };
}

function sendState() {
  io.emit("state", getState());
}

function shuffle(items) {
  return items.sort(() => Math.random() - 0.5);
}

function createBoard() {
  const cards = [];

  for (let i = 0; i < game.pairs; i++) {
    cards.push({ kind: "match", value: i });
    cards.push({ kind: "match", value: i });
  }

  for (let i = 0; i < game.bombs; i++) {
    cards.push({ kind: "bomb", value: "💣" });
  }

  for (let i = 0; i < game.bonuses; i++) {
    cards.push({
      kind: "bonus",
      value: [5, 10, 15][Math.floor(Math.random() * 3)]
    });
  }

  game.board = shuffle(cards).map((card, id) => ({
    ...card,
    id,
    up: false,
    gone: false
  }));

  game.revealed = [];
}

function advanceTurn() {
  game.turnIndex = (game.turnIndex + 1) % 4;
  game.team = Math.floor(game.turnIndex / 2);
  game.player = game.turnIndex % 2;
  game.revealed = [];
  game.busy = false;
  sendState();
}

function isAdmin(socket) {
  return socket.data.role === "admin";
}

io.on("connection", socket => {
  socket.on("adminLogin", enteredCode => {
    if (enteredCode !== game.admin) {
      socket.emit("auth", { ok: false });
      return;
    }

    socket.data.role = "admin";
    socket.emit("auth", {
      ok: true,
      admin: game.admin,
      watch: game.watch,
      codes: game.codes
    });
    socket.emit("state", getState());
  });

  socket.on("watchLogin", enteredCode => {
    const ok = enteredCode === game.watch;
    if (ok) {
      socket.data.role = "watch";
      socket.emit("state", getState());
    }
    socket.emit("watchAuth", ok);
  });

  socket.on("playerLogin", enteredCode => {
    const player = game.codes[enteredCode];

    if (!player) {
      socket.emit("playerAuth", false);
      return;
    }

    socket.data.role = "player";
    socket.data.player = player;
    socket.emit("playerAuth", true);
    socket.emit("state", getState());
  });

  socket.on("configure", data => {
    if (!isAdmin(socket)) return;

    game.teams = data.teams.map(team => ({
      name: team.name,
      players: team.players.map(name => ({ name })),
      score: 0
    }));

    game.rounds = Math.max(1, Number(data.rounds) || 1);
    game.pairs = Math.max(1, Number(data.pairs) || 8);
    game.bombs = Math.max(0, Number(data.bombs) || 0);
    game.bonuses = Math.max(0, Number(data.bonuses) || 0);

    game.codes = {};

    game.teams.forEach((team, teamIndex) => {
      team.players.forEach((player, playerIndex) => {
        const code = makeCode();
        game.codes[code] = {
          team: teamIndex,
          player: playerIndex
        };
      });
    });

    socket.emit("auth", {
      ok: true,
      admin: game.admin,
      watch: game.watch,
      codes: game.codes
    });

    sendState();
  });

  socket.on("start", () => {
    if (!isAdmin(socket)) return;

    game.status = "playing";
    game.round = 1;
    game.teams.forEach(team => team.score = 0);
    game.turnIndex = 0;
    game.team = 0;
    game.player = 0;
    game.log = [];
    game.busy = false;

    createBoard();
    sendState();
  });

  socket.on("flip", id => {
    const player = socket.data.player;

    if (
      socket.data.role !== "player" ||
      !player ||
      game.status !== "playing" ||
      game.busy ||
      player.team !== game.team ||
      player.player !== game.player
    ) return;

    const card = game.board.find(item => item.id === Number(id));

    if (!card || card.up || card.gone || game.revealed.length >= 2) return;

    card.up = true;
    game.revealed.push(card.id);

    if (card.kind === "bomb") {
      game.teams[game.team].score = 0;
      game.log.push("قنبلة! تم تصفير نقاط " + game.teams[game.team].name);
      card.up = false;
      advanceTurn();
      return;
    }

    if (card.kind === "bonus") {
      game.teams[game.team].score += card.value;
      card.gone = true;
      card.up = false;
      game.log.push("بطاقة مكافأة: +" + card.value);
      game.revealed = [];
      sendState();
      return;
    }

    if (game.revealed.length === 2) {
      const [first, second] = game.revealed.map(cardId =>
        game.board.find(item => item.id === cardId)
      );

      if (first.value === second.value) {
        first.gone = true;
        second.gone = true;
        first.up = false;
        second.up = false;

        game.teams[game.team].score += 1;
        game.log.push("تطابق صحيح! +1 نقطة");

        game.revealed = [];

        if (game.board.every(item => item.gone)) {
          game.status = "roundEnd";
        }

        sendState();
      } else {
        game.busy = true;
        sendState();

        setTimeout(() => {
          first.up = false;
          second.up = false;
          game.log.push("لم يحدث تطابق");
          advanceTurn();
        }, 1100);
      }
    } else {
      sendState();
    }
  });

  socket.on("next", () => {
    if (!isAdmin(socket)) return;

    if (game.round >= game.rounds) {
      game.status = "finished";
      sendState();
      return;
    }

    game.round += 1;
    game.status = "playing";
    game.turnIndex = 0;
    game.team = 0;
    game.player = 0;
    game.busy = false;
    createBoard();
    sendState();
  });

  socket.on("reset", () => {
    if (!isAdmin(socket)) return;
    resetGame();
    socket.emit("auth", {
      ok: true,
      admin: game.admin,
      watch: game.watch,
      codes: game.codes
    });
    sendState();
  });
});

resetGame();

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log("NOISE Cards running on port " + port);
  console.log("Admin code: " + game.admin);
  console.log("Watch code: " + game.watch);
});
