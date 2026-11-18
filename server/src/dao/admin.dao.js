'use strict';

/**
 * dao/admin.dao.js —— 管理后台 SQL（admin_user / admin_log）
 */

/**
 * @param {{query:Function, getPool:Function}} db 数据库连接封装
 * @returns {Object} DAO
 */
function createAdminDao(db) {
  return {
    getByUsername(username) {
      return db.query('SELECT * FROM admin_user WHERE username = ? LIMIT 1', [username]).then((rows) => rows[0] || null);
    },

    getById(id) {
      return db.query('SELECT * FROM admin_user WHERE id = ? LIMIT 1', [id]).then((rows) => rows[0] || null);
    },

    async insertLog(adminId, action, target, detail) {
      await db.query(
        'INSERT INTO admin_log (admin_id, action, target, detail) VALUES (?, ?, ?, ?)',
        [adminId, action, target || null, detail ? JSON.stringify(detail) : null],
      );
    },

    listLogs(page, pageSize) {
      return db.query(
        'SELECT id, admin_id, action, target, detail, create_time FROM admin_log ORDER BY id DESC LIMIT ? OFFSET ?',
        [pageSize, (page - 1) * pageSize],
      );
    },
  };
}

module.exports = { createAdminDao };
