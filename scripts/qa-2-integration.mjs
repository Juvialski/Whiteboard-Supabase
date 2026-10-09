// Real relay + disposable Postgres. The small loopback API represents Auth and
// PostgREST transport; all board authorization and conflict decisions use SQL.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

export async function runQA2Integration(cluster, admin, identities) {
  const board = 'qa2-isolated';
  const clients = [];
  const sockets = [];
  const checks = [];
  let child;
  const relayDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'whiteboard-qa2-relay-'));
  const record = name => { checks.push(name); console.log(`QA-2 PASS: ${name}`); };
  const sessions = new Map();
  for (const [name, uid] of Object.entries(identities)) {
    const db = cluster.getPgClient();
    clients.push(db);
    await db.connect();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
    await db.query('set role authenticated');
    sessions.set(`qa2-${randomUUID()}`, { name, uid, db });
  }
  const session = name => [...sessions.values()].find(s => s.name === name);
  const token = name => [...sessions].find(([, s]) => s.name === name)[0];
  const sql = async (name, query, args = []) => (await session(name).db.query(query, args)).rows[0];
  const state = async name => (await sql(name, 'select get_board_state($1) as payload', [board])).payload;
  const mutate = async (name, id, data, updatedAt = Date.now(), action = 'set') => {
    const { shard } = await sql(name, 'select element_shard_id($1) as shard', [id]);
    return (await sql(name, 'select apply_board_mutations($1,$2) as payload', [board,
      JSON.stringify([{ elementId: id, shardId: shard, action, ...(data ? { data } : {}), updatedAt, updatedByClientId: name }])])).payload;
  };
  const element = (payload, id) => payload.shards.flatMap(s => Object.values(s.elements)).find(e => e.id === id);
  // Test-issued opaque tokens never leave loopback; unknown tokens fail closed.
  const api = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    const s = sessions.get((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!s) { res.writeHead(401); res.end(JSON.stringify({ message: 'Invalid test session' })); return; }
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/auth/v1/user') {
        res.end(JSON.stringify({ id: s.uid, aud: 'authenticated', role: 'authenticated', email: `${s.name}@example.invalid` })); return;
      }
      let result;
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        let body = ''; for await (const chunk of req) body += chunk;
        const args = JSON.parse(body || '{}');
        const allowed = new Set(['get_board_access', 'get_board_timer']);
        const rpc = url.pathname.split('/').at(-1);
        if (!allowed.has(rpc)) throw new Error('Unexpected test API RPC');
        result = (await s.db.query(`select ${rpc}($1) as payload`, [args.p_board_id])).rows[0].payload;
      } else if (url.pathname === '/rest/v1/boards') {
        const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
        // SELECT runs as the session's authenticated role, so RLS is exercised.
        result = (await s.db.query('select current_revision,changed_shard_ids,deleted_shard_ids,total_elements,updated_at from boards where id=$1', [id])).rows[0] || null;
      } else { res.writeHead(404); res.end('{}'); return; }
      res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(403); res.end(JSON.stringify({ code: error.code, message: error.message })); }
  });
  const waitMessage = async (peer, predicate, label = 'expected message') => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const match = peer.messages.find(predicate);
      if (match) return match;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Relay message timeout: ${label}`);
  };
  const connect = async (name, boardId = board, invalid = false) => {
    const ws = new WebSocket(`ws://127.0.0.1:${child.qaPort}/ws`);
    sockets.push(ws);
    const peer = { ws, messages: [], send: message => ws.send(JSON.stringify(message)) };
    ws.on('message', data => peer.messages.push(JSON.parse(data.toString())));
    await once(ws, 'open');
    peer.send({ type: 'authenticate', boardId, accessToken: invalid ? 'unknown-test-session' : token(name) });
    await waitMessage(peer, m => m.type === (invalid || name === 'outsider' ? 'auth_error' : 'authenticated'));
    return peer;
  };
  // A ping/pong barrier on the same socket plus a short quiet window verifies
  // denied messages without treating an arbitrary immediate read as evidence.
  const rejected = async (sender, receiver, message) => {
    const start = receiver.messages.length;
    const barrier = Math.floor(Math.random() * 1e9);
    sender.send(message); sender.send({ type: 'ping', id: barrier });
    await waitMessage(sender, m => m.type === 'pong' && m.id === barrier);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert(!receiver.messages.slice(start).some(m => m.type === message.type));
  };
  try {
    await sql('owner', 'select create_board($1,$2)', [board, 'QA-2 synthetic classroom']);
    await admin.query("insert into board_members(board_id,user_id,role) values ($1,$2,'editor'),($1,$3,'viewer')", [board, identities.editor, identities.viewer]);
    await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
    const apiPort = api.address().port;
    const probe = http.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const relayPort = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    // Explicit environment allowlist and empty temporary cwd: dotenv cannot
    // read a developer's .env, and no production config reaches this process.
    const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    child = spawn(process.execPath, ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href, path.resolve('server.ts')], { cwd: relayDirectory, env: {
      ...env, NODE_ENV: 'test', PORT: String(relayPort), SUPABASE_URL: `http://127.0.0.1:${apiPort}`,
      SUPABASE_PUBLISHABLE_KEY: 'isolated-test-publishable', APP_ORIGIN: `http://127.0.0.1:${relayPort}`,
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.qaPort = relayPort;
    let log = ''; child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
    const deadline = Date.now() + 30000;
    while (!log.includes('Server running on') && Date.now() < deadline && child.exitCode === null) await new Promise(resolve => setTimeout(resolve, 50));
    assert(log.includes('Server running on'), `Isolated server startup failed: ${log}`);
    const teacher = await connect('owner'), student = await connect('editor'), viewer = await connect('viewer');
    await connect('outsider'); await connect('owner', board, true);
    assert.equal(viewer.messages[0].canWrite, false);
    record('independent identities authenticate; viewer, outsider and invalid-token authorization');

    const stroke = { id: 'qa2-stroke', type: 'drawing', points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], color: '#000000', width: 2, isHighlighter: false, zIndex: 1 };
    teacher.send({ type: 'drawing_stream', points: stroke.points, width: 2, color: '#000000' });
    assert.deepEqual((await waitMessage(student, m => m.type === 'drawing_stream')).points, stroke.points);
    teacher.send({ type: 'element_update', elementId: stroke.id, actionType: 'set', elementData: stroke, userId: identities.outsider, boardId: 'spoof' });
    const completed = await waitMessage(student, m => m.type === 'element_update' && m.elementId === stroke.id);
    assert.equal(completed.userId, identities.owner); assert.equal(completed.boardId, board);
    assert.equal(element(await state('viewer'), stroke.id), undefined); // before checkpoint
    teacher.send({ type: 'drawing_stream_end' });
    await waitMessage(student, m => m.type === 'drawing_stream_end');
    const commit = await mutate('owner', stroke.id, stroke);
    teacher.send({ type: 'board_manifest_changed', revision: commit.revision, changedShardIds: [], deletedShardIds: [], totalElements: 999 });
    const manifest = await waitMessage(student, m => m.type === 'board_manifest_changed' && m.revision === commit.revision);
    assert.deepEqual(manifest.changedShardIds, commit.changedShardIds); assert.equal(manifest.totalElements, 1);
    assert.deepEqual(element(await state('viewer'), stroke.id).points, stroke.points);
    record('realtime drawing, completed pen-up before checkpoint, authoritative manifest handoff');

    const note = (id, text) => ({ id, type: 'text', text, x: 1, y: 2, width: 100, height: 40, color: '#000000', fontSize: 16, zIndex: 2 });
    await Promise.all([mutate('owner', 'teacher-note', note('teacher-note', 'Teacher')), mutate('editor', 'student-note', note('student-note', 'Student'))]);
    assert(element(await state('viewer'), 'teacher-note')); assert(element(await state('viewer'), 'student-note'));
    student.ws.close(); await once(student.ws, 'close');
    await mutate('owner', 'missed-note', note('missed-note', 'While disconnected'));
    const reconnected = await connect('editor');
    assert.equal(element(await state('editor'), 'missed-note').text, 'While disconnected');
    record('concurrent independent edits and reconnect snapshot recovery');

    const original = note('qa2-edit', 'Original');
    const moved = { ...original, x: 55, y: 80, width: 250, height: 90 };
    for (const [index, data] of [original, moved, null, moved, original, moved].entries()) {
      // Create, move/resize, delete, restore, undo and redo payloads all use the
      // production element protocol; UI history controls are separately scoped.
      const start = viewer.messages.length;
      teacher.send({ type: 'element_update', elementId: original.id, actionType: data ? 'set' : 'delete', ...(data ? { elementData: data } : {}) });
      const event = await waitMessage(viewer, m => viewer.messages.indexOf(m) >= start && m.type === 'element_update' && m.elementId === original.id, `edit step ${index}: ${data ? 'set' : 'delete'}`);
      assert.equal(event.actionType, data ? 'set' : 'delete');
      if (!data) assert.equal(event.elementData, undefined);
      await mutate('owner', original.id, data, Date.now() + index, data ? 'set' : 'delete');
      const persisted = element(await state('viewer'), original.id);
      if (data) { assert.equal(persisted.x, data.x); assert.equal(persisted.width, data.width); }
      else assert.equal(persisted, undefined);
    }
    record('move/resize, deletion and undo/redo payload transport plus checkpoint recovery');
    await rejected(teacher, viewer, { type: 'element_update', elementId: 'invalid-set', actionType: 'set' });
    await rejected(teacher, viewer, { type: 'element_update', elementId: 'invalid-set', actionType: 'set', elementData: { ...original, id: 'different-id' } });

    for (const message of [
      { type: 'element_update', elementId: stroke.id, actionType: 'delete' },
      { type: 'drawing_stream', points: stroke.points, width: 2 },
      { type: 'drawing_stream_end' }, { type: 'timer_sync', revision: 999 },
      { type: 'request_follow' }, { type: 'board_settings_changed', studentsCanWrite: true },
    ]) await rejected(viewer, teacher, message);
    await assert.rejects(mutate('viewer', stroke.id, stroke), e => e.code === '42501');
    record('viewer cannot draw, delete, change timer/settings or force follow through relay/SQL');

    const cover = { id: 'qa2-cover', type: 'shape', shapeType: 'rect', answerCover: true, revealed: false, x: 5, y: 10, width: 200, height: 100, color: '#334155', borderColor: '#94a3b8', text: '', zIndex: 9 };
    await mutate('owner', cover.id, cover);
    teacher.send({ type: 'element_update', elementId: cover.id, actionType: 'set', elementData: { revealed: true }, isMerge: true });
    assert.equal((await waitMessage(viewer, m => m.elementId === cover.id)).elementData.revealed, true);
    await mutate('owner', cover.id, { ...cover, revealed: true }, Date.now() + 1);
    assert.equal(element(await state('viewer'), cover.id).revealed, true);
    await rejected(viewer, teacher, { type: 'element_update', elementId: cover.id, actionType: 'set', elementData: { revealed: false }, isMerge: true });
    record('cover/reveal transport, checkpoint reload and viewer rejection');

    let timer = (await sql('owner', 'select transition_board_timer($1,0,\'duration\',30) as payload', [board])).payload;
    timer = (await sql('owner', 'select transition_board_timer($1,$2,\'start\',null) as payload', [board, timer.timer.revision])).payload;
    teacher.send({ type: 'timer_sync', revision: 9999 });
    const sharedTimer = await waitMessage(reconnected, m => m.type === 'timer_sync');
    assert.equal(sharedTimer.revision, timer.timer.revision); assert.equal(sharedTimer.state.isRunning, true);
    assert.deepEqual((await sql('viewer', 'select get_board_timer($1) as payload', [board])).payload.timer, timer.timer);
    await assert.rejects(sql('viewer', 'select transition_board_timer($1,$2,\'pause\',null)', [board, timer.timer.revision]), e => e.code === '42501');
    record('timer notifications use database revision; separate clients agree and viewer transition denied');

    const now = Date.now();
    await mutate('editor', 'conflict', note('conflict', 'New student edit'), now);
    await mutate('owner', 'conflict', note('conflict', 'Stale offline teacher edit'), now - 10000);
    assert.equal(element(await state('viewer'), 'conflict').text, 'New student edit');
    await mutate('editor', 'conflict', null, now + 10, 'delete');
    await mutate('owner', 'conflict', note('conflict', 'Stale resurrection'), now - 10000);
    assert.equal(element(await state('viewer'), 'conflict'), undefined);
    await mutate('owner', 'conflict', note('conflict', 'Explicit newer edit'), now + 20);
    assert.equal(element(await state('viewer'), 'conflict').text, 'Explicit newer edit');
    record('offline conflict winner, deletion tombstone and explicit newer recovery');

    teacher.send({ type: 'cursor', x: 100.125, y: 200.5, panX: 20, panY: -10, zoom: 2, name: 'QA Teacher', userId: identities.outsider });
    const cursor = await waitMessage(viewer, m => m.type === 'cursor');
    assert.equal(cursor.userId, identities.owner); assert.equal(cursor.x, 100.125); assert.equal(cursor.zoom, 2);
    teacher.send({ type: 'request_follow', panX: 20, panY: -10, zoom: 2 });
    assert.equal((await waitMessage(viewer, m => m.type === 'request_follow')).teacherId, identities.owner);
    teacher.send({ type: 'stop_follow' }); await waitMessage(viewer, m => m.type === 'stop_follow');
    record('cursor precision and authorized follow/unfollow across identities');
    return checks;
  } finally {
    for (const ws of sockets) ws.terminate();
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 10000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    api.closeAllConnections(); await new Promise(resolve => api.close(resolve));
    await Promise.allSettled(clients.map(db => db.end()));
    await fs.rm(relayDirectory, { recursive: true, force: true });
  }
}
