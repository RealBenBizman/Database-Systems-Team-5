/*
   scripts/fix-api-paths.js - after "git mv api server": point file imports at server/

   Run once from the repo root:   node scripts/fix-api-paths.js          (shows what it would change)
                                  node scripts/fix-api-paths.js --write  (changes the files)

   Finds import strings such as  '../../api/auth/login'  or  jest.mock('../server/x')  in your
   JavaScript files that really point at the old api/ folder and rewrites them to server/.
   It checks where each path lands, so a src/api/ folder or a URL like '/api/orders' is left alone.
   It also lists lines that build the api path in some other way, to fix by hand.
*/
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const write = process.argv.includes('--write');
const SKIP = new Set(['node_modules', 'dist', '.git', '.vercel', 'coverage', 'server']);
const EXT = /\.(js|jsx|mjs|cjs)$/;
const IMPORT = /(['"`])((?:\.{1,2}\/)+)api\/(?!\[\.\.\.path\])/g;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('_backup')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (EXT.test(entry.name)) out.push(full);
  }
  return out;
}

let changedFiles = 0;
let changedLines = 0;
const manual = [];
for (const file of walk(root)) {
  const rel = path.relative(root, file);
  // these files talk about both folders on purpose
  if ([path.join('api', '[...path].js'), path.join('scripts', 'fix-api-paths.js'), path.join('tests', 'routes.test.js')].includes(rel)) continue;
  const text = fs.readFileSync(file, 'utf8');
  let count = 0;
  const next = text.replace(IMPORT, (match, quote, dots) => {
    const lands = path.resolve(path.dirname(file), dots, 'api');
    if (lands !== path.join(root, 'api')) return match; // some other api/ folder
    count += 1;
    return `${quote}${dots}server/`;
  });
  if (count) {
    changedFiles += 1;
    changedLines += count;
    console.log(`${write ? 'changed' : 'would change'}  ${rel}  (${count})`);
    if (write) fs.writeFileSync(file, next);
  }
  text.split(/\r?\n/).forEach((line, i) => {
    if (/path\.(join|resolve)\([^)]*['"]api['"]/.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
      manual.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
    }
  });
}
console.log(`\n${changedLines} import(s) in ${changedFiles} file(s) ${write ? 'rewritten' : 'found'}.`);
if (!write && changedLines) console.log('Run again with --write to apply them.');
if (manual.length) {
  console.log('\nLines that build the api path another way (check by hand, replace \'api\' with \'server\' if it means the endpoint files):');
  for (const m of manual) console.log(`  ${m}`);
}
