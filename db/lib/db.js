/*
    lib/db.js - where we communicate with the SQL Server

    Environment variables (see .env.example):
      DB_SERVER, DB_DATABASE, DB_USER, DB_PASSWORD,
      DB_PORT (default 1433) or DB_INSTANCE (a named instance such as SQLEXPRESS);
        needs the SQL Server Browser service, and then the port is ignored),
      DB_ENCRYPT (default true), DB_TRUST_SERVER_CERT (default false)

    Always pass values as parameters (@name). Never build SQL by gluing strings.
    Every list or detail query must filter Marked_for_deletion = 0.
*/
const sql = require('mssql');

let poolPromise = null;

function flag(value, fallback) {
    if (value === undefined || value === '') return fallback;
    return String(value).toLowerCase() === 'true';
}

function buildConfig(env = process.env) {
    for (const name of ['DB_SERVER', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD']) {
        if (!env[name]) throw new Error('Missing environment variable ${name}');
    }
    const config = {
        server: env.DB_SERVER,
        database: env.DB_DATABASE,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        options: {
            encrypt: flag(env.DB_EBCRYPT, true),
            trustServerCertificate: flag(env.DB_TRUST_SERVER_CERT, false),
        },
        pool: { max: 5, min: 0, idleTimeoutMillis: 30000},
        connectionTimeout: 15000,
        requestTimeout: 15000,
    };
    if (env.DB_INSTANCE) {
        config.options.instanceName = env.DB_INSTANCE; //the port is found through SQL Server Browser
    }
    else {
        config.port = env.DB_PORT ? Number(env.DB_PORT) : 1433;
    }
    return config;
}

//One pool per server instance. Afailed connect is not cached, so the next
//request tries again.
function getPool() {
    if(!poolPromise) {
        poolPromise = new sql.ConnectionPool(buildConfig()).connect().catch((err) => {
            poolPromise = null;
            throw err;
        });
    }
    return poolPromise;
}

//parameters: {name: value} or {name: {type: sql.Int, value: 5}}
function bind(request, params) {
    for (const [name, p] of Object.entries(params || {})) {
        if (p != null && typeof p === 'object' && type in p && 'value' in p) {
            request.input(name, p.type, p.value);
        }
        else {
            request.input(name, p);
        }
    }
    return request;
}

async function query(text, params) {
    const pool = await getPool();
    return bind(pool.request(), params).query(text);
}

//Runs fn(tx) inside one transaction. tx.query(text, params) works like query().
//Commits when fn returns, rolls back and rethrows when fn throws.
async function withTransaction(fn) {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    const tx = {
        query: (text, params) => bind(new sql.Request(transaction), params).query(text),
    };
    try {
        const result = await fn(tx);
        await transaction.commit();
        return result;
    }
    catch(err) {
        try {
            await transaction.rollback();
        }
        catch (_) {
            //the transaction may already be rolled back by SQL Server; keep original error
        }
        throw err;
    }
}

//For tests only: forget the catched pool.
function _reset() {
    poolPromise = null;
}

module.exports = { sql, buildConfig, getPool, query, withTransaction, _reset};