/*
    scripts/check-db.js - "can Node reach my database?"
    Run from the repo root: npm run check:db
    It changes nothing. The password is never printed.
*/
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failures = 0;

function show(status, label, detail) {
    if (status == 'FAIL') failures += 1;
    console.log(`${status.padEnd(4)}  ${label}${detail ? '  -  ' + detail : ''}`);
}
const pass = (l, d) => show('PASS', l, d);
const fail = (l, d) => show('FAIL', l, d);
const info = (l, d) => show('INFO', l, d);
const hint = (text) => console.log(`           -> ${text}`);

//1. Node
const [major, minor] = process.versions.node.split('.').map(Number);
const okNode = major > 22 ? major !== 23 : major === 22 && minor >= 12;
if (okNode) pass('Node version', `v${process.versions.node}`);
else {
    fail('Node version', `v${process.versions.node}; this projects needs 22.12 or newer (22 or 24 are the long-term releases)`);
    hint('Install the current LTS from https://nodejs.org, then close and reopen VS Code.');
}

//2. packages
const packages = ['mssql', 'bcrypt', 'jsonwebtoken'];
let packagesOk = true;
for (const name of packages) {
    try {
        require.resolve(name, { paths: [root] });
    }
    catch (_) {
        packagesOk = false;
        fail(`Package ${name}`, 'not installed');
    }
}
if (!packagesOk) {
    hint('Run: npm install');
    process.exit(1);
}

let bcrypt;
try {
    bcrypt = require('bcrypt');
    bcrypt.hashSync('check', 4);
    pass('bcrypt native module loads');
}
catch (err) {
    fail('bcrypt native module', err.message.split('\n')[0]);
    hint('Delete node_modules and run: npm install (on Windows you may need the "Desktop development with C++" build tools if no prebuilt file exists for your Node version).');
}

//3. Settings
const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile)) {
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envFile);
        pass('.env.local found and loaded')
    }
    else {
        fail('.env.local', 'this Node is too old to read it');
    }
}
else {
    info('.env.local not found', 'using the variables already set in this terminal');
    hint('Copy .env.example to .env.local and fill it in.');
}

