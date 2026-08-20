package model

import (
	"context"
	"fmt"

	"github.com/songquanpeng/one-api/common/logger"
)

// TriggerActivities 触发指定类型的活动
func TriggerActivities(ctx context.Context, triggerType string, userId int) error {
	// 1. 获取该触发类型的所有活动
	activities, err := GetActiveActivitiesByTrigger(triggerType)
	if err != nil {
		return fmt.Errorf("获取活动列表失败: %w", err)
	}

	if len(activities) == 0 {
		// 没有活动，正常返回
		return nil
	}

	// 2. 遍历每个活动
	for _, activity := range activities {
		// 检查用户是否匹配
		match, err := activity.MatchUser(userId)
		if err != nil {
			logger.SysError(fmt.Sprintf("检查用户匹配失败 activity=%d user=%d: %v", activity.Id, userId, err))
			continue // 单个活动失败不影响其他活动
		}
		if !match {
			continue // 用户不匹配，跳过
		}

		// 检查用户是否已参与
		grantLimit := activity.GrantLimit
		if grantLimit == "" {
			grantLimit = "once"
		}
		participated, err := HasParticipated(activity.Id, userId, grantLimit)
		if err != nil {
			logger.SysError(fmt.Sprintf("检查参与记录失败 activity=%d user=%d: %v", activity.Id, userId, err))
			continue
		}
		if participated {
			continue // 已参与，跳过
		}

		// 发放奖励
		err = GrantActivityReward(ctx, userId, activity)
		if err != nil {
			logger.SysError(fmt.Sprintf("发放活动奖励失败 activity=%d user=%d: %v", activity.Id, userId, err))
			// 埋点上报
			// telemetry.track("活动奖励发放失败", map[string]interface{}{
			// 	"activity_id": activity.Id,
			// 	"user_id": userId,
			// 	"error": err.Error(),
			// })
			continue
		}

		logger.SysLog(fmt.Sprintf("活动奖励发放成功 activity=%d user=%d reward=%s amount=%d",
			activity.Id, userId, activity.RewardType, activity.RewardAmount))
	}

	return nil
}

// GrantActivityReward 发放活动奖励
func GrantActivityReward(ctx context.Context, userId int, activity *Activity) error {
	// 1. 检查预算
	if !activity.HasBudget(activity.RewardAmount) {
		return fmt.Errorf("活动预算不足")
	}

	expiresAt := activity.RewardExpiresAt

	// 2. 根据奖励类型发放
	switch activity.RewardType {
	case "quota":
		// 使用 RecordParticipation，它会自动发放积分、记录参与、更新预算。
		// 每日限领（如每日签到）走「合并到单条永久批次」的台账写入，避免 user_timed_quotas 逐日膨胀；
		// 其它（once/unlimited）保持每次独立新增一行。合并仅对永久积分（expiresAt=nil）生效。
		var err error
		if activity.GrantLimit == "daily" {
			err = RecordParticipationMerged(activity.Id, userId, activity.RewardAmount, expiresAt)
		} else {
			err = RecordParticipation(activity.Id, userId, activity.RewardAmount, expiresAt)
		}
		if err != nil {
			return fmt.Errorf("发放积分失败: %w", err)
		}

	case "vip":
		if activity.RewardIdentityId == nil || *activity.RewardIdentityId <= 0 {
			return fmt.Errorf("vip 奖励未配置会员身份")
		}
		days := int(activity.RewardAmount)
		if days <= 0 {
			return fmt.Errorf("vip 奖励天数必须大于 0")
		}
		source := fmt.Sprintf("活动:%d", activity.Id)
		err := RecordParticipation(activity.Id, userId, 0, nil)
		if err != nil {
			return fmt.Errorf("记录参与失败: %w", err)
		}
		if err := GrantMemberIdentityToUser(userId, *activity.RewardIdentityId, days, source); err != nil {
			return fmt.Errorf("发放会员身份失败: %w", err)
		}

	case "coupon":
		couponType := activity.RewardSubtype // "discount" 或 "deduction"
		if couponType != CouponTypeDiscount && couponType != CouponTypeDeduction {
			return fmt.Errorf("不支持的优惠券类型: %s", couponType)
		}
		couponValue := float64(activity.RewardAmount)
		if couponType == CouponTypeDiscount {
			// reward_amount 存系数×10000，前端填 0.8 → 存 8000
			couponValue = float64(activity.RewardAmount) / 10000.0
		} else if couponType == CouponTypeDeduction {
			// reward_amount 存分(×100)，前端填 10.5元 → 存 1050
			couponValue = float64(activity.RewardAmount) / 100.0
		}
		source := fmt.Sprintf("activity_%d", activity.Id)
		err := RecordParticipation(activity.Id, userId, 0, nil)
		if err != nil {
			return fmt.Errorf("记录参与失败: %w", err)
		}
		if err := AddUserCouponTx(DB, userId, couponType, couponValue, source, expiresAt); err != nil {
			return fmt.Errorf("发放优惠券失败: %w", err)
		}

	default:
		return fmt.Errorf("不支持的奖励类型: %s", activity.RewardType)
	}

	// 账户动态日志已下沉到各发放函数内部写入：
	//   - quota:  RecordParticipation 写「参与活动「X」获得 ...」
	//   - vip:    GrantMemberIdentityToUser 写「获得「身份」会员 N 天」
	//   - coupon: AddUserCouponTx 写「获得 X 折/¥X 券」
	// 此处不再重复写入。

	return nil
}

