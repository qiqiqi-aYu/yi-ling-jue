-- ==========================================
-- seed.sql 弈灵诀 初始化配置数据（MySQL 8.0）
-- 数据库：yi_ling_jue
-- 执行顺序：schema.sql → 本脚本 → 设计说明书 §6.1 校验
-- 内容：6 种族 + 6 职业 + 24 英雄 + 卡池/等级/概率/全局参数
-- 口径：与 server/src/engine 完全一致（数值由 game_config / trait_level 驱动，引擎内不写死）
-- ==========================================
USE `yi_ling_jue`;
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 清空业务与配置表（保证脚本可重复执行）
DELETE FROM `admin_log`;
DELETE FROM `idempotency_record`;
DELETE FROM `match_snapshot`;
DELETE FROM `match_round`;
DELETE FROM `match_player`;
DELETE FROM `match`;
DELETE FROM `hero_trait`;
DELETE FROM `trait_level`;
DELETE FROM `hero`;
DELETE FROM `trait`;
DELETE FROM `card_pool_config`;
DELETE FROM `level_config`;
DELETE FROM `shop_odds_config`;
DELETE FROM `game_config`;
DELETE FROM `admin_user`;

-- ---------- 1. 后台管理员（admin / admin123，bcrypt cost=10）----------
INSERT INTO `admin_user` (`id`, `username`, `password`, `status`) VALUES
(1, 'admin', '$2a$10$7JB720yubVSZvUI0rEqK/.VqGOZTH.ulu33dHOiBE8ByOhJIrdAu2', 1);

-- ---------- 2. 羁绊定义：1-6 种族，7-12 职业 ----------
INSERT INTO `trait` (`id`, `trait_key`, `name`, `type`, `description`) VALUES
(1,  'race_human',       '人族',   1, '人族修士攻击凌厉，提升全队攻击力'),
(2,  'race_demon',       '妖族',   1, '妖族体魄雄浑，提升全队生命上限'),
(3,  'race_devil',       '魔族',   1, '魔族嗜血好斗，对残血目标造成额外伤害'),
(4,  'race_spirit',      '灵族',   1, '灵族与天地共鸣，法术造成伤害时吸取生命'),
(5,  'race_fairy',       '仙裔',   1, '仙裔道法通玄，提升技能伤害'),
(6,  'race_shade',       '冥灵',   1, '冥灵不入轮回，阵亡后有概率原地复生'),
(7,  'job_swordsman',    '剑修',   2, '剑修一剑破万法，提升暴击率'),
(8,  'job_talisman',     '符师',   2, '符师符箓速成，缩短技能冷却'),
(9,  'job_healer',       '丹医',   2, '丹医悬壶济世，提升治疗量'),
(10, 'job_beastmaster',  '御兽师', 2, '御兽师驱使灵兽，强化召唤物属性'),
(11, 'job_arranger',     '阵法师', 2, '阵法师布阵困敌，降低敌方攻速'),
(12, 'job_musician',     '乐伶',   2, '乐伶以音律鼓舞友军，提升友方攻速');

