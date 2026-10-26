--USE pos_store;
--SELECT name, OBJECT_NAME(parent_id) AS on_table, is_disabled
--FROM   sys.triggers
--ORDER BY name;

--USE master;
--SELECT s.session_id, s.login_name, s.host_name, s.program_name, s.status
--FROM sys.dm_exec_sessions s
--WHERE s.database_id = DB_ID('pos_store')
--  AND s.session_id <> @@SPID;

-- USE master;
-- ALTER DATABASE pos_store SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
-- DROP DATABASE pos_store;
-- CREATE DATABASE pos_store;
-- GO

-- USE pos_store;
-- SELECT 'tables' AS item, COUNT(*) AS actual, 27 AS expected FROM sys.tables
-- UNION ALL SELECT 'foreign keys', COUNT(*), 43 FROM sys.foreign_keys
-- UNION ALL SELECT 'triggers', COUNT(*), 4 FROM sys.triggers WHERE parent_class = 1;--

-- USE master;
-- SELECT SERVERPROPERTY('IsIntegratedSecurityOnly') AS windows_only;   -- must be 0
-- SELECT name, is_disabled FROM sys.server_principals WHERE name = 'pos_app';   -- must return 1 row
-- EXEC xp_readerrorlog 0, 1, N'Login failed', N'pos_app';   -- the reason, with a "State" number
-- SELECT SERVERPROPERTY('IsIntegratedSecurityOnly') AS windows_only;