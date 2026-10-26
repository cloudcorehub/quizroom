import http from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const cleanText = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${label} must be 1–${max} characters.`);
  return value.trim();
};
export function validateQuiz(input) {
  const title = cleanText(input?.title, 90, 'Quiz title');
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 50) fail(400, 'Add between 1 and 50 questions.');
  const questions = input.questions.map(q => {
    if (!Array.isArray(q.options) || q.options.length !== 4) fail(400, 'Each question needs four answers.');
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) fail(400, 'Choose a correct answer.');
    if (!Number.isInteger(q.seconds) || q.seconds < 5 || q.seconds > 120) fail(400, 'Question timers must be 5–120 seconds.');
    return { text: cleanText(q.text, 240, 'Question'), options: q.options.map(a => cleanText(a, 120, 'Answer')), correct: q.correct, seconds: q.seconds };
  });
  return { title, questions };
}

// The published single-select scoring rule; the server measures elapsed time.
export function scoreAnswer(elapsedMs, durationMs) {
  if (elapsedMs < 500) return 1000;
  return Math.round(1000 * (1 - Math.min(1, Math.max(0, elapsedMs / durationMs)) / 2));
}

export function createGameServer({ countdownMs = 3000 } = {}) {
  const rooms = new Map();
  const connections = new Set();
  const rank = room => [...room.players.values()].sort((a, b) => b.score - a.score || a.joined - b.joined);
  const getRoom = pin => rooms.get(pin) || fail(404, 'That game is not available. Check the PIN with your host.');
  const identity = (room, token) => token === room.hostToken ? { host: true } : room.players.get(token) || fail(401, 'Your session expired. Join the game again.');
  const snapshot = (room, token) => {
    const user = identity(room, token), q = room.quiz.questions[room.index];
    const showResult = ['reveal', 'leaderboard', 'podium'].includes(room.phase);
    const players = rank(room);
    const me = user.host ? null : { id: user.id, name: user.name, score: user.score, rank: players.indexOf(user) + 1, answered: room.answers.has(token), result: showResult ? user.result : null };
    return {
      pin: room.pin, title: room.quiz.title, phase: room.phase, role: user.host ? 'host' : 'player', locked: room.locked,
      serverTime: Date.now(), deadline: room.deadline, index: room.index, total: room.quiz.questions.length,
      playerCount: players.length, answeredCount: room.answers.size,
      players: players.map(p => ({ id: p.id, name: p.name, score: p.score, streak: p.streak })), me,
      question: q && room.phase !== 'lobby' ? { text: q.text, options: q.options, seconds: q.seconds, ...(showResult ? { correct: q.correct } : {}) } : null,
      distribution: showResult ? q.options.map((_, i) => [...room.answers.values()].filter(a => a.choice === i).length) : null
    };
  };
  const broadcast = room => {
    room.touched = Date.now();
    for (const client of room.clients) {
      if (!client.res.destroyed) client.res.write(`data: ${JSON.stringify(snapshot(room, client.token))}\n\n`);
    }
  };
  const finishQuestion = room => {
    if (room.phase !== 'question') return;
    clearTimeout(room.timer);
    const q = room.quiz.questions[room.index];
    for (const [token, p] of room.players) {
      const answer = room.answers.get(token), correct = answer?.choice === q.correct;
      const points = correct ? scoreAnswer(answer.elapsed, q.seconds * 1000) : 0;
      p.score += points; p.streak = correct ? p.streak + 1 : 0;
      p.result = { correct, points, choice: answer?.choice ?? null };
    }
    room.phase = 'reveal'; room.deadline = null; broadcast(room);
  };
  const beginQuestion = room => {
    room.index += 1; room.answers.clear(); room.phase = 'countdown';
    room.deadline = Date.now() + countdownMs;
    for (const p of room.players.values()) p.result = null;
    broadcast(room);
    room.timer = setTimeout(() => {
      room.phase = 'question'; room.started = Date.now();
      room.deadline = room.started + room.quiz.questions[room.index].seconds * 1000;
      room.timer = setTimeout(() => finishQuestion(room), room.quiz.questions[room.index].seconds * 1000);
      broadcast(room);
    }, countdownMs);
  };
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const body = async req => {
    let text = '', bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 100000) fail(413, 'That quiz is too large.'); text += chunk; }
    try { return JSON.parse(text); } catch { fail(400, 'Invalid JSON request.'); }
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
        if (req.method === 'HEAD') { res.writeHead(200, { 'Cache-Control': 'no-store' }); res.end(); return; }
        return json(res, 200, { status: 'ok' });
      }
      if (req.method === 'POST' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) fail(403, 'Use the game’s own page to send commands.');
      if (url.pathname === '/api/rooms' && req.method === 'POST') {
        if (rooms.size >= 200) fail(503, 'The server is full. Please try later.');
        const quiz = validateQuiz((await body(req)).quiz);
        let pin; do { pin = String(randomInt(100000, 1000000)); } while (rooms.has(pin));
        const room = { pin, quiz, hostToken: randomUUID(), players: new Map(), clients: new Set(), answers: new Map(), phase: 'lobby', index: -1, locked: false, deadline: null, touched: Date.now() };
        rooms.set(pin, room); return json(res, 201, { pin, token: room.hostToken });
      }
      const match = url.pathname.match(/^\/api\/rooms\/(\d{6})\/(join|state|events|action|answer)$/);
      if (match) {
        const [, pin, operation] = match, room = getRoom(pin);
        if (operation === 'join' && req.method === 'POST') {
          if (room.locked || room.phase === 'podium') fail(409, 'This game is closed to new players.');
          if (room.players.size >= 100) fail(409, 'This room has reached 100 players.');
          const name = cleanText((await body(req)).name, 24, 'Nickname');
          if ([...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) fail(409, 'That nickname is taken. Try another one.');
          const token = randomUUID();
          room.players.set(token, { id: randomUUID(), name, score: 0, streak: 0, joined: Date.now(), result: null });
          broadcast(room); return json(res, 201, { pin, token });
        }
        const token = req.headers.authorization?.replace(/^Bearer /, '') || (operation === 'events' ? url.searchParams.get('token') : null);
        const user = identity(room, token);
        if (operation === 'state' && req.method === 'GET') return json(res, 200, snapshot(room, token));
        if (operation === 'events' && req.method === 'GET') {
          if (room.clients.size >= 220) fail(429, 'Too many connections to this room.');
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write(`data: ${JSON.stringify(snapshot(room, token))}\n\n`);
          const client = { token, res }; room.clients.add(client); connections.add(res);
          const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
          req.on('close', () => { clearInterval(heartbeat); room.clients.delete(client); connections.delete(res); }); return;
        }
        if (operation === 'answer' && req.method === 'POST') {
          if (user.host) fail(403, 'Join as a player to answer.');
          const answer = await body(req);
          if (room.phase !== 'question' || Date.now() >= room.deadline) { finishQuestion(room); fail(409, 'This question has ended.'); }
          if (answer.index !== room.index) fail(409, 'That answer belongs to an earlier question.');
          if (!Number.isInteger(answer.choice) || answer.choice < 0 || answer.choice > 3) fail(400, 'Choose one of the four answers.');
          if (room.answers.has(token)) fail(409, 'Your answer is already locked in.');
          room.answers.set(token, { choice: answer.choice, elapsed: Date.now() - room.started });
          if (room.answers.size === room.players.size) finishQuestion(room); else broadcast(room);
          return json(res, 200, { accepted: true });
        }
        if (operation === 'action' && req.method === 'POST') {
          if (!user.host) fail(403, 'Only the host can control the game.');
          const { action } = await body(req);
          if (action === 'lock') room.locked = !room.locked;
          else if (action === 'start' && room.phase === 'lobby' && room.players.size) beginQuestion(room);
          else if (action === 'reveal' && room.phase === 'question') finishQuestion(room);
          else if (action === 'next' && room.phase === 'reveal') room.phase = 'leaderboard';
          else if (action === 'next' && room.phase === 'leaderboard') {
            if (room.index + 1 < room.quiz.questions.length) beginQuestion(room);
            else room.phase = 'podium';
          } else if (action === 'restart' && room.phase === 'podium') {
            room.phase = 'lobby'; room.index = -1; room.deadline = null; room.answers.clear(); room.locked = false;
            for (const p of room.players.values()) Object.assign(p, { score: 0, streak: 0, result: null });
          } else fail(409, 'That action is unavailable in this game state.');
          broadcast(room); return json(res, 200, { ok: true });
        }
        fail(405, 'That method is not supported.');
      }
      if (url.pathname.startsWith('/api/')) fail(404, 'Unknown game endpoint.');
      if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'That method is not supported.');
      const assets = { '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/quizzes.json': ['quizzes.json', 'application/json'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
      const asset = assets[url.pathname] || (url.pathname === '/' || /^\/(host|play)\/\d{6}$/.test(url.pathname) ? ['index.html', 'text/html'] : null);
      if (!asset) fail(404, 'Page not found.');
      const data = await readFile(path.join(publicDir, asset[0]));
      res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please retry.' });
      else res.end();
    }
  });
  const sweeper = setInterval(() => {
    for (const [pin, room] of rooms) if (Date.now() - room.touched > 6 * 60 * 60 * 1000) {
      clearTimeout(room.timer); for (const c of room.clients) c.res.end(); rooms.delete(pin);
    }
  }, 60000).unref();
  return { server, shutdown: () => { clearInterval(sweeper); for (const room of rooms.values()) clearTimeout(room.timer); for (const res of connections) res.end(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createGameServer(), port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1';
  app.server.listen(port, host, () => {
    console.log(`Quizroom is ready: http://localhost:${port}`);
    if (host === '0.0.0.0') for (const addresses of Object.values(networkInterfaces())) for (const a of addresses || []) if (a.family === 'IPv4' && !a.internal) console.log(`On your Wi-Fi: http://${a.address}:${port}`);
  });
  process.on('SIGTERM', () => app.shutdown()); process.on('SIGINT', () => app.shutdown());
}