// GrantToCrowd 向用户分群发放活动奖励（人群定向型）
func GrantToCrowd(ctx context.Context, activityId int) error {
	// 1. 获取活动信息
	activity, err := GetActivityById(activityId)
	if err != nil {
		return fmt.Errorf("获取活动失败: %w", err)
	}

	// 检查活动机制类型
	if activity.MechanismType != "crowd" {
		return fmt.Errorf("活动不是人群定向型")
	}

	// 2. 获取目标分群的用户列表
	if activity.TargetCrowdId == nil || *activity.TargetCrowdId == 0 {
		return fmt.Errorf("未指定目标分群")
	}

	crowd, err := GetUserCrowdById(*activity.TargetCrowdId)
	if err != nil {
		return fmt.Errorf("获取用户分群失败: %w", err)
	}

	userIds, err := crowd.GetMatchedUsersWithPagination(0, 0)
	if err != nil {
		return fmt.Errorf("获取匹配用户失败: %w", err)
	}

	// 3. 批量检查和发放
	successCount := 0
	failCount := 0

	grantLimit := activity.GrantLimit
	if grantLimit == "" {
		grantLimit = "once"
	}

	for _, userId := range userIds {
		// 检查是否已参与
		participated, err := HasParticipated(activity.Id, userId, grantLimit)
		if err != nil || participated {
			continue
		}

		// 发放奖励
		err = GrantActivityReward(ctx, userId, activity)
		if err != nil {
			logger.SysError(fmt.Sprintf("批量发放失败 activity=%d user=%d: %v", activity.Id, userId, err))
			failCount++
			continue
		}
		successCount++
	}

	logger.SysLog(fmt.Sprintf("批量发放完成 activity=%d 成功=%d 失败=%d", activityId, successCount, failCount))
	return nil
}

// CheckAndGrantScheduledActivities 检查并发放定时活动（定时任务调用）
func CheckAndGrantScheduledActivities(ctx context.Context) error {
	// TODO: 实现定时活动检查逻辑
	// 1. 查询 grant_method='scheduled' 且 scheduled_at 已到的活动
	// 2. 调用 GrantToCrowd 批量发放
	return nil
}

