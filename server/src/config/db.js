'use strict';

/**
 * config/db.js —— MySQL 连接池（仅做连接与查询，不含任何业务规则）
 * =============================================================================
 * 与 engine/ 的分工：
 *   db.js        负责「连数据库、执行 SQL」
 *   balance.loader.js 负责「把查出来的行变成 engine 能吃的对象」
 *   engine/      只做纯计算，永远不接触这个文件
 *
 * 连接参数全部来自环境变量（见 server/.env.example），默认值只为本地开发方便：
 *   DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
 * =============================================================================
 */

let pool = null;

/**
 * 尝试加载 .env（未安装 dotenv 时静默跳过，保证单测环境无需依赖）。
 * @returns {void}
 */
function loadEnvFile() {
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    require('dotenv').config();
  } catch (err) {
    // 没有 dotenv 就直接用系统环境变量，不影响运行
  }
}

/**
 * 读取连接配置（每次调用都重新读取环境变量，便于测试时覆盖）。
 * @returns {{host:string, port:number, user:string, password:string, database:string}}
 */
function getConnectionOptions() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD === undefined ? 'root' : process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'yi_ling_jue',
  };
}

/**
 * 获取（惰性创建）连接池。
 * @returns {import('mysql2/promise').Pool} 连接池
 */
function getPool() {
  if (pool) return pool;
  loadEnvFile();

  let mysql;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    mysql = require('mysql2/promise');
  } catch (err) {
    throw new Error(
      'db: 缺少 mysql2 依赖，请先在 server 目录执行 npm install 再启动（engine 单测不需要它）',
    );
  }

  const options = getConnectionOptions();
  pool = mysql.createPool({
    ...options,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
    queueLimit: 0,
    charset: 'utf8mb4',
    // DECIMAL / BIGINT 默认以字符串返回，避免精度丢失；
    // balance.loader.js 会显式做 Number() 转换并在注释里标明单位。
    decimalNumbers: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    timezone: 'local',
  });
  return pool;
}

/**
 * 执行查询并返回数据行。
 * @param {string} sql SQL 语句
 * @param {Array} [params] 占位符参数
 * @returns {Promise<Array<Object>>} 数据行
 */
async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

/**
 * 关闭连接池（进程退出 / 单测收尾用）。
 * @returns {Promise<void>}
 */
async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

module.exports = {
  getPool,
  query,
  closePool,
  getConnectionOptions,
};
