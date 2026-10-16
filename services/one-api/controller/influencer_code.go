package controller

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
)

// influencerOperationTagName 建码后默认给发码人账户打的标签名（不存在则跳过，不自动创建）。
const influencerOperationTagName = "运营"

// influencerCodeRequest 后台单个创建/更新兑换码的请求体。
//
// 创建：phone 必填（未注册则自动建号），influencer_name / channel 可选。
// 更新：仅 status / influencer_name / channel / remark 生效，其余字段服务端忽略。
type influencerCodeRequest struct {
	Phone          string `json:"phone"`
	InfluencerName string `json:"influencer_name"`
	Channel        string `json:"channel"`
	Remark         string `json:"remark"`
	Status         int    `json:"status"`
}

// resolveIssuerUser 按手机号取发码人账户：已注册直接复用，未注册则自动建号（复刻 PhoneRegister）。
// 返回发码人账户 ID。建号默认密码为 "p"+手机号，PhoneVerified=true，可走验证码登录与密码登录。
func resolveIssuerUser(ctx context.Context, phone string) (int, error) {
	if model.IsPhoneAlreadyTaken(phone) {
		var u model.User
		if err := u.FillUserByPhone(phone); err != nil {
			return 0, err
		}
		return u.Id, nil
	}
	user := &model.User{
		Username:      phone,
		DisplayName:   "P_" + phone,
		Password:      "p" + phone,
		Phone:         phone,
		PhoneVerified: true,
	}
	if err := user.Insert(ctx, 0); err != nil {
		return 0, err
	}
	return user.Id, nil
}

// attachOperationTag 给发码人账户打"运营"标签。标签不存在则跳过（不自动创建）。失败不阻塞主流程。
func attachOperationTag(userId int) {
	tag, err := model.GetUserTagByName(influencerOperationTagName)
	if err != nil {
		logger.SysError("查询运营标签失败: " + err.Error())
		return
	}
	if tag == nil {
		return
	}
	if _, err := model.BatchAttachTagsToUsers([]int{userId}, []int{tag.Id}); err != nil {
		logger.SysError("给发码人账户打运营标签失败: " + err.Error())
	}
}

// createInfluencerCodeForPhone 单条建码内部函数（单建与批量导入共用）：查重→建号→建码→打标。
// channel 必填；同一手机号在不同渠道可各建一码，(手机号,渠道) 唯一。
func createInfluencerCodeForPhone(ctx context.Context, adminId int, phone, name, channel string) (*model.InfluencerCode, error) {
	if channel == "" {
		return nil, errors.New("渠道不能为空")
	}
	issuerId, err := resolveIssuerUser(ctx, phone)
	if err != nil {
		return nil, err
	}
	if name == "" {
		name = "P_" + phone
	}
	ic := &model.InfluencerCode{
		InfluencerName: name,
		Channel:        channel,
		IssuerUserId:   issuerId,
		IssuerPhone:    phone,
		Status:         model.InfluencerCodeStatusEnabled,
		CreatedBy:      adminId,
	}
	if err := model.CreateInfluencerCode(ic); err != nil {
		return nil, err
	}
	attachOperationTag(issuerId)
	return ic, nil
}

// AdminListInfluencerCodes 分页列表（AdminAuth）。
func AdminListInfluencerCodes(c *gin.Context) {
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
	c.JSON(http.StatusOK, gin.H{"success": true, "data": codes, "total": total})
}

// AdminGetInfluencerCode 单个详情（AdminAuth）。
func AdminGetInfluencerCode(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	ic, err := model.GetInfluencerCodeById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "兑换码不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": ic})
}

