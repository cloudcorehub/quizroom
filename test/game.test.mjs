import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { createGameServer, scoreAnswer } from '../server.mjs';

const quiz = { title: 'Integration quiz', questions: [
  { text: 'What is two plus two?', options: ['Three', 'Four', 'Five', 'Six'], correct: 1, seconds: 5 },
  { text: 'Which is a color?', options: ['Red', 'Cat', 'Dog', 'Book'], correct: 0, seconds: 5 }
] };
async function fixture(t) {
  const app = createGameServer({ countdownMs: 20 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.shutdown());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (path, data, token, expected = 200, extra = {}) => {
    const res = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: data === undefined ? undefined : JSON.stringify(data) });
    const result = await res.json(); assert.equal(res.status, expected, JSON.stringify(result)); return result;
  };
  const host = await api('/api/rooms', { quiz }, null, 201);
  const path = `/api/rooms/${host.pin}`;
  const alice = await api(path + '/join', { name: 'Alice' }, null, 201);
  const bob = await api(path + '/join', { name: 'Bob' }, null, 201);
  return { api, host, path, alice, bob, base };
}
async function until(getter, phase) {
  for (let i = 0; i < 150; i++) { const s = await getter(); if (s.phase === phase) return s; await wait(50); }
  assert.fail(`Did not reach ${phase}`);
}
test('live room: two players, private answers, authority, duplicate/stale answers, scores, podium and restart', async t => {
  const { api, path, host, alice, bob, base } = await fixture(t);
  const get = token => api(path + '/state', undefined, token);
  const cmd = action => api(path + '/action', { action }, host.token);
  await api(path + '/join', { name: 'ALICE' }, null, 409);
  await api(path + '/state', undefined, 'bad-token', 401);
  await api(path + '/action', { action: 'start' }, alice.token, 403);
  await cmd('lock'); await api(path + '/join', { name: 'Late' }, null, 409); await cmd('lock');
  const abort = new AbortController();
  const eventResponse = await fetch(`${base}${path}/events?token=${alice.token}`, { signal: abort.signal });
  assert.match(eventResponse.headers.get('content-type'), /text\/event-stream/);
  const reader = eventResponse.body.getReader();
  const firstEvent = new TextDecoder().decode((await reader.read()).value);
  assert.match(firstEvent, /"phase":"lobby"/); assert.ok(!firstEvent.includes(host.token)); abort.abort();
  await cmd('start');
  let s = await until(() => get(alice.token), 'question');
  assert.equal(s.question.correct, undefined); assert.equal(s.distribution, null); assert.equal(s.me.score, 0);
  assert.ok(!JSON.stringify(s).includes('hostToken')); assert.ok(!JSON.stringify(s).includes(bob.token));
  await api(path + '/answer', { index: 0, choice: 1 }, host.token, 403);
  await api(path + '/answer', { index: 0, choice: 1 }, alice.token);
  await api(path + '/answer', { index: 0, choice: 2 }, alice.token, 409);
  s = await get(alice.token); assert.equal(s.me.answered, true); assert.equal(s.me.score, 0); assert.equal(s.me.result, null);
  assert.equal((await get(bob.token)).question.correct, undefined);
  await api(path + '/answer', { index: 0, choice: 0 }, bob.token);
  s = await get(alice.token); assert.equal(s.phase, 'reveal'); assert.equal(s.question.correct, 1); assert.deepEqual(s.distribution, [1, 1, 0, 0]);
  assert.equal(s.me.result.correct, true); assert.ok(s.me.score >= 500 && s.me.score <= 1000); assert.equal((await get(bob.token)).me.score, 0);
  const firstScore = s.me.score;
  // A refreshed client restores identity, points, and phase using the same token.
  assert.equal((await get(alice.token)).me.score, firstScore);
  await cmd('next'); assert.equal((await get(host.token)).phase, 'leaderboard');
  await cmd('next'); await until(() => get(alice.token), 'question');
  await api(path + '/answer', { index: 0, choice: 0 }, alice.token, 409);
  await api(path + '/answer', { index: 1, choice: 8 }, alice.token, 400);
  await api(path + '/answer', { index: 1, choice: 0 }, alice.token);
  // A silent player must not stall the room: server time expires the question.
  s = await until(() => get(bob.token), 'reveal'); assert.equal(s.me.result.choice, null); assert.equal(s.me.result.points, 0);
  await api(path + '/answer', { index: 1, choice: 0 }, bob.token, 409);
  await cmd('next'); await cmd('next'); s = await get(host.token); assert.equal(s.phase, 'podium'); assert.equal(s.players[0].name, 'Alice');
  await api(path + '/join', { name: 'Late' }, null, 409);
  await cmd('restart'); s = await get(alice.token); assert.equal(s.phase, 'lobby'); assert.equal(s.me.score, 0); assert.equal(s.index, -1);
});
test('input boundaries, cross-origin commands, static serving and early host reveal', async t => {
  const { api, path, host, alice, base } = await fixture(t);
  assert.deepEqual(await api('/healthz'), { status: 'ok' });
  const head = await fetch(base + '/healthz', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  await api('/api/rooms', { quiz: { ...quiz, questions: [] } }, null, 400);
  await api('/api/rooms', { quiz: { ...quiz, questions: [{ ...quiz.questions[0], seconds: -1 }] } }, null, 400);
  await api(path + '/join', { name: ' ' }, null, 400);
  await api(path + '/action', { action: 'start' }, host.token, 403, { Origin: 'https://another-site.example' });
  await api(path + '/action', { action: 'next' }, host.token, 409);
  assert.equal((await fetch(base + '/host/' + host.pin)).status, 200);
  assert.equal((await fetch(base + '/server.mjs')).status, 404);
  assert.equal((await fetch(base + '/research/controller-CbWYRXqE.js')).status, 404);
  await api(path + '/action', { action: 'start' }, host.token);
  await until(() => api(path + '/state', undefined, alice.token), 'question');
  await api(path + '/action', { action: 'reveal' }, host.token);
  assert.equal((await api(path + '/state', undefined, alice.token)).phase, 'reveal');
});
test('documented score examples and under-half-second maximum', () => {
  assert.equal(scoreAnswer(2000, 30000), 967);
  assert.equal(scoreAnswer(499, 30000), 1000);
  assert.equal(scoreAnswer(15000, 30000), 750);
  assert.equal(scoreAnswer(30000, 30000), 500);
});
