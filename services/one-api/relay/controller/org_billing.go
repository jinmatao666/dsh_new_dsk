package controller

import (
	"context"
	"errors"
	"net/http"

	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

// checkOrgSpendGuards 企业模式下统一的四道扣费闸门,三条 relay 路径(text/image/audio)共用,
// 避免各自手写导致校验漂移(历史上 image/audio 曾漏掉成员累计上限校验):
//  1. 企业总账本余额是否够本次扣减
//  2. 成员个人累计上限 memberQuotaLimit(<0 表示不限)
//  3. 成员日/月限额(节流闸门)
//  4. 部门预算(capped 模式的祖先链)
//
// amount 为本次拟扣减额度(预扣额度)。返回 nil 表示放行。
func checkOrgSpendGuards(orgId, userId, orgDeptId int, memberQuotaLimit, amount int64) *relaymodel.ErrorWithStatusCode {
	orgQuota, err := model.GetOrgAvailableQuota(orgId)
	if err != nil {
		return openai.ErrorWrapper(err, "get_org_quota_failed", http.StatusInternalServerError)
	}
	if orgQuota-amount < 0 {
		return openai.ErrorWrapper(errors.New("企业额度不足"), "insufficient_org_quota", http.StatusForbidden)
	}
	if memberQuotaLimit >= 0 {
		memberUsed, _ := model.GetOrgMemberUsedQuota(orgId, userId)
		if memberUsed+amount > memberQuotaLimit {
			return openai.ErrorWrapper(errors.New("已超出企业分配给你的额度上限"), "member_quota_limit_exceeded", http.StatusForbidden)
		}
	}
	if err := model.CheckOrgMemberLimit(orgId, userId, amount); err != nil {
		return openai.ErrorWrapper(err, "member_period_limit_exceeded", http.StatusForbidden)
	}
	if err := model.CheckOrgDeptBudget(orgId, orgDeptId, amount); err != nil {
		return openai.ErrorWrapper(err, "dept_budget_exceeded", http.StatusForbidden)
	}
	return nil
}

// clampQuotaNonNegative 将额度钳制为非负值:实际消耗永远不为负,
// 预扣成功后若实际结算出现负值一律按 0 计,避免账本/统计出现负数。
func clampQuotaNonNegative(quota int64) int64 {
	if quota < 0 {
		return 0
	}
	return quota
}

// postConsumeOrgLedger 企业模式 post 阶段统一结算:账本差额 + 成员已用 + 部门用量 + 成员周期计数。
//   - actualQuota: 本次实际消耗(调用方须先用 clampQuotaNonNegative 钳为非负)
//   - preConsumed: 预扣额度(image 等"post 一次性扣减"场景传 0)
//   - deducted:    预扣时账本扣减明细(rowId->amount),用于实际<预扣时按原路精确退款;无预扣传 nil
//
// 注意:本函数不负责写消费日志——三条路径日志字段不同,由各自调用方记录。
func postConsumeOrgLedger(ctx context.Context, orgId, userId, orgDeptId int, actualQuota, preConsumed int64, deducted map[int64]int64) {
	actualQuota = clampQuotaNonNegative(actualQuota)
	quotaDelta := actualQuota - preConsumed
	if quotaDelta > 0 {
		// 实际 > 预扣:补扣差额。账本不足时仅记日志(差额由日志体现),不阻断已完成的请求。
		if _, err := model.DecreaseOrgQuotaByLedger(orgId, quotaDelta); err != nil {
			logger.Error(ctx, "post_consume decrease_org_quota_failed: "+err.Error())
		}
	} else if quotaDelta < 0 {
		// 实际 < 预扣:按预扣 deducted 明细原路退还多扣部分。
		// scaleDeductedRefund 退款额受 deducted 各行上限约束,不会退超过实际扣减,账本不会转正溢出。
		if err := model.RefundOrgQuotaByLedger(orgId, scaleDeductedRefund(deducted, -quotaDelta)); err != nil {
			logger.Error(ctx, "post_consume refund_org_quota_failed: "+err.Error())
		}
	}
	if actualQuota > 0 {
		model.UpdateOrgMemberUsedQuota(orgId, userId, actualQuota)
		if err := model.ApplyOrgDeptUsage(nil, orgId, orgDeptId, actualQuota); err != nil {
			logger.Error(ctx, "post_consume apply_dept_usage_failed: "+err.Error())
		}
		if err := model.IncrOrgMemberUsed(nil, orgId, userId, actualQuota); err != nil {
			logger.Error(ctx, "post_consume incr_member_period_used_failed: "+err.Error())
		}
	}
}