-- ---------- 3. 羁绊档位效果 ----------
-- 效果键约定见 docs/01 §5.3：百分比一律使用「整数百分数」（12 表示 12%），由 engine/stats.js 统一 /100；
-- hpThreshold / reviveChance 本身是小数，不做换算。
-- 档位规则：主档位 2/3/4。灵族(4)、符师(8)、御兽师(10) 全局仅 3 名英雄，
-- 因「同名英雄只计 1」，其第 4 档永远无法达成，故这三个羁绊封顶在 2/3 两档。
INSERT INTO `trait_level` (`trait_id`, `required_count`, `effect_json`) VALUES
-- 1 人族：全队攻击力
(1, 2, JSON_OBJECT('atkPercent', 12)),
(1, 3, JSON_OBJECT('atkPercent', 22)),
(1, 4, JSON_OBJECT('atkPercent', 32)),
-- 2 妖族：全队生命上限
(2, 2, JSON_OBJECT('hpPercent', 15)),
(2, 3, JSON_OBJECT('hpPercent', 26)),
(2, 4, JSON_OBJECT('hpPercent', 38)),
-- 3 魔族：对残血目标额外伤害
(3, 2, JSON_OBJECT('hpThreshold', 0.5, 'lowHpDmgPercent', 10)),
(3, 3, JSON_OBJECT('hpThreshold', 0.5, 'lowHpDmgPercent', 20)),
(3, 4, JSON_OBJECT('hpThreshold', 0.5, 'lowHpDmgPercent', 32)),
-- 4 灵族：法术吸血（仅 3 名英雄，封顶 3 档）
(4, 2, JSON_OBJECT('spellLifesteal', 8)),
(4, 3, JSON_OBJECT('spellLifesteal', 20)),
-- 5 仙裔：技能伤害
(5, 2, JSON_OBJECT('skillDmgPercent', 12)),
(5, 3, JSON_OBJECT('skillDmgPercent', 22)),
(5, 4, JSON_OBJECT('skillDmgPercent', 34)),
-- 6 冥灵：阵亡复生
(6, 2, JSON_OBJECT('reviveChance', 0.30, 'reviveHpPercent', 25)),
(6, 3, JSON_OBJECT('reviveChance', 0.50, 'reviveHpPercent', 35)),
(6, 4, JSON_OBJECT('reviveChance', 0.70, 'reviveHpPercent', 50)),
-- 7 剑修：暴击率，第 4 档追加暴击伤害
(7, 2, JSON_OBJECT('critRate', 12)),
(7, 3, JSON_OBJECT('critRate', 22)),
(7, 4, JSON_OBJECT('critRate', 32, 'critDmgPercent', 20)),
-- 8 符师：技能冷却缩减（仅 3 名英雄，封顶 3 档）
(8, 2, JSON_OBJECT('cdReduce', 12)),
(8, 3, JSON_OBJECT('cdReduce', 25)),
-- 9 丹医：治疗量
(9, 2, JSON_OBJECT('healPercent', 18)),
(9, 3, JSON_OBJECT('healPercent', 30)),
(9, 4, JSON_OBJECT('healPercent', 45)),
-- 10 御兽师：召唤物强化（仅 3 名英雄，封顶 3 档）
(10, 2, JSON_OBJECT('summonAtkPercent', 15)),
(10, 3, JSON_OBJECT('summonAtkPercent', 32, 'summonHpPercent', 30)),
-- 11 阵法师：降低敌方攻速
(11, 2, JSON_OBJECT('enemyAsSlowPercent', 10)),
(11, 3, JSON_OBJECT('enemyAsSlowPercent', 20)),
(11, 4, JSON_OBJECT('enemyAsSlowPercent', 32)),
-- 12 乐伶：提升友方攻速
(12, 2, JSON_OBJECT('allyAsPercent', 10)),
(12, 3, JSON_OBJECT('allyAsPercent', 20)),
(12, 4, JSON_OBJECT('allyAsPercent', 32));