const required = ['DB_SERVER', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET'];
const missing = required.filter((n) => !process.env[n]);
if (missing.length) {
    fail('Settings', `missing: ${missing.join(', ')}`);
    process.exit(1);
}
const target = process.env.DB_INSTANCE
    ? `${process.env.DB_SERVER}\\${process.env.DB_INSTANCE} (named instance)`
    : `${process.env.DB_SERVER}:${process.env.DB_PORT || 1433}`;
pass('Setting present', `${target}, database ${process.env.DB_DATABASE}, login ${process.env.DB_USER}`);
if (process.env.JWT_SECRET.length < 32) fail('JWT_SECRET', 'shorter tahn 32 characters');

//4. Connection
const db = require('../lib/db');

function explain(err) {
  const text = `${err.code || ''} ${err.message || ''}`;
  if (/ELOGIN|Login failed/i.test(text)) {
    hint('The server answered but refused the login: wrong user or password, the login does not exist, SQL logins are off (server must be in "SQL Server and Windows Authentication" mode), or the login has no user in pos_store. See db/core/create_app_login.sql.');
  } else if (/EINSTLOOKUP|instance/i.test(text)) {
    hint('Named instance not found: start the "SQL Server Browser" service (services.msc), or use DB_PORT with a fixed port instead of DB_INSTANCE.');
  } else if (/self[- ]signed|certificate|CERT_/i.test(text)) {
    hint('Certificate not trusted: for a local server set DB_TRUST_SERVER_CERT=true in .env.local.');
  } else if (/ESOCKET|ECONNREFUSED|ETIMEOUT|ENOTFOUND|Failed to connect/i.test(text)) {
    hint('Nothing answered. Check that the SQL Server service is running, that TCP/IP is enabled (SQL Server Configuration Manager > SQL Server Network Configuration > Protocols for SQLEXPRESS), that the service was restarted after changing it, and that DB_SERVER / DB_PORT / DB_INSTANCE are right.');
  }
}

(async () => {
    const started = Date.now();
    try {
        await db.getPool();
        pass('Connected to SQL Server', `${Date.now() - started} ms`);
    }
    catch(err) {
        fail('Connection', `${err.code || 'error'}: ${err.message}`);
        explain(err);
        process.exit(1);
    }

    try {
    // 5. contents
    const who = (await db.query(
      `SELECT DB_NAME() AS db, SUSER_SNAME() AS login_name,
              CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR(40)) AS version,
              CAST(SERVERPROPERTY('Edition') AS VARCHAR(80)) AS edition`)).recordset[0];
    pass('Database', `${who.db}, signed in as ${who.login_name}`);
    info('SQL Server', `${who.version}, ${who.edition}`);
    if (who.db !== 'pos_store') fail('Database name', 'expected pos_store');

    const tables = (await db.query('SELECT COUNT(*) AS n FROM sys.tables')).recordset[0].n;
    if (tables === 27) pass('Tables visible', '27');
    else fail('Tables visible', `${tables} (expected 27)`);

    const counts = (await db.query(
      `SELECT (SELECT COUNT(*) FROM EMPLOYEE WHERE Marked_for_deletion = 0) AS employees,
              (SELECT COUNT(*) FROM CUSTOMER WHERE Marked_for_deletion = 0) AS customers,
              (SELECT COUNT(*) FROM PRODUCT  WHERE Marked_for_deletion = 0) AS products`)).recordset[0];
    if (counts.employees === 3 && counts.customers === 7 && counts.products === 24) {
      pass('Seed data', `${counts.employees} employees, ${counts.customers} customers, ${counts.products} products`);
    } else {
      info('Seed data', `${counts.employees} employees, ${counts.customers} customers, ${counts.products} products (the seed gives 3 / 7 / 24)`);
      if (counts.employees === 0) hint('Run seed.sql if you want the demo accounts.');
    }

    // 6. seeded password hash works from Node
    const mgr = (await db.query(
      `SELECT Password_hash FROM EMPLOYEE WHERE Email = @email AND Marked_for_deletion = 0`,
      { email: 'manager@posstore.test' })).recordset[0];
    if (mgr && bcrypt) {
      const ok = await bcrypt.compare('Password123!', mgr.Password_hash);
      if (ok) pass('Seed password check', 'manager@posstore.test accepts the seed password through bcrypt');
      else fail('Seed password check', 'the stored hash does not match the seed password');
    }

    // 7. permissions
    const perm = (await db.query(
      `SELECT HAS_PERMS_BY_NAME('dbo.PRODUCT',   'OBJECT', 'SELECT') AS sel,
              HAS_PERMS_BY_NAME('dbo.PRODUCT',   'OBJECT', 'UPDATE') AS upd,
              HAS_PERMS_BY_NAME('dbo.PRODUCT',   'OBJECT', 'DELETE') AS del_product,
              HAS_PERMS_BY_NAME('dbo.CART_ITEM', 'OBJECT', 'DELETE') AS del_cart`)).recordset[0];
    if (perm.sel === 1 && perm.upd === 1) pass('App can read and update tables');
    else fail('Permissions', 'this login cannot SELECT/UPDATE PRODUCT');
    if (perm.del_product === 0 && perm.del_cart === 1) {
      pass('Least privilege', 'DELETE is allowed on CART_ITEM only');
    } else if (perm.del_product === 1) {
      info('Least privilege', 'this login CAN delete product rows; fine for a first test with an admin login, but the app should use pos_app (db/core/create_app_login.sql)');
    } else {
      info('Least privilege', 'this login cannot delete cart rows, which checkout needs');
    }
  } catch (err) {
    fail('Query', `${err.code || 'error'}: ${err.message}`);
  } finally {
    try { (await db.getPool()).close(); } catch (_) { /* ignore */ }
  }

  console.log(failures ? `\n${failures} problem(s) found.` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})();