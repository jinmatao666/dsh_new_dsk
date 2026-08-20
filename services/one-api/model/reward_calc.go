package model

import (
	"github.com/songquanpeng/one-api/common/logger"
)

// CodePeriodStat 单个兑换码的统计：当期（结算游标之后）+ 历史累计。
type CodePeriodStat struct {
	CodeId          int   `json:"code_id"`
	ValidCount      int   `json:"valid_count"`       // 当期有效人数 = 当期兑换人 ∩ 分群匹配用户
	RedeemedCount   int   `json:"redeemed_count"`    // 当期兑换人数（参考，及作为 modifier/规则输入）
	MaxRedeemedAt   int64 `json:"max_redeemed_at"`   // 当期最大 redeemed_at，结算时作为新游标
	TotalValidCount int   `json:"total_valid_count"` // 历史累计有效人数（不受结算游标影响，不清零）
	TotalRedeemed   int   `json:"total_redeemed"`    // 历史累计兑换人数（按归因表实时统计）
}

// ComputeCurrentValidCounts 计算每个兑换码的"当期"统计（按 code_id 聚合）。
//
// 当期定义：该码 redeemed_at > 已结算游标(MAX cursor_redeemed_at) 的兑换记录。
// 有效人数：当期兑换人 id ∩ 分群匹配用户 id 集合。
//   - crowdId <= 0 或分群不存在/规则为空 → 视为"全部命中"（不过滤，valid=redeemed）。
//
// 实现：一次性取分群全量匹配 id 做内存集合，再扫 redeem_records 按 code 聚合。
// 第一期达人与兑换量有限，内存交集即可；规模增大需改 IN 下推或半连接（见计划 5.1）。
func ComputeCurrentValidCounts(crowdId int) (map[int]*CodePeriodStat, error) {
	// 1. 已结算游标（按 code）。
	cursors, err := GetSettledCursorsByCode()
	if err != nil {
		return nil, err
	}

	// 2. 分群匹配用户集合（crowdId<=0 表示不过滤）。
	var validSet map[int]struct{}
	filterByCrowd := false
	if crowdId > 0 {
		crowd, err := GetUserCrowdById(crowdId)
		if err != nil {
			// 分群不存在/查询失败：降级为不过滤，记日志，避免整列报错。
			logger.SysError("奖励有效人数计算：分群读取失败，降级为不过滤: " + err.Error())
		} else if crowd != nil {
			ids, err := crowd.GetMatchedUsersWithPagination(0, 0)
			if err != nil {
				logger.SysError("奖励有效人数计算：分群匹配失败，降级为不过滤: " + err.Error())
			} else {
				validSet = make(map[int]struct{}, len(ids))
				for _, id := range ids {
					validSet[id] = struct{}{}
				}
				filterByCrowd = true
			}
		}
	}

	// 3. 扫兑换记录，按 code 聚合当期统计。
	var records []RedeemRecord
	if err := DB.Select("code_id, redeemer_user_id, redeemed_at").Find(&records).Error; err != nil {
		return nil, err
	}

	result := make(map[int]*CodePeriodStat)
	for _, r := range records {
		stat := result[r.CodeId]
		if stat == nil {
			stat = &CodePeriodStat{CodeId: r.CodeId}
			result[r.CodeId] = stat
		}

		// 该兑换人是否命中分群（无分群过滤则恒命中）。
		isValid := !filterByCrowd
		if filterByCrowd {
			if _, ok := validSet[r.RedeemerUserId]; ok {
				isValid = true
			}
		}

		// 历史累计：不受结算游标影响，不清零。
		stat.TotalRedeemed++
		if isValid {
			stat.TotalValidCount++
		}

		// 当期：跳过已结算（redeemed_at <= 该码游标）的记录。
		if cur, ok := cursors[r.CodeId]; ok && r.RedeemedAt <= cur {
			continue
		}
		stat.RedeemedCount++
		if r.RedeemedAt > stat.MaxRedeemedAt {
			stat.MaxRedeemedAt = r.RedeemedAt
		}
		if isValid {
			stat.ValidCount++
		}
	}
	return result, nil
}