-- ---------- 4. 英雄棋子（24 个，费用 1~5）----------
INSERT INTO `hero` (`id`, `hero_key`, `name`, `cost`, `base_hp`, `base_attack`, `attack_speed`, `skill_desc`, `enabled`) VALUES
-- 1 费 8 个
(1,  'hero_qingshan_swordsman', '青衫剑卒', 1,  600,  55, 1.10, NULL, 1),
(2,  'hero_fox_imp',            '山狐小妖', 1,  550,  50, 1.05, NULL, 1),
(3,  'hero_talisman_apprentice','纸符学徒', 1,  450,  60, 0.90, NULL, 1),
(4,  'hero_herb_girl',          '采药女',   1,  500,  35, 1.00, NULL, 1),
(5,  'hero_wood_sprite',        '木灵芽',   1,  480,  42, 0.95, NULL, 1),
(6,  'hero_wisp_ghost',         '游魂小鬼', 1,  420,  30, 1.00, NULL, 1),
(7,  'hero_demon_soldier',      '魔兵杂役', 1,  680,  48, 1.15, NULL, 1),
(8,  'hero_fairy_boy',          '云溪仙童', 1,  440,  32, 1.00, NULL, 1),
-- 2 费 6 个
(9,  'hero_chasing_wind',       '追风剑客', 2,  720,  72, 1.15, NULL, 1),
(10, 'hero_black_bear_king',    '玄熊妖王', 2, 1100,  65, 0.85, NULL, 1),
(11, 'hero_ghost_talisman',     '幽火符师', 2,  580,  80, 0.90, NULL, 1),
(12, 'hero_deer_messenger',     '灵鹿使',   2,  660,  68, 1.00, NULL, 1),
(13, 'hero_demon_flute',        '魔笛妖姬', 2,  620,  52, 1.05, NULL, 1),
(14, 'hero_qingyao_fairy',      '清瑶仙子', 2,  640,  40, 0.95, NULL, 1),
-- 3 费 4 个
(15, 'hero_demon_slayer',       '斩妖剑尊', 3,  850,  95, 1.20, NULL, 1),
(16, 'hero_nine_tail',          '九尾狐主', 3,  780,  76, 1.10, NULL, 1),
(17, 'hero_poison_alchemist',   '万毒丹师', 3,  700,  82, 0.90, NULL, 1),
(18, 'hero_bone_arranger',      '枯骨阵君', 3,  920,  64, 0.80, NULL, 1),
-- 4 费 4 个
(19, 'hero_thunder_talisman',   '凌霄符圣', 4,  820, 120, 0.85, NULL, 1),
(20, 'hero_beast_lord',         '山海兽王', 4, 1300, 105, 0.95, NULL, 1),
(21, 'hero_flame_devil',        '魔焰魔尊', 4, 1150, 112, 1.10, NULL, 1),
(22, 'hero_banyan_spirit',      '古榕树灵', 4, 1600,  70, 0.70, NULL, 1),
-- 5 费 2 个
(23, 'hero_chess_fairy',        '弈仙尊',   5, 1200, 100, 1.00, NULL, 1),
(24, 'hero_yellow_king',        '黄泉冥王', 5, 1450, 130, 0.90, NULL, 1);

-- ---------- 5. 英雄羁绊关联（47 条；黄泉冥王仅绑种族）----------
INSERT INTO `hero_trait` (`hero_id`, `trait_id`) VALUES
(1, 1), (1, 7),
(2, 2), (2, 10),
(3, 1), (3, 8),
(4, 1), (4, 9),
(5, 4), (5, 11),
(6, 6), (6, 12),
(7, 3), (7, 7),
(8, 5), (8, 9),
(9, 1), (9, 7),
(10, 2), (10, 11),
(11, 6), (11, 8),
(12, 4), (12, 10),
(13, 3), (13, 12),
(14, 5), (14, 9),
(15, 1), (15, 7),
(16, 2), (16, 12),
(17, 3), (17, 9),
(18, 6), (18, 11),
(19, 5), (19, 8),
(20, 2), (20, 10),
(21, 3), (21, 7),
(22, 4), (22, 11),
(23, 5), (23, 12),
(24, 6);

-- ---------- 6. 卡池容量（总量 188：96 / 48 / 24 / 16 / 4，按该费用英雄数均分）----------
INSERT INTO `card_pool_config` (`cost`, `pool_size`) VALUES
(1, 96), (2, 48), (3, 24), (4, 16), (5, 4);

-- ---------- 7. 等级配置（1~9 级）----------
INSERT INTO `level_config` (`level`, `exp_to_next`, `max_board_slots`, `refresh_cost`) VALUES
(1,  1, 1, 2),
(2,  2, 2, 2),
(3,  4, 3, 2),
(4,  8, 4, 2),
(5, 16, 5, 2),
(6, 24, 6, 3),
(7, 32, 7, 3),
(8, 40, 8, 4),
(9,  0, 9, 4);

