package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/common/random"
	"github.com/songquanpeng/one-api/model"
)

// loadRewardContext 读取全局奖励配置（有效人群 + 规则）并解析规则。
// 规则为空或非法时 rule 返回 nil（当期奖励按 0 处理），不报错。
func loadRewardContext() (crowdId int, rule *model.RewardRule) {
	crowdId = model.GetRewardValidCrowdId()
	if ruleJSON := model.GetRewardRuleJSON(); ruleJSON != "" {
		var r model.RewardRule
		if err := json.Unmarshal([]byte(ruleJSON), &r); err != nil {
			logger.SysError("奖励规则 JSON 解析失败: " + err.Error())
		} else {
			rule = &r
		}
	}
	return crowdId, rule
}

// influencerCodeWithReward 是列表增强返回结构：原码字段 + 派生奖励字段。
type influencerCodeWithReward struct {
	*model.InfluencerCode
	ValidCount         int   `json:"valid_count"`          // 当期有效人数
	TotalValidCount    int   `json:"total_valid_count"`    // 历史累计有效人数（不清零）
	CurrentRewardCents int64 `json:"current_reward_cents"` // 当期奖励（分）
	SettledRewardCents int64 `json:"settled_reward_cents"` // 已发放奖励（分）
	SettleCount        int   `json:"settle_count"`         // 结算次数
}

