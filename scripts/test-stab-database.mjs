// Real isolated Postgres; never accepts a hosted URL. Supabase infrastructure is
// represented by minimal auth/storage schemas, not by production user fixtures.
import EmbeddedPostgres from 'embedded-postgres';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'whiteboard-stab-'));
const port = await new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const cluster = new EmbeddedPostgres({ databaseDir: path.join(directory, 'db'),
  user: 'postgres', password: 'isolated-test-only', port, persistent: false,
  postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {} });
const clients = [];
const bootstrap = `
  do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then
      create role anon; create role authenticated; create role service_role bypassrls;
    end if;
  end $$;
  create schema auth; create schema storage; create schema extensions;
  create extension pgcrypto with schema extensions;
  create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}',
    raw_app_meta_data jsonb default '{}', is_anonymous boolean default false);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
  create function auth.role() returns text language sql stable as $$ select current_user::text $$;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text,
    metadata jsonb default '{}', owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array(regexp_replace($1, '/[^/]*$', ''), '/') $$;
  grant usage on schema auth, storage, public, extensions to authenticated, anon, service_role;
  grant all on all tables in schema storage to authenticated, service_role;
  alter default privileges in schema public grant all on tables to authenticated, anon, service_role;
`;
const owner = '00000000-0000-4000-8000-000000000001';
const viewer = '00000000-0000-4000-8000-000000000002';
const editor = '00000000-0000-4000-8000-000000000003';
const outsider = '00000000-0000-4000-8000-000000000004';
let assertions = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
try {
  await cluster.initialise(); await cluster.start();
  const admin = cluster.getPgClient(); clients.push(admin); await admin.connect();
  await admin.query(bootstrap);
  const names = (await fs.readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
  // Upgrade existing data through migration 8 and ensure the old frontend schema survives.
  for (const name of names.slice(0, -1)) await admin.query(await fs.readFile(path.join('supabase/migrations', name), 'utf8'));
  if (process.env.STAB_LIVE_AUDIT_PATH) {
    const live = JSON.parse(await fs.readFile(process.env.STAB_LIVE_AUDIT_PATH, 'utf8')).rows[0].audit;
    const local = (await admin.query("select oid::regprocedure::text as signature, pg_get_functiondef(oid) as definition from pg_proc where pronamespace='public'::regnamespace and prosecdef")).rows;
    const normalize = value => value.replaceAll('\r\n', '\n').trim();
    for (const fn of live.definers) {
      const corresponding = local.find(row => row.signature === fn.signature);
      assert(corresponding, `Live RPC absent from migrations: ${fn.signature}`);
      assert.equal(normalize(corresponding.definition), normalize(fn.definition), `Live RPC differs: ${fn.signature}`);
    }
    console.log(`Live read-only catalog comparison: ${live.definers.length} SECURITY DEFINER functions exactly match migrations.`);
  }
  await admin.query(`insert into auth.users(id,email) values ($1,'owner@example.invalid'),($2,'viewer@example.invalid'),($3,'editor@example.invalid'),($4,'outsider@example.invalid')`, [owner, viewer, editor, outsider]);
  await admin.query("insert into boards(id,name,owner_uid) values ('synthetic','Synthetic test board',$1),('private-other','Other',$2)", [owner, outsider]);
  await admin.query("insert into board_members(board_id,user_id,role) values ('synthetic',$1,'viewer'),('synthetic',$2,'editor')", [viewer, editor]);
  await admin.query("insert into board_shards(board_id,shard_id,elements) values ('synthetic','shard_0','{\"existing\":{\"id\":\"existing\",\"type\":\"text\",\"text\":\"keep\"}}')");
  await admin.query("insert into board_assets(board_id,asset_id,mime_type,object_path,encoded_byte_size,content_hash,created_by) values ('synthetic','image','image/png','boards/synthetic/image.png',100,$1,$2),('synthetic','pdf-page','image/png','boards/synthetic/page.png',100,$3,$2)", ['a'.repeat(64), owner, 'b'.repeat(64)]);
  const before = (await admin.query("select jsonb_agg(to_jsonb(b)) as rows from boards b")).rows[0].rows;
  await admin.query(await fs.readFile(path.join('supabase/migrations', names.at(-1)), 'utf8'));
  check((await admin.query("select jsonb_agg(to_jsonb(b)) as rows from boards b")).rows[0].rows, before);
  check((await admin.query("select elements->'existing'->>'text' as text from board_shards where board_id='synthetic'")).rows[0].text, 'keep');
  check((await admin.query("select count(*)::integer as count from board_assets")).rows[0].count, 2);
  const connect = async (identity, role = 'authenticated') => {
    const client = cluster.getPgClient(); clients.push(client); await client.connect();
    await client.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', identity]);
    await client.query(`set role ${role}`);
    return client;
  };
  const writer = await connect(owner); const reader = await connect(viewer);
  const editorClient = await connect(editor); const noAccess = await connect(outsider);
  const anonymous = await connect('', 'anon');
  const get = async client => (await client.query("select get_board_timer('synthetic') as payload")).rows[0].payload;
  const change = async (client, revision, action, value = null) =>
    (await client.query("select transition_board_timer('synthetic',$1,$2,$3) as payload", [revision, action, value])).rows[0].payload;
  const denied = async (promise, code = '42501') => { await assert.rejects(promise, err => err.code === code); assertions++; };
  check((await get(reader)).timer.revision, 0);
  await denied(change(reader, 0, 'start')); await denied(get(noAccess)); await denied(get(anonymous));
  await denied(reader.query("update board_timers set revision=99"));
  await denied(change(writer, 0, 'duration', -1), '22023');
  let payload = await change(writer, 0, 'duration', 300);
  check(payload.timer.revision, 1);
  payload = await change(writer, 1, 'start'); check(payload.timer.running, true);
  check(payload.timer.baseline_ms, 300000);
  check((await get(reader)).timer, payload.timer); // reload / late join
  await admin.query("update board_timers set started_at=clock_timestamp()-interval '30 seconds' where board_id='synthetic'");
  payload = await change(writer, 2, 'pause');
  assert(payload.timer.baseline_ms <= 270000 && payload.timer.baseline_ms > 265000); assertions++;
  check(payload.timer.started_at, null);
  const paused = payload.timer.baseline_ms;
  check((await get(reader)).timer.baseline_ms, paused);
  payload = await change(writer, 3, 'start');
  const results = await Promise.allSettled([change(writer, 4, 'adjust', 10), change(editorClient, 4, 'adjust', 60)]);
  check(results.filter(result => result.status === 'fulfilled').length, 1);
  check(results.find(result => result.status === 'rejected').reason.code, '40001');
  payload = await get(reader); check(payload.timer.revision, 5);
  payload = await change(writer, 5, 'visibility', 0); check(payload.timer.visible, false);
  payload = await change(writer, 6, 'mode', 1); check(payload.timer.baseline_ms, 0);
  payload = await change(writer, 7, 'start');
  await admin.query("update board_timers set started_at=clock_timestamp()-interval '1 hour' where board_id='synthetic'");
  payload = await change(writer, 8, 'pause');
  assert(payload.timer.baseline_ms >= 3600000); assertions++;
  payload = await change(writer, 9, 'duration', 1); payload = await change(writer, 10, 'start');
  await admin.query("update board_timers set started_at=clock_timestamp()-interval '1 hour' where board_id='synthetic'");
  payload = await change(writer, 11, 'visibility', 1);
  check(payload.timer.completed, true); check(payload.timer.running, false); check(payload.timer.baseline_ms, 0);
  payload = await change(writer, 12, 'adjust', 60); check(payload.timer.completed, true);
  payload = await change(writer, 13, 'start'); check(payload.timer.running, false);
  payload = await change(writer, 14, 'reset'); check(payload.timer.completed, false);
  check(payload.timer.baseline_ms, 1000);
  // Individual viewer, globally disabled editor, expired member, spoofed admin.
  await admin.query("update boards set students_can_write=false where id='synthetic'");
  await denied(change(editorClient, 15, 'start'));
  await admin.query("update boards set students_can_write=true where id='synthetic'");
  await admin.query("update board_members set expires_at=clock_timestamp()-interval '1 second' where user_id=$1", [editor]);
  await denied(change(editorClient, 15, 'start'));
  await noAccess.query("select set_config('request.jwt.claims','{\"user_metadata\":{\"is_admin\":true}}',false)");
  await denied(get(noAccess));
  check((await noAccess.query("select * from board_timers")).rowCount, 0);
  // Authenticated anonymous users are still bound to explicit membership.
  await editorClient.query("select set_config('request.jwt.claims','{\"is_anonymous\":true}',false)");
  await admin.query("update board_members set expires_at=null where user_id=$1", [editor]);
  check((await change(editorClient, 15, 'visibility', 1)).timer.revision, 16);
  await denied(editorClient.query("select create_board('guest-new','Forbidden')"));
  // Hash-only links and revocation semantics remain authoritative.
  const link = (await writer.query("select create_board_share_link('synthetic','viewer',null) as link")).rows[0].link;
  check((await admin.query("select token_hash = $1 as plaintext from board_share_links where id=$2", [link.rawToken, link.id])).rows[0].plaintext, false);
  await denied(reader.query("select create_board_share_link('synthetic','editor',null)"));
  check((await noAccess.query("select redeem_board_share_link($1) as link", [link.rawToken])).rows[0].link.permission, 'viewer');
  await writer.query("select revoke_board_share_link($1)", [link.id]);
  await assert.rejects(noAccess.query("select redeem_board_share_link($1)", [link.rawToken])); assertions++;
  // Two DB clients save different elements concurrently, preserving existing data.
  const shardIds = new Map((await admin.query("select id,element_shard_id(id) as shard from unnest(array['first','second']) as id")).rows.map(row => [row.id, row.shard]));
  const mutations = id => [{ elementId: id, shardId: shardIds.get(id),
    action: 'set', data: { id, type: 'text', text: id, x: 0, y: 0 },
    updatedAt: Date.now(), updatedByClientId: id }];
  await Promise.all([writer.query("select apply_board_mutations('synthetic',$1)", [JSON.stringify(mutations('first'))]),
    editorClient.query("select apply_board_mutations('synthetic',$1)", [JSON.stringify(mutations('second'))])]);
  const restoredBoard = (await reader.query("select get_board_state('synthetic') as payload")).rows[0].payload;
  check(restoredBoard.board.current_revision, 2);
  check(restoredBoard.shards.flatMap(shard => Object.keys(shard.elements)).sort(), ['existing', 'first', 'second']);
  check(restoredBoard.assets.length, 2);
  // UX-1 covers persist through the existing shape infrastructure and viewer RLS.
  const coverId='cover-ux1';
  const coverShard=(await admin.query('select element_shard_id($1) as shard',[coverId])).rows[0].shard;
  const coverMutation=revealed=>[{elementId:coverId,shardId:coverShard,action:'set',data:{id:coverId,type:'shape',shapeType:'rect',answerCover:true,revealed,x:10,y:20,width:200,height:100,zIndex:9,text:'',color:'#334155',borderColor:'#94a3b8'},updatedAt:Date.now(),updatedByClientId:owner}];
  await writer.query("select apply_board_mutations('synthetic',$1)",[JSON.stringify(coverMutation(false))]);
  await denied(reader.query("select apply_board_mutations('synthetic',$1)",[JSON.stringify(coverMutation(true))]));
  await writer.query("select apply_board_mutations('synthetic',$1)",[JSON.stringify(coverMutation(true))]);
  const viewerReload=(await reader.query("select get_board_state('synthetic') as payload")).rows[0].payload;
  check(viewerReload.shards.flatMap(s=>Object.values(s.elements)).find(e=>e.id===coverId).revealed,true);
  // New lesson copies default private, without inherited membership/share links.
  await writer.query("select create_board('ux1-copy','Copied lesson','','Teacher','','',false,'initializing')");
  check((await admin.query("select access_mode,status from boards where id='ux1-copy'")).rows[0],{access_mode:'private',status:'initializing'});
  check((await admin.query("select count(*)::int as count from board_members where board_id='ux1-copy'")).rows[0].count,0);
  check((await admin.query("select count(*)::int as count from board_share_links where board_id='ux1-copy'")).rows[0].count,0);
  await denied(reader.query("select get_board_state('ux1-copy')"));
  await writer.query("select finalize_board_initialization('ux1-copy')");
  check((await admin.query("select status from boards where id='ux1-copy'")).rows[0].status,'ready');
  // Same board ids in another database must have the same generated fresh schema.
  const upgradeDefs = (await admin.query("select proname,pg_get_functiondef(oid) as body from pg_proc where pronamespace='public'::regnamespace order by proname,oid::regprocedure::text")).rows;
  await cluster.createDatabase('fresh_schema');
  const fresh = cluster.getPgClient('fresh_schema'); clients.push(fresh); await fresh.connect();
  await fresh.query(bootstrap); await fresh.query(await fs.readFile('supabase-schema.sql', 'utf8'));
  check((await fresh.query("select proname,pg_get_functiondef(oid) as body from pg_proc where pronamespace='public'::regnamespace order by proname,oid::regprocedure::text")).rows, upgradeDefs);
  check((await admin.query("select relrowsecurity from pg_class where oid='board_timers'::regclass")).rows[0].relrowsecurity, true);
  check((await admin.query("select has_table_privilege('authenticated','board_timers','UPDATE') as allowed")).rows[0].allowed, false);
  check((await admin.query("select has_function_privilege('anon','transition_board_timer(text,bigint,text,integer)','EXECUTE') as allowed")).rows[0].allowed, false);
  const insecure = await admin.query("select proname from pg_proc where pronamespace='public'::regnamespace and prosecdef and (not proconfig @> array['search_path=\"\"'] or has_function_privilege('anon',oid,'EXECUTE'))");
  check(insecure.rows, []);
  console.log(`Isolated PostgreSQL: ${names.length} upgrade migrations + canonical fresh schema; ${assertions} assertions passed.`);
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  await cluster.stop();
}
