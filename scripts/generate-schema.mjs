import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const migrationsDir = path.join(root, 'supabase', 'migrations');
const names = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();

function withoutStandaloneTransactionCommands(sql) {
  // Individual migrations may wrap themselves in BEGIN/COMMIT for SQL Editor
  // use. The consolidated fresh-project schema has one outer transaction, so
  // remove only standalone transaction-command lines from its source sections.
  return sql
    .replace(/^\s*begin;\s*$/gim, '')
    .replace(/^\s*commit;\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n');
}

const header = [
  '-- Consolidated schema generated from supabase/migrations.',
  '-- For a new project, run this entire file once. Existing projects should apply only unapplied migrations.',
  '-- The outer transaction prevents a partially hardened fresh installation if a later statement fails.',
  '',
  'begin;',
  '',
].join('\n');
const sections = [];
for (const name of names) {
  const text = withoutStandaloneTransactionCommands(
    await readFile(path.join(migrationsDir, name), 'utf8')
  );
  sections.push([
    '-- =====================================================================',
    `-- SOURCE: supabase/migrations/${name}`,
    '-- =====================================================================',
    text.trimEnd(),
    '',
  ].join('\n'));
}
await writeFile(
  path.join(root, 'supabase-schema.sql'),
  `${header}${sections.join('\n')}\ncommit;\n`,
  'utf8'
);
console.log(`Generated atomic supabase-schema.sql from ${names.length} migrations.`);