// AdminCreateInfluencerCode 单个创建（AdminAuth）。未注册手机号自动建号。
func AdminCreateInfluencerCode(c *gin.Context) {
	var req influencerCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求参数错误: " + err.Error()})
		return
	}
	phone := strings.TrimSpace(req.Phone)
	if !isValidPhone(phone) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请输入有效的 11 位手机号"})
		return
	}
	if strings.TrimSpace(req.Channel) == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请输入投放渠道"})
		return
	}
	adminId := c.GetInt("id")
	ic, err := createInfluencerCodeForPhone(c.Request.Context(), adminId, phone, strings.TrimSpace(req.InfluencerName), strings.TrimSpace(req.Channel))
	if err != nil {
		logger.SysError("创建兑换码失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "创建成功", "data": ic})
}

// AdminUpdateInfluencerCode 更新运营字段（AdminAuth）。code / issuer 字段服务端忽略。
func AdminUpdateInfluencerCode(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req influencerCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求参数错误: " + err.Error()})
		return
	}
	ic := &model.InfluencerCode{
		Id:             id,
		Status:         req.Status,
		InfluencerName: strings.TrimSpace(req.InfluencerName),
		Channel:        strings.TrimSpace(req.Channel),
		Remark:         strings.TrimSpace(req.Remark),
	}
	if err := model.UpdateInfluencerCode(ic); err != nil {
		logger.SysError("更新兑换码失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "更新成功"})
}

// AdminDeleteInfluencerCode 删除兑换码（AdminAuth）。
func AdminDeleteInfluencerCode(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if err := model.DeleteInfluencerCode(id); err != nil {
		logger.SysError("删除兑换码失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "删除成功"})
}

// influencerCodeBatchRequest 批量操作请求体。
type influencerCodeBatchRequest struct {
	Ids     []int  `json:"ids"`
	Action  string `json:"action"`  // enable / disable / delete / channel
	Channel string `json:"channel"` // action=channel 时使用
}

// AdminBatchOperateInfluencerCodes 批量操作兑换码（AdminAuth）：启用/停用/删除/改渠道。
func AdminBatchOperateInfluencerCodes(c *gin.Context) {
	var req influencerCodeBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求参数错误: " + err.Error()})
		return
	}
	if len(req.Ids) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "未选择兑换码"})
		return
	}
	var err error
	switch req.Action {
	case "enable":
		err = model.BatchUpdateInfluencerCodeStatus(req.Ids, model.InfluencerCodeStatusEnabled)
	case "disable":
		err = model.BatchUpdateInfluencerCodeStatus(req.Ids, model.InfluencerCodeStatusDisabled)
	case "delete":
		err = model.BatchDeleteInfluencerCodes(req.Ids)
	case "channel":
		err = model.BatchUpdateInfluencerCodeChannel(req.Ids, strings.TrimSpace(req.Channel))
	default:
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "未知的批量操作"})
		return
	}
	if err != nil {
		logger.SysError("批量操作兑换码失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "操作成功"})
}

// isValidPhone 简单校验 11 位手机号（首位 1）。
func isValidPhone(phone string) bool {
	if len(phone) != 11 || phone[0] != '1' {
		return false
	}
	for _, c := range phone {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// batchImportRequest 批量导入请求体：content 为多行文本，每行 `手机号[,达人名][,渠道]`。
type batchImportRequest struct {
	Content string `json:"content"`
}

// batchImportResult 单行导入结果。
type batchImportResult struct {
	Phone   string `json:"phone"`
	Success bool   `json:"success"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message"`
}

// AdminBatchImportInfluencerCodes 批量导入建码（AdminAuth）。
//
// 每行 `手机号[,达人名][,渠道]`，逗号或制表符分隔。首列手机号必填；
// 若首行能被识别为表头（phone/手机号）则跳过。逐行处理，失败不阻塞其余，返回每行结果。
func AdminBatchImportInfluencerCodes(c *gin.Context) {
	var req batchImportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求参数错误: " + err.Error()})
		return
	}
	adminId := c.GetInt("id")
	ctx := c.Request.Context()

	lines := strings.Split(strings.ReplaceAll(req.Content, "\r\n", "\n"), "\n")
	results := make([]batchImportResult, 0, len(lines))
	for i, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		phone, name, channel := parseImportLine(line)
		// 跳过表头行
		if i == 0 && (phone == "phone" || phone == "手机号") {
			continue
		}
		if !isValidPhone(phone) {
			results = append(results, batchImportResult{Phone: phone, Success: false, Message: "手机号格式非法"})
			continue
		}
		ic, err := createInfluencerCodeForPhone(ctx, adminId, phone, name, channel)
		if err != nil {
			results = append(results, batchImportResult{Phone: phone, Success: false, Message: err.Error()})
			continue
		}
		results = append(results, batchImportResult{Phone: phone, Success: true, Code: ic.Code, Message: "创建成功"})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": results})
}

// parseImportLine 解析一行导入数据，支持逗号或制表符分隔，返回 (手机号, 达人名, 渠道)。
func parseImportLine(line string) (phone, name, channel string) {
	sep := ","
	if strings.Contains(line, "\t") {
		sep = "\t"
	}
	parts := strings.Split(line, sep)
	phone = strings.TrimSpace(parts[0])
	if len(parts) > 1 {
		name = strings.TrimSpace(parts[1])
	}
	if len(parts) > 2 {
		channel = strings.TrimSpace(parts[2])
	}
	return phone, name, channel
}

// parseTimeRangeQuery 从 query 取 start_at / end_at（unix 秒），缺省为 0（不限）。
func parseTimeRangeQuery(c *gin.Context) (int64, int64) {
	startAt, _ := strconv.ParseInt(c.Query("start_at"), 10, 64)
	endAt, _ := strconv.ParseInt(c.Query("end_at"), 10, 64)
	return startAt, endAt
}

// redeemRequest 用户兑换请求体。
type redeemRequest struct {
	Code string `json:"code"`
}

// RedeemInfluencerCode 用户兑换达人兑换码（RequirePersonalAccount）。
//
// 发放委托活动系统：校验（绑手机/码有效/非自薅/全局未兑过）→ 写归因 redeem_records →
// TriggerRedeemActivities 按 grant_role 给兑换人 / 发码人各触发对应活动发积分。
// 兑换窗口由 redeem 活动的 start_time/end_time 控制，本接口不再单独校验时间窗口。
func RedeemInfluencerCode(c *gin.Context) {
	ctx := c.Request.Context()
	var req redeemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请求参数错误: " + err.Error()})
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	if code == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请输入兑换码"})
		return
	}

	userId := c.GetInt("id")
	user, err := model.GetUserById(userId, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取用户信息失败"})
		return
	}

	// 1. 校验已绑定手机（"每用户一次"依赖账号体系，未绑手机无法可靠去重）
	if user.Phone == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请先绑定手机号后再兑换", "code": "phone_not_bound"})
		return
	}

	// 2. 查码 + 校验启用
	ic, err := model.GetInfluencerCodeByCode(code)
	if err != nil || ic.Status != model.InfluencerCodeStatusEnabled {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "兑换码无效"})
		return
	}

	// 3. 自薅防护
	if ic.IssuerUserId == userId {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "不能兑换自己的兑换码"})
		return
	}

	// 4. 全局去重（归因侧）
	has, err := model.HasRedeemRecord(userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "校验兑换记录失败"})
		return
	}
	if has {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "您已兑换过兑换码"})
		return
	}

	// 5. 前置闸门：必须存在「兑换人侧」可发放的有效活动，否则判定兑换失败。
	//    奖励额度/有效期/预算/兑换窗口都是活动字段，活动失效（停用/过期/预算耗尽/未配）
	//    就不写归因、不标记已兑换，用户可在运营补好活动后重试（修复"禁用活动仍提示成功"）。
	grantable, err := model.HasGrantableRedeemerActivity(userId)
	if err != nil {
		logger.SysError("校验兑换活动失败 user=" + strconv.Itoa(userId) + ": " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "兑换失败，请稍后重试"})
		return
	}
	if !grantable {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "兑换活动暂未开放，请稍后再试"})
		return
	}

	// 6. 写归因（唯一索引兜底并发重复）
	record := &model.RedeemRecord{
		CodeId:         ic.Id,
		Code:           ic.Code,
		InfluencerName: ic.InfluencerName,
		Channel:        ic.Channel,
		RedeemerUserId: userId,
		IssuerUserId:   ic.IssuerUserId,
	}
	if err := model.CreateRedeemRecord(nil, record); err != nil {
		// 唯一索引冲突 = 并发下已兑过
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "您已兑换过兑换码"})
		return
	}

	// 7. 触发活动发放（双角色非原子，失败仅记日志不回滚归因）
	granted, err := model.TriggerRedeemActivities(ctx, userId, ic.IssuerUserId, ic.Code)
	if err != nil {
		logger.SysError("触发兑换活动发放失败 user=" + strconv.Itoa(userId) + " code=" + ic.Code + ": " + err.Error())
	}

	// 冗余计数 +1（失败不影响主链路）
	if err := model.IncrInfluencerCodeRedeemed(nil, ic.Id); err != nil {
		logger.SysError("累计兑换人数失败 code=" + ic.Code + ": " + err.Error())
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "兑换成功",
		"data":    gin.H{"quota": granted},
	})
}

