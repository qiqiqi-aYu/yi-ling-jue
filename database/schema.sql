-- ==========================================
-- schema.sql 弈灵诀 建表脚本 MySQL 8.0
-- 数据库：yi_ling_jue（utf8mb4 / utf8mb4_unicode_ci / InnoDB）
-- 执行顺序：schema.sql → seed.sql → 数据一致性校验（设计说明书 §6.1）
-- 说明：本脚本会先 DROP DATABASE，保证可重复执行；生产环境请勿直接执行。
-- 依据：database/弈灵诀-数据库设计说明书.md §5.2
-- ==========================================
DROP DATABASE IF EXISTS `yi_ling_jue`;
CREATE DATABASE `yi_ling_jue`
    DEFAULT CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;
USE `yi_ling_jue`;

-- ---------- 1. 后台管理员 ----------
CREATE TABLE `admin_user` (
    `id`          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
    `username`    VARCHAR(50)  NOT NULL COMMENT '登录账号',
    `password`    VARCHAR(100) NOT NULL COMMENT 'bcrypt加密密码',
    `status`      TINYINT      NOT NULL DEFAULT 1 COMMENT '1启用 0禁用',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_admin_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='后台管理员账号';

-- ---------- 2. 羁绊定义（1-6 种族，7-12 职业）----------
CREATE TABLE `trait` (
    `id`          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键 1-6种族 7-12职业',
    `trait_key`   VARCHAR(50)  NOT NULL COMMENT '唯一标识key',
    `name`        VARCHAR(50)  NOT NULL COMMENT '羁绊名称',
    `type`        TINYINT      NOT NULL COMMENT '1=种族 2=职业',
    `description` VARCHAR(255) DEFAULT NULL COMMENT '羁绊简介',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_trait_key` (`trait_key`),
    KEY `idx_trait_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='羁绊定义表';

-- ---------- 3. 羁绊档位效果（主档位 2/3/4 件；仅 3 名英雄的羁绊封顶 2/3 件）----------
CREATE TABLE `trait_level` (
    `id`             BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `trait_id`       BIGINT NOT NULL COMMENT '所属羁绊',
    `required_count` INT    NOT NULL COMMENT '激活所需棋子数量',
    `effect_json`    JSON   NOT NULL COMMENT '效果配置对象（见设计说明书 7.3 key 清单）',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_trait_count` (`trait_id`, `required_count`),
    CONSTRAINT `fk_tl_trait` FOREIGN KEY (`trait_id`) REFERENCES `trait` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='羁绊档位效果表';

-- ---------- 4. 英雄棋子 ----------
CREATE TABLE `hero` (
    `id`           BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
    `hero_key`     VARCHAR(50)  NOT NULL COMMENT '唯一标识key',
    `name`         VARCHAR(50)  NOT NULL COMMENT '英雄名称',
    `cost`         TINYINT      NOT NULL COMMENT '费用1-5',
    `base_hp`      INT          NOT NULL COMMENT '一星基础血量',
    `base_attack`  INT          NOT NULL COMMENT '一星基础攻击力',
    `attack_speed` DECIMAL(3,2) NOT NULL COMMENT '每秒攻击次数',
    `skill_desc`   VARCHAR(500) DEFAULT NULL COMMENT '技能描述',
    `enabled`      TINYINT      NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
    `create_time`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_hero_key` (`hero_key`),
    KEY `idx_hero_cost` (`cost`),
    CONSTRAINT `ck_hero_cost` CHECK (`cost` BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='英雄棋子表';

-- ---------- 5. 英雄羁绊关联 ----------
CREATE TABLE `hero_trait` (
    `id`       BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    `hero_id`  BIGINT NOT NULL COMMENT '英雄',
    `trait_id` BIGINT NOT NULL COMMENT '羁绊',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_hero_trait` (`hero_id`, `trait_id`),
    KEY `idx_ht_trait` (`trait_id`),
    CONSTRAINT `fk_ht_hero`  FOREIGN KEY (`hero_id`)  REFERENCES `hero` (`id`)  ON DELETE CASCADE,
    CONSTRAINT `fk_ht_trait` FOREIGN KEY (`trait_id`) REFERENCES `trait` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='英雄羁绊关联表';

-- ---------- 6. 卡池配置（各费用总量）----------
CREATE TABLE `card_pool_config` (
    `id`        BIGINT  NOT NULL AUTO_INCREMENT COMMENT '主键',
    `cost`      TINYINT NOT NULL COMMENT '费用1-5',
    `pool_size` INT     NOT NULL COMMENT '该费用卡池总量',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_pool_cost` (`cost`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='卡池全局配置表';

-- ---------- 7. 等级配置 ----------
CREATE TABLE `level_config` (
    `level`           TINYINT NOT NULL COMMENT '等级1-9',
    `exp_to_next`     INT     NOT NULL COMMENT '升下一级经验',
    `max_board_slots` TINYINT NOT NULL COMMENT '最大上场人口',
    `refresh_cost`    TINYINT NOT NULL COMMENT '刷新商店花费',
    PRIMARY KEY (`level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='等级配置表';

-- ---------- 8. 商店出卡概率 ----------
CREATE TABLE `shop_odds_config` (
    `id`          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
    `level`       TINYINT      NOT NULL COMMENT '等级1-9',
    `cost`        TINYINT      NOT NULL COMMENT '费用1-5',
    `probability` DECIMAL(6,4) NOT NULL COMMENT '出卡概率 同等级5条之和=1',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_odds_level_cost` (`level`, `cost`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商店出卡概率表';

-- ---------- 9. 全局参数 ----------
CREATE TABLE `game_config` (
    `id`           BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
    `config_key`   VARCHAR(50)  NOT NULL COMMENT '参数键',
    `config_value` VARCHAR(100) NOT NULL COMMENT '参数值',
    `group_name`   VARCHAR(50)  DEFAULT NULL COMMENT '分组',
    `remark`       VARCHAR(255) DEFAULT NULL COMMENT '说明',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='全局参数表';

-- ---------- 10. 对局主表 ----------
CREATE TABLE `match` (
    `id`          BIGINT      NOT NULL AUTO_INCREMENT COMMENT '对局ID',
    `seed`        BIGINT      NOT NULL COMMENT '随机种子',
    `round`       INT         NOT NULL DEFAULT 1 COMMENT '当前回合',
    `status`      VARCHAR(20) NOT NULL DEFAULT 'running' COMMENT 'running/finished',
    `version`     INT         NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    `create_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `idx_match_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对局主表';

-- ---------- 11. 对局内玩家（1 真人 + 7 AI）----------
CREATE TABLE `match_player` (
    `id`           BIGINT  NOT NULL AUTO_INCREMENT COMMENT '主键',
    `match_id`     BIGINT  NOT NULL COMMENT '所属对局',
    `player_index` TINYINT NOT NULL COMMENT '0-7，0为真人',
    `hp`           INT     NOT NULL DEFAULT 100 COMMENT '血量',
    `gold`         INT     NOT NULL DEFAULT 5 COMMENT '金币',
    `level`        TINYINT NOT NULL DEFAULT 1 COMMENT '等级',
    `exp`          INT     NOT NULL DEFAULT 0 COMMENT '当前经验',
    `win_streak`   INT     NOT NULL DEFAULT 0 COMMENT '连胜为正 连败为负',
    `board_json`   JSON    NOT NULL COMMENT '场上棋子',
    `bench_json`   JSON    NOT NULL COMMENT '备战席棋子',
    `pool_json`    JSON    NOT NULL COMMENT '本局剩余卡池',
    `shop_json`    JSON    NOT NULL COMMENT '当前商店',
    `is_ai`        TINYINT NOT NULL DEFAULT 0 COMMENT '0真人 1AI',
    `eliminated`   TINYINT NOT NULL DEFAULT 0 COMMENT '0存活 1淘汰',
    `eliminated_round` INT DEFAULT NULL COMMENT '被淘汰的回合号，用于名次排序（晚淘汰者名次更高）',
    `rank`         TINYINT DEFAULT NULL COMMENT '最终名次',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_match_player` (`match_id`, `player_index`),
    CONSTRAINT `fk_mp_match` FOREIGN KEY (`match_id`) REFERENCES `match` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对局内玩家表';

-- ---------- 12. 回合战斗记录 ----------
CREATE TABLE `match_round` (
    `id`             BIGINT   NOT NULL AUTO_INCREMENT COMMENT '主键',
    `match_id`       BIGINT   NOT NULL COMMENT '所属对局',
    `round_no`       INT      NOT NULL COMMENT '回合号',
    `battle_log`     JSON     DEFAULT NULL COMMENT '战斗时间轴',
    `player_results` JSON     DEFAULT NULL COMMENT '本回合玩家结算结果',
    `create_time`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_match_round` (`match_id`, `round_no`),
    CONSTRAINT `fk_mr_match` FOREIGN KEY (`match_id`) REFERENCES `match` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='回合战斗记录表';

-- ---------- 13. 对局存档 ----------
CREATE TABLE `match_snapshot` (
    `id`          BIGINT   NOT NULL AUTO_INCREMENT COMMENT '主键',
    `match_id`    BIGINT   NOT NULL COMMENT '所属对局',
    `round_no`    INT      NOT NULL COMMENT '存档回合',
    `state_json`  JSON     NOT NULL COMMENT '完整对局状态',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '存档时间',
    PRIMARY KEY (`id`),
    KEY `idx_snapshot_match` (`match_id`, `round_no`),
    CONSTRAINT `fk_ms_match` FOREIGN KEY (`match_id`) REFERENCES `match` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='对局存档表';

-- ---------- 14. 幂等记录 ----------
CREATE TABLE `idempotency_record` (
    `id`                BIGINT      NOT NULL AUTO_INCREMENT COMMENT '主键',
    `client_request_id` VARCHAR(64) NOT NULL COMMENT '客户端请求唯一ID',
    `scene`             VARCHAR(50) DEFAULT NULL COMMENT '业务场景',
    `result_json`       JSON        DEFAULT NULL COMMENT '首次执行结果',
    `expire_time`       DATETIME    DEFAULT NULL COMMENT '过期时间',
    `create_time`       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_client_request` (`client_request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='接口幂等记录表';

-- ---------- 15. 后台操作日志 ----------
CREATE TABLE `admin_log` (
    `id`          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
    `admin_id`    BIGINT       NOT NULL COMMENT '操作人',
    `action`      VARCHAR(50)  NOT NULL COMMENT '操作类型',
    `target`      VARCHAR(100) DEFAULT NULL COMMENT '操作对象',
    `detail`      JSON         DEFAULT NULL COMMENT '变更内容',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
    PRIMARY KEY (`id`),
    KEY `idx_log_admin` (`admin_id`),
    CONSTRAINT `fk_log_admin` FOREIGN KEY (`admin_id`) REFERENCES `admin_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='后台操作日志表';