// TriggerInviteActivities 邀请场景统一触发入口
// eventType: "registration" 或 "payment"
// inviteeId: 被邀请人 ID
// inviterAffCode: 邀请人邀请码
// orderNo: 付费场景传订单号，注册场景传空
// paymentAmount: 付费场景传实际支付金额（分），注册场景传 0
func TriggerInviteActivities(ctx context.Context, eventType string, inviteeId int, inviterAffCode string, orderNo string, paymentAmount int64) error {
	inviterId, err := GetUserIdByAffCode(inviterAffCode)
	if err != nil || inviterId == 0 {
		return fmt.Errorf("邀请码无效: %s", inviterAffCode)
	}

	triggerType := "invite_" + eventType
	activities, err := GetActiveActivitiesByTrigger(triggerType)
	if err != nil {
		return fmt.Errorf("获取邀请活动列表失败: %w", err)
	}

	if len(activities) == 0 {
		return nil
	}

	for _, activity := range activities {
		// deduction 类型在下单时已处理，回调时只记录，不重复发放
		if activity.RewardSubtype == "deduction" {
			// 写邀请记录（如未写过）
			existed, _ := HasInviteRecord(inviteeId, eventType)
			if !existed {
				_ = CreateInviteRecord(inviterId, inviteeId, inviterAffCode, eventType, orderNo)
			}
			continue
		}

		// 检查最低付款金额（仅 invite_payment）
		if eventType == "payment" {
			config, _ := activity.ParseTriggerConfig()
			if config != nil && config.MinPaymentAmount > 0 && paymentAmount < config.MinPaymentAmount {
				continue
			}
		}

		// 根据 grant_role 确定奖励对象
		grantRole := activity.GrantRole
		if grantRole == "" {
			grantRole = "invitee"
		}
		var targetUserId int
		switch grantRole {
		case "inviter":
			targetUserId = inviterId
		default:
			targetUserId = inviteeId
		}

		// 防重复：同一被邀请人+事件类型已有记录则跳过（invitee 奖励）
		// inviter 奖励用 activity_participations 防重（HasParticipated）
		if grantRole == "invitee" {
			existed, _ := HasInviteRecord(inviteeId, eventType)
			if existed {
				continue
			}
		}

		grantLimit := activity.GrantLimit
		if grantLimit == "" {
			grantLimit = "once"
		}
		participated, err := HasParticipated(activity.Id, targetUserId, grantLimit)
		if err != nil {
			logger.SysError(fmt.Sprintf("检查邀请活动参与记录失败 activity=%d user=%d: %v", activity.Id, targetUserId, err))
			continue
		}
		if participated {
			continue
		}

		if err := GrantActivityReward(ctx, targetUserId, activity); err != nil {
			logger.SysError(fmt.Sprintf("邀请活动奖励发放失败 activity=%d user=%d: %v", activity.Id, targetUserId, err))
			continue
		}

		// 写邀请记录（以被邀请人+事件类型为维度，每种事件只写一次）
		if grantRole == "invitee" {
			_ = CreateInviteRecord(inviterId, inviteeId, inviterAffCode, eventType, orderNo)
		}

		logger.SysLog(fmt.Sprintf("邀请活动奖励发放成功 activity=%d target=%d role=%s event=%s",
			activity.Id, targetUserId, grantRole, eventType))
	}

	return nil
}

// GetInviteDeductionAmount 查询邀请码对应的 invite_payment deduction 活动抵扣金额（分）
// 返回 0 表示无可用抵扣活动
func GetInviteDeductionAmount(affCode string) (int64, error) {
	if affCode == "" {
		return 0, nil
	}
	inviterId, err := GetUserIdByAffCode(affCode)
	if err != nil || inviterId == 0 {
		return 0, nil
	}

	activities, err := GetActiveActivitiesByTrigger("invite_payment")
	if err != nil {
		return 0, err
	}

	var total int64
	for _, a := range activities {
		if a.RewardSubtype == "deduction" && a.RewardAmount > 0 {
			total += a.RewardAmount
		}
	}
	return total, nil
}

