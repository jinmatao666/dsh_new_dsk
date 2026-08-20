-- ============================================================================
-- 回滚脚本：001_rollback_activity_mechanism.sql
-- 功能：回滚活动机制相关的所有数据库变更
-- 日期：2026-06-03
-- 警告：此脚本将删除表和字段，请确保已备份数据
-- ============================================================================

-- ============================================================================
-- 1. 删除 user_crowds 表
-- ============================================================================

DROP TABLE IF EXISTS user_crowds;

-- ============================================================================
-- 2. 删除 activity_participations 表
-- ============================================================================

DROP TABLE IF EXISTS activity_participations;

-- ============================================================================
-- 3. 删除 activities 表的索引
-- ============================================================================

ALTER TABLE activities DROP INDEX IF EXISTS idx_scheduled_at;
ALTER TABLE activities DROP INDEX IF EXISTS idx_target_crowd;
ALTER TABLE activities DROP INDEX IF EXISTS idx_trigger_type;
ALTER TABLE activities DROP INDEX IF EXISTS idx_mechanism_status;

-- ============================================================================
-- 4. 删除 activities 表的新增字段（按逆序删除）
-- ============================================================================

ALTER TABLE activities DROP COLUMN IF EXISTS used_budget;
ALTER TABLE activities DROP COLUMN IF EXISTS total_budget;
ALTER TABLE activities DROP COLUMN IF EXISTS reward_amount;
ALTER TABLE activities DROP COLUMN IF EXISTS reward_type;
ALTER TABLE activities DROP COLUMN IF EXISTS grant_limit;
ALTER TABLE activities DROP COLUMN IF EXISTS scheduled_at;
ALTER TABLE activities DROP COLUMN IF EXISTS grant_method;
ALTER TABLE activities DROP COLUMN IF EXISTS user_tags;
ALTER TABLE activities DROP COLUMN IF EXISTS target_crowd_id;
ALTER TABLE activities DROP COLUMN IF EXISTS trigger_config;
ALTER TABLE activities DROP COLUMN IF EXISTS trigger_type;
ALTER TABLE activities DROP COLUMN IF EXISTS mechanism_type;

-- ============================================================================
-- 5. 验证回滚结果
-- ============================================================================

-- 验证 activities 表字段已删除
SELECT
    'activities字段回滚验证' AS check_name,
    CASE
        WHEN COUNT(*) = 0 THEN '✓ 所有新增字段已删除'
        ELSE CONCAT('✗ 仍有 ', COUNT(*), ' 个字段未删除')
    END AS result
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'activities'
  AND COLUMN_NAME IN (
    'mechanism_type', 'trigger_type', 'trigger_config', 'target_crowd_id',
    'user_tags', 'grant_method', 'scheduled_at', 'grant_limit',
    'reward_type', 'reward_amount', 'total_budget', 'used_budget'
  );

-- 验证 activities 表索引已删除
SELECT
    'activities索引回滚验证' AS check_name,
    CASE
        WHEN COUNT(*) = 0 THEN '✓ 所有新增索引已删除'
        ELSE CONCAT('✗ 仍有 ', COUNT(*), ' 个索引未删除')
    END AS result
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'activities'
  AND INDEX_NAME IN ('idx_mechanism_status', 'idx_trigger_type', 'idx_target_crowd', 'idx_scheduled_at');

-- 验证 activity_participations 表已删除
SELECT
    'activity_participations表回滚验证' AS check_name,
    CASE
        WHEN COUNT(*) = 0 THEN '✓ 表已删除'
        ELSE '✗ 表仍然存在'
    END AS result
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'activity_participations';

-- 验证 user_crowds 表已删除
SELECT
    'user_crowds表回滚验证' AS check_name,
    CASE
        WHEN COUNT(*) = 0 THEN '✓ 表已删除'
        ELSE '✗ 表仍然存在'
    END AS result
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'user_crowds';

-- ============================================================================
-- 回滚完成
-- ============================================================================
