import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const migrationsDir = path.join(root, 'supabase', 'migrations');
const migrationNames = (await readdir(migrationsDir))
  .filter((name) => name.endsWith('.sql'))
  .sort();

const expected = [
  '202608030001_fresh_whiteboard.sql',
  '202608050002_security_free_tier_hardening.sql',
  '202608060001_fix_share_link_pgcrypto.sql',
  '202608060002_fix_apply_board_mutations_jsonb_count.sql',
  '202608060003_fix_board_asset_upload.sql',
  '202608070001_add_individual_member_view_only.sql',
];

const failures = [];
if (JSON.stringify(migrationNames) !== JSON.stringify(expected)) {
  failures.push(`Unexpected migration order. Expected ${expected.join(', ')}, found ${migrationNames.join(', ')}.`);
}

const files = await Promise.all(migrationNames.map(async (name) => ({
  name,
  text: await readFile(path.join(migrationsDir, name), 'utf8'),
})));

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

function withoutStandaloneTransactionCommands(sql) {
  return sql
    .replace(/^\s*begin;\s*$/gim, '')
    .replace(/^\s*commit;\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n');
}

for (const { name, text } of files) {
  const executable = stripSqlComments(text);
  if (/\bjsonb_object_length\s*\(/i.test(executable)) {
    failures.push(`${name} contains unsupported jsonb_object_length().`);
  }
  if (/\bpg_catalog\.coalesce\s*\(/i.test(executable)) {
    failures.push(`${name} incorrectly schema-qualifies COALESCE.`);
  }
  if (/\b(?:board_id|p_board_id|owner_uid)\s+uuid\b/i.test(executable)) {
    failures.push(`${name} contains a UUID board/owner identifier; production uses text IDs.`);
  }
  if ((text.match(/\$\$/g) || []).length % 2 !== 0) {
    failures.push(`${name} has an unmatched $$ delimiter.`);
  }
}

const hardeningFiles = files.filter(({ name }) => name !== '202608030001_fresh_whiteboard.sql');
for (const { name, text } of hardeningFiles) {
  const functionBlocks = text.split(/create\s+or\s+replace\s+function/i).slice(1);
  for (const block of functionBlocks) {
    const signature = block.split(/\r?\n/, 1)[0].trim();
    const header = block.split('$$', 1)[0];
    if (/security\s+definer/i.test(header) && !/set\s+search_path\s*=\s*''/i.test(header)) {
      failures.push(`${name}: SECURITY DEFINER function ${signature} is missing an empty search_path.`);
    }
  }
}

const rootHardeningCopy = await readFile(path.join(root, '202608050002_security_free_tier_hardening.sql'), 'utf8');
const canonicalHardening = files.find(({ name }) => name === '202608050002_security_free_tier_hardening.sql')?.text;
if (!canonicalHardening || rootHardeningCopy !== canonicalHardening) {
  failures.push('The root hardening SQL copy does not match the canonical migration file.');
}

const generatedHeader = [
  '-- Consolidated schema generated from supabase/migrations.',
  '-- For a new project, run this entire file once. Existing projects should apply only unapplied migrations.',
  '-- The outer transaction prevents a partially hardened fresh installation if a later statement fails.',
  '',
  'begin;',
  '',
].join('\n');
const generatedBody = files.map(({ name, text }) => [
  '-- =====================================================================',
  `-- SOURCE: supabase/migrations/${name}`,
  '-- =====================================================================',
  withoutStandaloneTransactionCommands(text).trimEnd(),
  '',
].join('\n')).join('\n');
const expectedSchema = `${generatedHeader}${generatedBody}\ncommit;\n`;
const actualSchema = await readFile(path.join(root, 'supabase-schema.sql'), 'utf8');
if (actualSchema !== expectedSchema) {
  failures.push('supabase-schema.sql is not the exact generated concatenation of ordered migrations.');
}

if (failures.length) {
  console.error('Migration verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Migration verification passed for ${files.length} ordered files.`);