-- ---------- 8. 商店出卡概率（9 级 × 5 档，每级合计必须 = 1.0000）----------
INSERT INTO `shop_odds_config` (`level`, `cost`, `probability`) VALUES
(1, 1, 1.0000), (1, 2, 0.0000), (1, 3, 0.0000), (1, 4, 0.0000), (1, 5, 0.0000),
(2, 1, 0.7500), (2, 2, 0.2500), (2, 3, 0.0000), (2, 4, 0.0000), (2, 5, 0.0000),
(3, 1, 0.5500), (3, 2, 0.4000), (3, 3, 0.0500), (3, 4, 0.0000), (3, 5, 0.0000),
(4, 1, 0.4000), (4, 2, 0.4500), (4, 3, 0.1500), (4, 4, 0.0000), (4, 5, 0.0000),
(5, 1, 0.2500), (5, 2, 0.4000), (5, 3, 0.3000), (5, 4, 0.0500), (5, 5, 0.0000),
(6, 1, 0.1500), (6, 2, 0.3000), (6, 3, 0.4000), (6, 4, 0.1500), (6, 5, 0.0000),
(7, 1, 0.1000), (7, 2, 0.2000), (7, 3, 0.4000), (7, 4, 0.2500), (7, 5, 0.0500),
(8, 1, 0.0500), (8, 2, 0.1500), (8, 3, 0.3000), (8, 4, 0.4000), (8, 5, 0.1000),
(9, 1, 0.0100), (9, 2, 0.0500), (9, 3, 0.2000), (9, 4, 0.5000), (9, 5, 0.2400);

-- ---------- 9. 全局参数（引擎按 group 组装成 economyConfig / statsConfig / damageConfig / scoreConfig）----------
INSERT INTO `game_config` (`config_key`, `config_value`, `group_name`, `remark`) VALUES
('interest_gold_step',      '10',  'economy', '每多少金币计 1 点利息'),
('interest_per_step',       '1',   'economy', '每档利息金币数'),
('interest_cap',            '5',   'economy', '单回合利息上限'),
('base_income',             '5',   'economy', '每回合基础收入'),
('max_gold',                '999', 'economy', '金币上限，溢出截断'),
('initial_gold',            '5',   'economy', '对局初始金币'),
('initial_hp',              '100', 'economy', '参与者初始血量'),
('streak_bonus_rules',      '[{"minStreak":2,"bonus":1},{"minStreak":4,"bonus":2},{"minStreak":6,"bonus":3}]', 'economy', '连胜/连败奖励分档，取满足的最大档且不叠加'),
('sell_refund_rule',        '{"1":1,"2":3,"3":9}', 'economy', '出售退款系数：星级 → 费用倍数'),
('exp_per_round',           '1',   'economy', '每回合结算自动获得的经验'),
('buy_exp_gold',            '5',   'economy', '购买一次经验消耗的金币'),
('buy_exp_amount',          '4',   'economy', '购买一次获得的经验'),
('star_hp_multiplier',      '1.80', 'combat', '每升 1 星生命倍率'),
('star_attack_multiplier',  '1.80', 'combat', '每升 1 星攻击倍率'),
('max_star',                '3',    'combat', '最高星级'),
('base_round_damage',       '3',    'combat', '败方每回合基础扣血'),
('damage_per_survivor',     '1',    'combat', '胜方每个存活棋子追加扣血'),
('battle_max_seconds',      '30',   'combat', '单场战斗最大模拟时长，超时按剩余血量比例判定'),
('max_round',               '30',   'combat', '达到该回合强制按血量排名结束'),
('board_rows',              '4',    'combat', '己方半场行数'),
('board_cols',              '7',    'combat', '棋盘列数'),
('shop_size',               '5',    'combat', '商店格子数'),
('bench_size',              '9',    'combat', '备战席格子数'),
('rank_score_map',          '{"1":30,"2":20,"3":12,"4":6,"5":-4,"6":-8,"7":-12,"8":-16}', 'rank', '名次 → 积分变化'),
('score_floor',             '0',    'rank', '积分下限保护'),
('idempotency_ttl_seconds', '300',  'system', '幂等记录保留时长');

SET FOREIGN_KEY_CHECKS = 1;