// RedeemInfluencerCodeStatus 返回当前用户是否已兑换过兑换码（供前端置灰入口）。
func RedeemInfluencerCodeStatus(c *gin.Context) {
	userId := c.GetInt("id")
	redeemed, err := model.HasRedeemRecord(userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "校验兑换记录失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"redeemed": redeemed},
	})
}

// AdminInfluencerCodeStats 按达人/渠道聚合兑换人数（AdminAuth）。
func AdminInfluencerCodeStats(c *gin.Context) {
	startAt, endAt := parseTimeRangeQuery(c)
	rows, err := model.AggregateRedeemStats(startAt, endAt, c.Query("influencer_name"), c.Query("channel"))
	if err != nil {
		logger.SysError("聚合兑换统计失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "聚合统计失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

// AdminInfluencerCodeTrend 按天兑换趋势（AdminAuth）。
func AdminInfluencerCodeTrend(c *gin.Context) {
	startAt, endAt := parseTimeRangeQuery(c)
	rows, err := model.AggregateRedeemTrend(startAt, endAt, c.Query("influencer_name"))
	if err != nil {
		logger.SysError("聚合兑换趋势失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "聚合趋势失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

// AdminInfluencerCodeRedemptions 兑换明细分页（AdminAuth），供导出核账。
func AdminInfluencerCodeRedemptions(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	startAt, endAt := parseTimeRangeQuery(c)
	records, total, err := model.ListRedeemRecords(
		(page-1)*pageSize, pageSize, startAt, endAt,
		c.Query("influencer_name"), c.Query("channel"),
	)
	if err != nil {
		logger.SysError("获取兑换明细失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取兑换明细失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": records, "total": total})
}
