'use strict';

/**
 * dao/match.dao.js —— 对局域 SQL 集中管理（match / match_player / match_round / match_snapshot / idempotency）
 *
 * 设计约定：
 *   - 所有 SQL 只出现在本文件，service 不拼裸 SQL；
 *   - 通过构造参数注入 db（{query, getPool}），单测可换成假实现；
 *   - JSON 列统一由 json() 转换，避免不同 mysql2 版本行为差异。
 */

/** 表名白名单，防止字段名来自外部时拼进 SQL */
const MATCH_FIELDS = ['seed', 'round', 'status', 'version'];
const PLAYER_FIELDS = [
  'hp', 'gold', 'level', 'exp', 'win_streak',
  'board_json', 'bench_json', 'pool_json', 'shop_json',
  'is_ai', 'eliminated', 'eliminated_round', 'rank',
];

/** 把对象序列化为 JSON 列所需的字符串 */
function json(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/** 生成 `a=?, b=?` 片段，只接受白名单字段 */
function assignments(fields, allowed) {
  const picked = fields.filter((key) => allowed.includes(key));
  if (picked.length === 0) throw new Error('dao: 没有可更新的字段');
  return picked.map((key) => `\`${key}\` = ?`).join(', ');
}

/** 把行里的 JSON 列字符串解析回对象 */
function parsePlayer(row) {
  if (!row) return null;
  return {
    ...row,
    board: typeof row.board_json === 'string' ? JSON.parse(row.board_json) : row.board_json || [],
    bench: typeof row.bench_json === 'string' ? JSON.parse(row.bench_json) : row.bench_json || [],
    pool: typeof row.pool_json === 'string' ? JSON.parse(row.pool_json) : row.pool_json || [],
    shop: typeof row.shop_json === 'string' ? JSON.parse(row.shop_json) : row.shop_json || [],
  };
}

/** 把行里的战报 JSON 解析回对象 */
function parseRound(row) {
  if (!row) return null;
  return {
    ...row,
    battleLog:
      typeof row.battle_log === 'string' ? JSON.parse(row.battle_log) : row.battle_log || null,
    playerResults:
      typeof row.player_results === 'string'
        ? JSON.parse(row.player_results)
        : row.player_results || null,
  };
}

/**
 * 创建对局 DAO。
 * @param {{query:Function, getPool:Function}} db 数据库连接封装
 * @returns {Object} DAO 方法集合
 */
function createMatchDao(db) {
  /** 在某个连接上执行查询；没有连接时走连接池 */
  const run = async (sql, params, conn) => {
    if (conn) {
      const [rows] = await conn.query(sql, params);
      return rows;
    }
    return db.query(sql, params);
  };

  /**
   * 在单事务内执行回调，自动 COMMIT / ROLLBACK / RELEASE。
   * @template T
   * @param {(conn:Object)=>Promise<T>} fn 事务体
   * @returns {Promise<T>} 回调结果
   */
  const withTransaction = async (fn) => {
    const conn = await db.getPool().getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  };

  return {
    withTransaction,

    /* ---------------- match ---------------- */

    async createMatch(seed, conn) {
      const result = await run('INSERT INTO `match` (seed, round, status, version) VALUES (?, 1, ?, 0)', [seed, 'running'], conn);
      return result.insertId;
    },

    getMatch(matchId, conn) {
      return run('SELECT * FROM `match` WHERE id = ? LIMIT 1', [matchId], conn).then((rows) => rows[0] || null);
    },

    listMatches(status, page, pageSize) {
      const where = status ? 'WHERE status = ?' : '';
      const params = status ? [status] : [];
      return run(
        `SELECT * FROM \`match\` ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize],
      );
    },

    async updateMatch(matchId, fields, conn, expectedVersion) {
      const keys = Object.keys(fields).filter((key) => MATCH_FIELDS.includes(key));
      const sets = assignments(keys, MATCH_FIELDS);
      const params = keys.map((key) => (key === 'version' ? fields[key] : fields[key]));
      let sql = `UPDATE \`match\` SET ${sets} WHERE id = ?`;
      params.push(matchId);
      if (expectedVersion !== undefined) {
        sql += ' AND version = ?';
        params.push(expectedVersion);
      }
      const result = await run(sql, params, conn);
      if (result.affectedRows === 0) {
        const err = new Error('version_conflict');
        err.code = 'VERSION_CONFLICT';
        throw err;
      }
      return result;
    },

    lockMatch(matchId, conn) {
      return run('SELECT * FROM `match` WHERE id = ? FOR UPDATE', [matchId], conn).then((rows) => rows[0] || null);
    },

    /** 级联删除一局（测试清理 / DELETE 接口用） */
    deleteMatch(matchId) {
      return run('DELETE FROM `match` WHERE id = ?', [matchId]);
    },

    /* ---------------- match_player ---------------- */

    async createPlayer(row, conn) {
      const result = await run(
        `INSERT INTO match_player
          (match_id, player_index, hp, gold, level, exp, win_streak,
           board_json, bench_json, pool_json, shop_json, is_ai, eliminated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          row.matchId, row.playerIndex, row.hp, row.gold, row.level, row.exp, row.winStreak,
          json(row.board), json(row.bench), json(row.pool), json(row.shop), row.isAi ? 1 : 0,
        ],
        conn,
      );
      return result.insertId;
    },

    getPlayers(matchId, conn) {
      return run('SELECT * FROM match_player WHERE match_id = ? ORDER BY player_index', [matchId], conn).then(
        (rows) => rows.map(parsePlayer),
      );
    },

    getPlayer(matchId, playerIndex, conn) {
      return run(
        'SELECT * FROM match_player WHERE match_id = ? AND player_index = ? LIMIT 1',
        [matchId, playerIndex],
        conn,
      ).then((rows) => parsePlayer(rows[0]));
    },

    lockPlayer(playerId, conn) {
      return run('SELECT * FROM match_player WHERE id = ? FOR UPDATE', [playerId], conn).then(
        (rows) => parsePlayer(rows[0]),
      );
    },

    async updatePlayer(playerId, fields, conn) {
      const keys = Object.keys(fields).filter((key) => PLAYER_FIELDS.includes(key));
      const sets = assignments(keys, PLAYER_FIELDS);
      const params = keys.map((key) => {
        if (['board_json', 'bench_json', 'pool_json', 'shop_json'].includes(key)) return json(fields[key]);
        return fields[key];
      });
      params.push(playerId);
      return run(`UPDATE match_player SET ${sets} WHERE id = ?`, params, conn);
    },

    async updateAllPlayers(matchId, fields, conn) {
      const keys = Object.keys(fields).filter((key) => PLAYER_FIELDS.includes(key));
      const sets = assignments(keys, PLAYER_FIELDS);
      const params = keys.map((key) =>
        ['board_json', 'bench_json', 'pool_json', 'shop_json'].includes(key) ? json(fields[key]) : fields[key],
      );
      params.push(matchId);
      return run(`UPDATE match_player SET ${sets} WHERE match_id = ?`, params, conn);
    },

    /* ---------------- match_round ---------------- */

    async insertRound(matchId, roundNo, battleLog, playerResults, conn) {
      const result = await run(
        'INSERT INTO match_round (match_id, round_no, battle_log, player_results) VALUES (?, ?, ?, ?)',
        [matchId, roundNo, json(battleLog), json(playerResults)],
        conn,
      );
      return result.insertId;
    },

    getRound(matchId, roundNo, conn) {
      return run(
        'SELECT * FROM match_round WHERE match_id = ? AND round_no = ? LIMIT 1',
        [matchId, roundNo],
        conn,
      ).then((rows) => parseRound(rows[0]));
    },

    listRounds(matchId) {
      return db
        .query('SELECT * FROM match_round WHERE match_id = ? ORDER BY round_no', [matchId])
        .then((rows) => rows.map(parseRound));
    },

    /* ---------------- match_snapshot ---------------- */

    async insertSnapshot(matchId, roundNo, state, conn) {
      const result = await run(
        'INSERT INTO match_snapshot (match_id, round_no, state_json) VALUES (?, ?, ?)',
        [matchId, roundNo, json(state)],
        conn,
      );
      return result.insertId;
    },

    listSnapshots(matchId, conn) {
      return run(
        'SELECT id, match_id, round_no, create_time FROM match_snapshot WHERE match_id = ? ORDER BY round_no DESC',
        [matchId],
        conn,
      );
    },

    getSnapshot(matchId, snapshotId, conn) {
      return run(
        'SELECT * FROM match_snapshot WHERE match_id = ? AND id = ? LIMIT 1',
        [matchId, snapshotId],
        conn,
      ).then((rows) => {
        if (!rows[0]) return null;
        return {
          ...rows[0],
          state:
            typeof rows[0].state_json === 'string'
              ? JSON.parse(rows[0].state_json)
              : rows[0].state_json,
        };
      });
    },

    latestSnapshot(matchId, conn) {
      return run(
        'SELECT * FROM match_snapshot WHERE match_id = ? ORDER BY round_no DESC, id DESC LIMIT 1',
        [matchId],
        conn,
      ).then((rows) => {
        if (!rows[0]) return null;
        return {
          ...rows[0],
          state:
            typeof rows[0].state_json === 'string'
              ? JSON.parse(rows[0].state_json)
              : rows[0].state_json,
        };
      });
    },

    /* ---------------- idempotency ---------------- */

    getIdempotency(requestId, conn) {
      return run(
        'SELECT result_json, expire_time FROM idempotency_record WHERE client_request_id = ? LIMIT 1',
        [requestId],
        conn,
      ).then((rows) => rows[0] || null);
    },

    async saveIdempotency(requestId, scene, result, ttlSeconds, conn) {
      const expire = new Date(Date.now() + ttlSeconds * 1000);
      await run(
        `INSERT INTO idempotency_record (client_request_id, scene, result_json, expire_time)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE result_json = VALUES(result_json), expire_time = VALUES(expire_time)`,
        [requestId, scene, json(result), expire],
        conn,
      );
    },
  };
}

module.exports = { createMatchDao, parsePlayer, parseRound, json };
