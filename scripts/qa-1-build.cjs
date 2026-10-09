// Rebuild the QA base using only the public deployment's frontend configuration.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const s = fs.readFileSync('artifacts/qa-1/live-app.js', 'utf8');
const url = s.match(/https:\/\/[a-z]+\.supabase\.co/)?.[0];
const key = s.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0] || s.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)?.find(k => {
  try { return JSON.parse(Buffer.from(k.split('.')[1],'base64url')).role === 'anon'; } catch { return false; }
});
if (!url || !key) throw new Error('Public frontend configuration unavailable');
const env = { ...process.env, VITE_SUPABASE_URL:url, VITE_SUPABASE_PUBLISHABLE_KEY:key };
delete env.VITE_LOCAL_SANDBOX;
for (const args of [['node_modules/vite/bin/vite.js','build']]) {
  const r = spawnSync(process.execPath,args,{env,encoding:'utf8'});
  console.log(r.stdout); console.error(r.stderr); if (r.status !== 0) process.exit(r.status || 1);
}
require('esbuild').buildSync({entryPoints:['server.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',sourcemap:true,outfile:'dist/server.cjs'});
const live = JSON.parse(fs.readFileSync('artifacts/qa-1/public-results.json','utf8'));
const comparison = fs.readdirSync('dist/assets').filter(p => /^index-.*\.(js|css)$/.test(p)).map(p => {
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync('dist/assets/'+p)).digest('hex');
  return { file:p,sha256,matchesLive:live.http.some(a => a.sha256 === sha256) };
});
fs.writeFileSync('artifacts/qa-1/build-comparison.json',JSON.stringify({node:process.version,comparison},null,2));
console.log(JSON.stringify(comparison,null,2));