// AdminListInfluencerCodesWithReward 处理 GET /api/influencer-code/with-reward：
// 在兑换码列表基础上补「有效人数 / 当期奖励 / 已发放奖励 / 结算次数」派生字段。
func AdminListInfluencerCodesWithReward(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	codes, total, err := model.ListInfluencerCodes(
		(page-1)*pageSize, pageSize,
		c.Query("influencer_name"), c.Query("channel"), c.Query("status"),
	)
	if err != nil {
		logger.SysError("获取兑换码列表失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取兑换码列表失败"})
		return
	}

	crowdId, rule := loadRewardContext()
	periodStats, err := model.ComputeCurrentValidCounts(crowdId)
	if err != nil {
		logger.SysError("计算当期有效人数失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "计算当期有效人数失败"})
		return
	}
	settledStats, err := model.GetSettledStatsByCode()
	if err != nil {
		logger.SysError("查询已结算汇总失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "查询已结算汇总失败"})
		return
	}

	list := make([]*influencerCodeWithReward, 0, len(codes))
	for _, code := range codes {
		row := &influencerCodeWithReward{InfluencerCode: code}
		if stat := periodStats[code.Id]; stat != nil {
			row.ValidCount = stat.ValidCount
			row.TotalValidCount = stat.TotalValidCount
			row.CurrentRewardCents = evalRewardCents(rule, stat, code)
		}
		if s := settledStats[code.Id]; s != nil {
			row.SettledRewardCents = s.SumAmountCents
			row.SettleCount = s.SettleCount
		}
		list = append(list, row)
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": list, "total": total})
}

// evalRewardCents 用规则对单个码的当期统计求值，返回当期奖励（分）。规则/统计缺失返回 0。
func evalRewardCents(rule *model.RewardRule, stat *model.CodePeriodStat, code *model.InfluencerCode) int64 {
	if rule == nil || stat == nil {
		return 0
	}
	cents, err := model.EvaluateReward(rule, model.RewardInput{
		ValidCount:     stat.ValidCount,
		RedeemedCount:  stat.RedeemedCount,
		Channel:        code.Channel,
		InfluencerName: code.InfluencerName,
	})
	if err != nil {
		logger.SysError("奖励求值失败: " + err.Error())
		return 0
	}
	return cents
}

// settleRequest 是结算接口请求体。code_ids 非空＝部分结算（仅选中码），为空＝全量结算。
type settleRequest struct {
	CodeIds  []int  `json:"code_ids"`
	Password string `json:"password"` // 管理员二次确认密码
}

// AdminSettleReward 处理 POST /api/reward-settlement/settle：
// 快照当期奖励→写结算批次+明细→游标推进（下次当期自动归零），支持部分结算。
// 结算为不可逆的财务记账操作，需校验当前管理员密码二次确认。
func AdminSettleReward(c *gin.Context) {
	var req settleRequest
	// 允许空 code_ids（全量结算），但 body 必须能解析出 password。
	_ = c.ShouldBindJSON(&req)

	if err := validateCurrentAdminPassword(c, req.Password); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	crowdId, rule := loadRewardContext()
	periodStats, err := model.ComputeCurrentValidCounts(crowdId)
	if err != nil {
		logger.SysError("结算：计算当期有效人数失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "计算当期有效人数失败"})
		return
	}

	// 选中集合（部分结算）。
	isPartial := len(req.CodeIds) > 0
	selected := make(map[int]bool, len(req.CodeIds))
	for _, id := range req.CodeIds {
		selected[id] = true
	}

	// 取分群名快照。
	crowdName := ""
	if crowdId > 0 {
		if crowd, err := model.GetUserCrowdById(crowdId); err == nil && crowd != nil {
			crowdName = crowd.Name
		}
	}
	ruleSnapshot := model.GetRewardRuleJSON()

	// 组装本批明细：遍历当期有统计的码，按选中过滤，金额>0 或有效人数>0 才纳入。
	items := make([]*model.RewardSettlementItem, 0)
	var totalValid int
	var totalAmount int64
	adminId := c.GetInt("id")

	// 需要码详情（手机号/达人名/渠道）。批量取一次。
	for codeId, stat := range periodStats {
		if isPartial && !selected[codeId] {
			continue
		}
		code, err := model.GetInfluencerCodeById(codeId)
		if err != nil || code == nil {
			continue
		}
		amount := evalRewardCents(rule, stat, code)
		if stat.ValidCount <= 0 && amount <= 0 {
			continue
		}
		items = append(items, &model.RewardSettlementItem{
			CodeId:           codeId,
			Code:             code.Code,
			IssuerUserId:     code.IssuerUserId,
			IssuerPhone:      code.IssuerPhone,
			InfluencerName:   code.InfluencerName,
			Channel:          code.Channel,
			ValidCount:       stat.ValidCount,
			RedeemedCount:    stat.RedeemedCount,
			AmountCents:      amount,
			CursorRedeemedAt: stat.MaxRedeemedAt,
		})
		totalValid += stat.ValidCount
		totalAmount += amount
	}

	if len(items) == 0 {
		msg := "当期无可结算奖励"
		if isPartial {
			msg = "所选达人当期无可结算奖励"
		}
		c.JSON(http.StatusOK, gin.H{"success": false, "message": msg})
		return
	}

	settlement := &model.RewardSettlement{
		BatchNo:          fmt.Sprintf("S%d%s", helper.GetTimestamp(), random.GetRandomString(4)),
		InfluencerCount:  len(items),
		TotalValidCount:  totalValid,
		TotalAmountCents: totalAmount,
		RuleSnapshot:     ruleSnapshot,
		CrowdId:          crowdId,
		CrowdName:        crowdName,
		IsPartial:        isPartial,
		SettledBy:        adminId,
		SettledAt:        helper.GetTimestamp(),
	}
	if err := model.CreateRewardSettlement(nil, settlement, items); err != nil {
		logger.SysError("写入结算记录失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "写入结算记录失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "结算成功",
		"data": gin.H{
			"batch_no":           settlement.BatchNo,
			"influencer_count":   settlement.InfluencerCount,
			"total_valid_count":  settlement.TotalValidCount,
			"total_amount_cents": settlement.TotalAmountCents,
		},
	})
}

// AdminListRewardSettlements 处理 GET /api/reward-settlement/：分页列出结算批次。
func AdminListRewardSettlements(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	rows, total, err := model.ListRewardSettlements((page-1)*pageSize, pageSize)
	if err != nil {
		logger.SysError("获取结算记录失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取结算记录失败"})
		return
	}

	// 附结算人名称（settled_by → 用户名/昵称），便于审计展示。
	type settlementWithOperator struct {
		*model.RewardSettlement
		SettledByName string `json:"settled_by_name"`
	}
	list := make([]*settlementWithOperator, 0, len(rows))
	nameCache := make(map[int]string)
	for _, r := range rows {
		name := nameCache[r.SettledBy]
		if name == "" && r.SettledBy > 0 {
			if u, e := model.GetUserById(r.SettledBy, false); e == nil && u != nil {
				name = u.DisplayName
				if name == "" {
					name = u.Username
				}
				nameCache[r.SettledBy] = name
			}
		}
		list = append(list, &settlementWithOperator{RewardSettlement: r, SettledByName: name})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": list, "total": total})
}

// AdminGetRewardSettlementItems 处理 GET /api/reward-settlement/:id/items：某批次的达人明细。
func AdminGetRewardSettlementItems(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	items, err := model.GetRewardSettlementItems(id)
	if err != nil {
		logger.SysError("获取结算明细失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取结算明细失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

// AdminGetSettlementHistoryByCode 处理 GET /api/reward-settlement/by-code：
// 单个兑换码的历次结算记录（结算时间 + 金额 + 有效人数 + 批次号），供列表"结算次数"点击查看。
func AdminGetSettlementHistoryByCode(c *gin.Context) {
	codeId, _ := strconv.Atoi(c.Query("code_id"))
	if codeId <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "缺少 code_id"})
		return
	}
	items, err := model.ListSettlementHistoryByCode(codeId)
	if err != nil {
		logger.SysError("获取单码结算历史失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取结算历史失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}
