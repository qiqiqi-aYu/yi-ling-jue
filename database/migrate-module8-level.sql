-- =============================================================================
-- 模块 8 增量迁移：棋手等级经验与购买经验
-- =============================================================================
-- 适用场景：库已经由旧版 seed.sql 初始化过，不想整库重建时执行本脚本。
-- 全新初始化直接跑 schema.sql + seed.sql 即可（新版 seed 已包含这些数据）。
--
--   mysql -u root -p --default-character-set=utf8mb4 yi_ling_jue < database/migrate-module8-level.sql
--
-- 幂等：全部使用 REPLACE / INSERT ... ON DUPLICATE KEY UPDATE，可重复执行。
-- =============================================================================

SET NAMES utf8mb4;

-- ---------- 1. 升级经验表：1→2:1、2→3:2、3→4:4、4→5:8、5→6:16、6→7:24、7→8:32、8→9:40 ----------
-- 9 级 exp_to_next 填 0，表示「没有下一级」，由 engine/level.js 解释为封顶。
REPLACE INTO `level_config` (`level`, `exp_to_next`, `max_board_slots`, `refresh_cost`) VALUES
(1,  1, 1, 2),
(2,  2, 2, 2),
(3,  4, 3, 2),
(4,  8, 4, 2),
(5, 16, 5, 2),
(6, 24, 6, 3),
(7, 32, 7, 3),
(8, 40, 8, 4),
(9,  0, 9, 4);

-- ---------- 2. 经验相关全局参数 ----------
INSERT INTO `game_config` (`config_key`, `config_value`, `group_name`, `remark`) VALUES
('exp_per_round',  '1', 'economy', '每回合结算自动获得的经验'),
('buy_exp_gold',   '5', 'economy', '购买一次经验消耗的金币'),
('buy_exp_amount', '4', 'economy', '购买一次获得的经验')
ON DUPLICATE KEY UPDATE
  `config_value` = VALUES(`config_value`),
  `group_name`   = VALUES(`group_name`),
  `remark`       = VALUES(`remark`);
