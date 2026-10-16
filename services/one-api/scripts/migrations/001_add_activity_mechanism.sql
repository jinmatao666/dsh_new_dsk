-- ============================================================================
-- 迁移脚本：001_add_activity_mechanism.sql
-- 功能：为活动管理系统添加完整的机制支持
-- 日期：2026-06-03
-- 包含：
--   1. activities 表添加机制相关字段（幂等性：字段已存在则跳过）
--   2. 创建 activity_participations 表（用户参与记录）
--   3. 创建 user_crowds 表（用户人群定义）
-- 注意：此脚本支持幂等执行，可以安全地重复运行
-- ============================================================================

USE oneapi;

-- ============================================================================
-- 1. ALTER TABLE activities - 添加活动机制相关字段
-- ============================================================================

-- 检查并添加 mechanism_type 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'mechanism_type');
SET @query = IF(@col_exists = 0,
    'ALTER TABLE activities ADD COLUMN mechanism_type VARCHAR(20) NOT NULL DEFAULT ''manual'' COMMENT ''机制类型：manual/auto/trigger'' AFTER status',
    'SELECT ''mechanism_type already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 trigger_type 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'trigger_type');
SET @query = IF(@col_exists = 0,
    'ALTER TABLE activities ADD COLUMN trigger_type VARCHAR(50) DEFAULT NULL COMMENT ''触发类型：register/login/payment/invite/custom'' AFTER mechanism_type',
    'SELECT ''trigger_type already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 trigger_config 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'trigger_config');
SET @query = IF(@col_exists = 0,
    'ALTER TABLE activities ADD COLUMN trigger_config TEXT DEFAULT NULL COMMENT ''触发配置（JSON格式）：存储触发条件参数'' AFTER trigger_type',
    'SELECT ''trigger_config already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 target_crowd_id 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'target_crowd_id');
SET @query = IF(@col_exists = 0,
    'ALTER TABLE activities ADD COLUMN target_crowd_id INT DEFAULT NULL COMMENT ''目标人群ID（关联user_crowds表）'' AFTER trigger_config',
    'SELECT ''target_crowd_id already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 user_tags 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'user_tags');
SET @query = IF(@col_exists = 0,
    'ALTER TABLE activities ADD COLUMN user_tags TEXT DEFAULT NULL COMMENT ''用户标签（JSON数组）：用于筛选目标用户'' AFTER target_crowd_id',
    'SELECT ''user_tags already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 grant_method 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'grant_method');
SET @query = IF(@col_exists = 0,
    'ALTER TABLE activities ADD COLUMN grant_method VARCHAR(20) NOT NULL DEFAULT ''immediate'' COMMENT ''发放方式：immediate/scheduled/manual_review'' AFTER user_tags',
    'SELECT ''grant_method already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 scheduled_at 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'scheduled_at');
SET @query = IF(@col_exists = 0,
    'ALTER TABLE activities ADD COLUMN scheduled_at DATETIME DEFAULT NULL COMMENT ''定时发放时间（仅当grant_method=scheduled时有效）'' AFTER grant_method',
    'SELECT ''scheduled_at already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 grant_limit 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'grant_limit');
SET @query = IF(@col_exists = 0,
    'ALTER TABLE activities ADD COLUMN grant_limit VARCHAR(20) NOT NULL DEFAULT ''once'' COMMENT ''单用户发放限制：once/daily/unlimited'' AFTER scheduled_at',
    'SELECT ''grant_limit already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 reward_type 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'reward_type');
SET @query = IF(@col_exists = 0,
    'ALTER TABLE activities ADD COLUMN reward_type VARCHAR(20) NOT NULL DEFAULT ''quota'' COMMENT ''发放类型：quota/coupon'' AFTER grant_limit',
    'SELECT ''reward_type already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 reward_subtype 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'reward_subtype');
SET @query = IF(@col_exists = 0,
    'ALTER TABLE activities ADD COLUMN reward_subtype VARCHAR(20) NOT NULL DEFAULT ''points'' COMMENT ''权益类型：points/vip/discount/deduction'' AFTER reward_type',
    'SELECT ''reward_subtype already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 reward_amount 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'reward_amount');
SET @query = IF(@col_exists = 0,
    'ALTER TABLE activities ADD COLUMN reward_amount BIGINT NOT NULL DEFAULT 0 COMMENT ''奖励数量（根据reward_type解释：积分/天数/面额）'' AFTER reward_type',
    'SELECT ''reward_amount already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 total_budget 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'total_budget');
SET @query = IF(@col_exists = 0,
    'ALTER TABLE activities ADD COLUMN total_budget BIGINT DEFAULT NULL COMMENT ''活动总预算（NULL表示不限制）'' AFTER reward_amount',
    'SELECT ''total_budget already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检查并添加 used_budget 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'used_budget');
SET @query = IF(@col_exists = 0,
    'ALTER TABLE activities ADD COLUMN used_budget BIGINT NOT NULL DEFAULT 0 COMMENT ''已使用预算（实时统计）'' AFTER total_budget',
    'SELECT ''used_budget already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 2. 为 activities 表添加索引（幂等性：索引已存在则跳过）
-- ============================================================================

-- 复合索引：机制类型 + 状态（用于查询特定类型的活动活动）
SET @index_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND INDEX_NAME = 'idx_mechanism_status');
SET @query = IF(@index_exists = 0,
    'ALTER TABLE activities ADD INDEX idx_mechanism_status (mechanism_type, status)',
    'SELECT ''idx_mechanism_status already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 索引：触发类型（用于查询特定触发事件的活动）
SET @index_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND INDEX_NAME = 'idx_trigger_type');
SET @query = IF(@index_exists = 0,
    'ALTER TABLE activities ADD INDEX idx_trigger_type (trigger_type)',
    'SELECT ''idx_trigger_type already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 索引：目标人群ID（用于按人群筛选活动）
SET @index_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND INDEX_NAME = 'idx_target_crowd');
SET @query = IF(@index_exists = 0,
    'ALTER TABLE activities ADD INDEX idx_target_crowd (target_crowd_id)',
    'SELECT ''idx_target_crowd already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 索引：定时发放时间（用于定时任务扫描）
SET @index_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND INDEX_NAME = 'idx_scheduled_at');
SET @query = IF(@index_exists = 0,
    'ALTER TABLE activities ADD INDEX idx_scheduled_at (scheduled_at)',
    'SELECT ''idx_scheduled_at already exists'' AS info');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- 3. CREATE TABLE activity_participations - 用户参与记录表
-- ============================================================================

CREATE TABLE IF NOT EXISTS activity_participations (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    activity_id INT NOT NULL COMMENT '活动ID（关联activities表）',
    user_id INT NOT NULL COMMENT '用户ID（关联users表）',
    participation_time DATETIME NOT NULL COMMENT '参与时间',
    reward_status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '奖励状态：pending/granted/rejected',
    reward_granted_at DATETIME DEFAULT NULL COMMENT '奖励发放时间',
    reward_amount BIGINT NOT NULL DEFAULT 0 COMMENT '实际发放奖励数量',
    trigger_data TEXT DEFAULT NULL COMMENT '触发数据（JSON格式）：记录触发时的上下文信息',
    remark TEXT DEFAULT NULL COMMENT '备注信息',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间',

    INDEX idx_activity_user (activity_id, user_id),
    INDEX idx_user_id (user_id),
    INDEX idx_reward_status (reward_status),
    INDEX idx_participation_time (participation_time),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='活动参与记录表';

-- ============================================================================
-- 4. CREATE TABLE user_crowds - 用户人群定义表
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_crowds (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    name VARCHAR(100) NOT NULL COMMENT '人群名称',
    description TEXT DEFAULT NULL COMMENT '人群描述',
    crowd_type VARCHAR(20) NOT NULL DEFAULT 'static' COMMENT '人群类型：static（静态）/dynamic（动态）',
    filter_rules TEXT DEFAULT NULL COMMENT '筛选规则（JSON格式）：用于动态人群的SQL条件或规则定义',
    user_count INT NOT NULL DEFAULT 0 COMMENT '人群用户数量（缓存字段）',
    last_updated_at DATETIME DEFAULT NULL COMMENT '最后更新时间',
    status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active/inactive',
    created_by INT DEFAULT NULL COMMENT '创建人用户ID',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_crowd_type (crowd_type),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户人群定义表';

-- ============================================================================
-- 5. 验证SQL - 检查表结构和索引
-- ============================================================================

-- 验证 activities 表新增字段
SELECT
    'activities新增字段验证' AS check_name,
    COLUMN_NAME,
    COLUMN_TYPE,
    COLUMN_DEFAULT,
    COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'activities'
  AND COLUMN_NAME IN (
    'mechanism_type', 'trigger_type', 'trigger_config', 'target_crowd_id',
    'user_tags', 'grant_method', 'scheduled_at', 'grant_limit',
    'reward_type', 'reward_amount', 'total_budget', 'used_budget'
  )
ORDER BY ORDINAL_POSITION;

-- 验证 activities 表新增索引
SELECT
    'activities新增索引验证' AS check_name,
    INDEX_NAME,
    COLUMN_NAME,
    SEQ_IN_INDEX,
    INDEX_TYPE
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'activities'
  AND INDEX_NAME IN ('idx_mechanism_status', 'idx_trigger_type', 'idx_target_crowd', 'idx_scheduled_at')
ORDER BY INDEX_NAME, SEQ_IN_INDEX;

-- 验证 activity_participations 表
SELECT
    'activity_participations表验证' AS check_name,
    COUNT(*) AS column_count
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'activity_participations';

-- 验证 user_crowds 表
SELECT
    'user_crowds表验证' AS check_name,
    COUNT(*) AS column_count
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'user_crowds';

-- 验证所有表的注释
SELECT
    '表注释验证' AS check_name,
    TABLE_NAME,
    TABLE_COMMENT
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('activities', 'activity_participations', 'user_crowds')
ORDER BY TABLE_NAME;

-- ============================================================================
-- 迁移完成
-- ============================================================================
