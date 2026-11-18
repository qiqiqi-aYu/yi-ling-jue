-- ==========================================
-- reset.sql 弈灵诀 数据库重置脚本
-- 用途：开发阶段清空全部表（含对局数据），重置后需重新执行 schema.sql / seed.sql
-- 警告：会删除所有数据，正式数据环境请勿执行
-- 执行顺序：reset.sql → schema.sql → seed.sql
-- 说明：schema.sql 本身带 DROP DATABASE，本脚本用于「不想重建库、只想清表」的场景
-- ==========================================
USE `yi_ling_jue`;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `admin_log`;
DROP TABLE IF EXISTS `idempotency_record`;
DROP TABLE IF EXISTS `match_snapshot`;
DROP TABLE IF EXISTS `match_round`;
DROP TABLE IF EXISTS `match_player`;
DROP TABLE IF EXISTS `match`;
DROP TABLE IF EXISTS `game_config`;
DROP TABLE IF EXISTS `shop_odds_config`;
DROP TABLE IF EXISTS `level_config`;
DROP TABLE IF EXISTS `card_pool_config`;
DROP TABLE IF EXISTS `hero_trait`;
DROP TABLE IF EXISTS `hero`;
DROP TABLE IF EXISTS `trait_level`;
DROP TABLE IF EXISTS `trait`;
DROP TABLE IF EXISTS `admin_user`;

SET FOREIGN_KEY_CHECKS = 1;
