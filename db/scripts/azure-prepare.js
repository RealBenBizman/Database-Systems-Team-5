/*
   scripts/azure-prepare.js - make copies of the project's SQL files that run on Azure SQL Database

   Run from the repo root:   npm run azure:prepare

   What it does
     - Reads every .sql file under db/ (the lead's and the other parts').
     - Writes a changed copy of each into db/azure-build/ (same sub-folders).
       The originals are never touched, so local SQL Server Express keeps working.
     - Changes made in the copies:
         1) "USE pos_store;" lines are commented out. Azure SQL Database cannot switch
            databases with USE; you connect straight to pos_store instead.
         2) The "nested triggers" checks that read sys.configurations are removed
            (seed.sql) or answered with 1 (the test and verify grids). Azure SQL does not
            let you change that setting; the trigger tests prove the chain really works.
     - Skips create_app_login.sql (SQL Server only) and create_app_user_azure.sql (already
       written for Azure; run it as it is).
     - Prints a warning for every line that still uses something Azure SQL may refuse,
       so you can fix it by hand before running it.
     - Prints the order to run the copies in.
   It changes nothing in any database. db/azure-build/ is generated: do not commit it.
*/
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dbDir = path.join(root, 'db');
const outDir = path.join(dbDir, 'azure-build');
const SKIP_FILES = new Set(['create_app_login.sql', 'create_app_user_azure.sql']);

// ------------------------------------------------------------- transforms
const USE_LINE = /^([ \t]*)USE[ \t]+\[?pos_store\]?[ \t]*;?[ \t]*(\r?)$/gim;
const NESTED_IF = /IF \(SELECT CAST\(value_in_use AS INT\) FROM sys\.configurations WHERE name = 'nested triggers'\) <> 1\s+THROW[^;]*;/g;
const NESTED_VALUE = /\(SELECT CAST\(value_in_use AS NVARCHAR\(40\)\) FROM sys\.configurations WHERE name = 'nested triggers'\)/g;

function transform(text) {
  const changes = { use: 0, nestedCheck: 0, nestedValue: 0 };
  let out = text.replace(USE_LINE, (_m, indent, cr) => {
    changes.use += 1;
    return `${indent}-- [azure] USE pos_store removed: connect to the pos_store database directly${cr}`;
  });
  out = out.replace(NESTED_IF, () => {
    changes.nestedCheck += 1;
    return '-- [azure] nested-triggers check removed: sys.configurations is not used on Azure SQL; the trigger tests prove the chain works.';
  });
  out = out.replace(NESTED_VALUE, () => {
    changes.nestedValue += 1;
    return "'1'";
  });
  return { out, changes };
}

// ------------------------------------------------------- things to look at
const RISKY = [
  [/^\s*USE\s+(?!pos_store\b)/i, 'USE of another database'],
  [/\bUSE\s+master\b/i, 'USE master'],
  [/\bCREATE\s+LOGIN\b|\bALTER\s+LOGIN\b|\bDROP\s+LOGIN\b|\bFOR\s+LOGIN\b/i, 'server logins (use a contained user: see create_app_user_azure.sql)'],
  [/\bCREATE\s+DATABASE\b|\bALTER\s+DATABASE\b|\bDROP\s+DATABASE\b/i, 'CREATE/ALTER/DROP DATABASE (the database is created in the portal)'],
  [/sys\.configurations|\bsp_configure\b|\bRECONFIGURE\b/i, 'server settings'],
  [/\bxp_\w+|\bOPENROWSET\b|\bBULK\s+INSERT\b|\bmsdb\b|\bsys\.dm_os_/i, 'feature not available in Azure SQL Database'],
  [/\bEXECUTE\s+AS\s+LOGIN\b/i, 'EXECUTE AS LOGIN (use EXECUTE AS USER)'],
  [/\bFILESTREAM\b|\bFILEGROUP\b|\bBACKUP\s+DATABASE\b|\bRESTORE\s+DATABASE\b/i, 'files / backups'],
];

function walk(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === outDir) continue;
      found.push(...walk(full));
    } else if (entry.isFile() && /\.sql$/i.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function stage(rel) {
  const base = path.basename(rel).toLowerCase();
  if (/^schema/.test(base)) return 1;
  if (/^trigger/.test(base)) return 2;
  if (/^view/.test(base)) return 3;
  if (/^test_triggers/.test(base)) return 5; // needs a database with no reward program, so it runs before the seed
  if (/^seed/.test(base)) return 6;
  if (/^verify/.test(base)) return 8;
  if (/^drop/.test(base)) return 9;
  if (/^test/.test(base)) return 7;
  return 4; // stored procedures and other parts' objects (for example sp_checkout.sql)
}

// -------------------------------------------------------------------- run
if (!fs.existsSync(dbDir)) {
  console.error('No db/ folder here. Run this from the repo root.');
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
const files = walk(dbDir).filter((f) => !SKIP_FILES.has(path.basename(f).toLowerCase())).sort();
if (!files.length) {
  console.error('No .sql files found under db/.');
  process.exit(1);
}

const written = [];
const warnings = [];
for (const file of files) {
  const rel = path.relative(dbDir, file);
  const { out, changes } = transform(fs.readFileSync(file, 'utf8'));
  const target = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, out);
  written.push({ rel, changes });

  out.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*--/.test(line)) return; // comment line
    for (const [pattern, why] of RISKY) {
      if (pattern.test(line)) warnings.push(`${rel}:${i + 1}  ${why}\n        ${line.trim().slice(0, 110)}`);
    }
  });
}

console.log(`Wrote ${written.length} file(s) to db/azure-build/\n`);
for (const { rel, changes } of written) {
  const bits = [];
  if (changes.use) bits.push(`${changes.use} USE line(s) commented out`);
  if (changes.nestedCheck) bits.push('nested-triggers check removed');
  if (changes.nestedValue) bits.push(`${changes.nestedValue} nested-triggers value(s) set to 1`);
  console.log(`  ${rel.padEnd(34)} ${bits.join('; ') || 'unchanged'}`);
}

console.log('\nRun these in db/azure-build/, connected to the pos_store database as the server admin, in this order:');
const order = written
  .filter((w) => stage(w.rel) !== 9)
  .sort((a, b) => stage(a.rel) - stage(b.rel) || a.rel.localeCompare(b.rel));
order.forEach((w, i) => {
  const s = stage(w.rel);
  const note = s === 7 ? '  (optional test)' : s === 8 ? '  (final check)' : '';
  console.log(`  ${String(i + 1).padStart(2)}. ${w.rel}${note}`);
});
console.log('  then: db/core/create_app_user_azure.sql (original location, not the build folder)');
console.log('  (drop.sql is not in the list: a new database is empty. Use it only to reset.)');

if (warnings.length) {
  console.log(`\n${warnings.length} line(s) to check by hand (Azure SQL may refuse them):`);
  for (const w of warnings) console.log(`  ${w}`);
} else {
  console.log('\nNo risky statements left in the copies.');
}
