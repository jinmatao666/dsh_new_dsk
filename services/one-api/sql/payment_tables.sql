-- ============================================
-- Parvis 支付系统数据库表
-- ============================================

-- 1. 充值套餐表
CREATE TABLE IF NOT EXISTS `recharge_packages` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '套餐ID',
  `name` varchar(50) NOT NULL COMMENT '套餐名称',
  `description` varchar(255) DEFAULT NULL COMMENT '套餐描述',
  `price` int(11) NOT NULL COMMENT '价格（分）',
  `quota` bigint(20) NOT NULL COMMENT '赠送额度',
  `sort` int(11) DEFAULT 0 COMMENT '排序（越小越靠前）',
  `enabled` tinyint(1) DEFAULT 1 COMMENT '是否启用',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='充值套餐表';

-- 插入默认套餐
INSERT INTO `recharge_packages` (`name`, `description`, `price`, `quota`, `sort`, `enabled`) VALUES
('专业版', '适合日常高频使用的规划师', 9900, 10000000, 1, 1),
('免费版', '基础 AI 对话（每日 50 次）', 0, 500000, 0, 1);

-- 2. 订单表
CREATE TABLE IF NOT EXISTS `orders` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '订单ID',
  `order_no` varchar(64) NOT NULL COMMENT '订单号（商户订单号）',
  `user_id` int(11) NOT NULL COMMENT '用户ID',
  `username` varchar(50) DEFAULT NULL COMMENT '用户名（冗余字段）',
  `package_id` int(11) NOT NULL COMMENT '套餐ID',
  `package_name` varchar(50) DEFAULT NULL COMMENT '套餐名称（冗余）',
  `amount` int(11) NOT NULL COMMENT '订单金额（分）',
  `original_amount` int(11) NOT NULL DEFAULT 0 COMMENT '折抵前原价（分）',
  `discount_amount` int(11) NOT NULL DEFAULT 0 COMMENT '升级折抵金额（分）',

  `quota` bigint(20) NOT NULL COMMENT '充值额度',
  `pay_type` varchar(20) NOT NULL DEFAULT 'wechat' COMMENT '支付方式：wechat/alipay',
  `status` varchar(20) NOT NULL DEFAULT 'pending' COMMENT '订单状态：pending/paid/cancelled/expired/refunded',
  `transaction_id` varchar(64) DEFAULT NULL COMMENT '第三方交易号',
  `paid_at` datetime DEFAULT NULL COMMENT '支付时间',
  `expired_at` datetime DEFAULT NULL COMMENT '过期时间',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单表';

-- 3. 充值记录表
CREATE TABLE IF NOT EXISTS `recharge_records` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  `user_id` int(11) NOT NULL COMMENT '用户ID',
  `username` varchar(50) DEFAULT NULL COMMENT '用户名',
  `order_no` varchar(64) NOT NULL COMMENT '订单号',
  `quota` bigint(20) NOT NULL COMMENT '充值额度',
  `before_quota` bigint(20) DEFAULT NULL COMMENT '充值前额度',
  `after_quota` bigint(20) DEFAULT NULL COMMENT '充值后额度',
  `remark` varchar(255) DEFAULT NULL COMMENT '备注',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_order_no` (`order_no`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='充值记录表';

-- 4. 支付配置表（可选，用于动态配置支付参数）
CREATE TABLE IF NOT EXISTS `payment_config` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '配置ID',
  `pay_type` varchar(20) NOT NULL COMMENT '支付类型：wechat/alipay',
  `config_key` varchar(50) NOT NULL COMMENT '配置键',
  `config_value` text COMMENT '配置值',
  `description` varchar(255) DEFAULT NULL COMMENT '配置说明',
  `enabled` tinyint(1) DEFAULT 1 COMMENT '是否启用',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pay_type_key` (`pay_type`, `config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='支付配置表';