// HasGrantableRedeemerActivity 判断当前是否存在「兑换人侧」可发放的有效兑换活动。
//
// 「有效」完全由活动系统的字段决定，不在功能里写死：
//   - 活动启用且在时间窗口内、预算未耗尽（GetActiveActivitiesByTrigger 已过滤）
//   - grant_role 指向兑换人（invitee / 默认），而非发码人（inviter）
//   - 用户匹配活动定向规则（MatchUser：状态、账户类型、新用户限制等）
//   - 该用户尚未在此活动达到 grant_limit（HasParticipated）
//   - 该活动预算仍可覆盖本次奖励额度（HasBudget）
//
// 兑换接口用它做前置闸门：无可发放的兑换人活动时直接判定兑换失败，
// 既不写归因、也不把用户标记为已兑换，用户可在运营补好活动后重试。
func HasGrantableRedeemerActivity(redeemerUserId int) (bool, error) {
	activities, err := GetActiveActivitiesByTrigger("redeem")
	if err != nil {
		return false, fmt.Errorf("获取兑换活动列表失败: %w", err)
	}
	for _, activity := range activities {
		grantRole := activity.GrantRole
		if grantRole == "" {
			grantRole = "invitee"
		}
		if grantRole == "inviter" {
			continue // 发码人侧活动不构成兑换人可领的有效活动
		}

		match, err := activity.MatchUser(redeemerUserId)
		if err != nil {
			logger.SysError(fmt.Sprintf("检查兑换活动用户匹配失败 activity=%d user=%d: %v", activity.Id, redeemerUserId, err))
			continue
		}
		if !match {
			continue
		}

		grantLimit := activity.GrantLimit
		if grantLimit == "" {
			grantLimit = "once"
		}
		participated, err := HasParticipated(activity.Id, redeemerUserId, grantLimit)
		if err != nil {
			logger.SysError(fmt.Sprintf("检查兑换活动参与记录失败 activity=%d user=%d: %v", activity.Id, redeemerUserId, err))
			continue
		}
		if participated {
			continue
		}

		if !activity.HasBudget(activity.RewardAmount) {
			continue
		}

		return true, nil
	}
	return false, nil
}

// TriggerRedeemActivities 达人兑换码兑换场景的统一发放入口（仿 TriggerInviteActivities）。
//
// 发放完全委托活动系统：遍历所有 trigger_type=redeem 的启用活动，按 grant_role 确定本次受益人——
//   - invitee（兑换人）：targetUserId = redeemerUserId
//   - inviter（发码人）：targetUserId = issuerUserId
//
// 双角色非原子：兑换人 / 发码人各自一次 GrantActivityReward（各自事务），与邀请活动一致；
// 单个活动失败仅记日志、跳过，不回滚其他活动、不影响主链路。
// 归因记录（redeem_records）由 controller 在调用本函数前写入，本函数只管发放。
//
// 返回兑换人本次实得的积分总额（仅 quota 类型奖励累加），供兑换接口回包提示。
func TriggerRedeemActivities(ctx context.Context, redeemerUserId, issuerUserId int, code string) (int64, error) {
	activities, err := GetActiveActivitiesByTrigger("redeem")
	if err != nil {
		return 0, fmt.Errorf("获取兑换活动列表失败: %w", err)
	}
	if len(activities) == 0 {
		// 未配置任何 redeem 活动：兑换成功但不发积分。由 controller 判断是否提示运营。
		return 0, nil
	}

	var redeemerGranted int64
	for _, activity := range activities {
		// 按 grant_role 确定本次奖励对象（发码人=inviter，兑换人=invitee）
		grantRole := activity.GrantRole
		if grantRole == "" {
			grantRole = "invitee"
		}
		var targetUserId int
		switch grantRole {
		case "inviter":
			targetUserId = issuerUserId
		default:
			targetUserId = redeemerUserId
		}

		grantLimit := activity.GrantLimit
		if grantLimit == "" {
			grantLimit = "once"
		}
		participated, err := HasParticipated(activity.Id, targetUserId, grantLimit)
		if err != nil {
			logger.SysError(fmt.Sprintf("检查兑换活动参与记录失败 activity=%d user=%d: %v", activity.Id, targetUserId, err))
			continue
		}
		if participated {
			continue
		}

		if err := GrantActivityReward(ctx, targetUserId, activity); err != nil {
			logger.SysError(fmt.Sprintf("兑换活动奖励发放失败 activity=%d user=%d code=%s: %v", activity.Id, targetUserId, code, err))
			continue
		}

		// 累计兑换人本次实得（仅 quota 奖励计入回包金额）
		if grantRole != "inviter" && activity.RewardType == "quota" {
			redeemerGranted += activity.RewardAmount
		}

		logger.SysLog(fmt.Sprintf("兑换活动奖励发放成功 activity=%d target=%d role=%s code=%s",
			activity.Id, targetUserId, grantRole, code))
	}

	return redeemerGranted, nil
}
