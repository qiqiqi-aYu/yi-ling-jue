'use strict';

const db = require('../config/db');
const { createMatchDao } = require('./match.dao');
const { createAdminDao } = require('./admin.dao');

/**
 * 统一 DAO 出口。service 只拿这一份实例，不直接碰 config/db。
 */
const dao = {
  ...createMatchDao(db),
  ...createAdminDao(db),
  /** 配置表 SQL 常量由 balance.loader 持有，这里只透传查询能力 */
  query: db.query,
};

module.exports = dao;
