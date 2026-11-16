package controller

import (
	"bytes"
	"context"
	"errors"
	"image/jpeg"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/service/ragflow"
	"gorm.io/gorm"
)

func queueKnowledgePDFCover(ctx context.Context, baseId int, filename string, documents []ragflow.Document) {
	if !strings.HasSuffix(strings.ToLower(filename), ".pdf") {
		return
	}
	for _, id := range knowledgeDocumentIDs(documents) {
		if err := model.QueueKnowledgeDocumentCover(baseId, id); err != nil {
			logger.Errorf(ctx, "queue PDF cover: %s", err)
		}
	}
}

// RunKnowledgeDocumentCovers processes durable jobs independently of upload requests.
func RunKnowledgeDocumentCovers(ctx context.Context) {
	renderer, err := exec.LookPath("pdftoppm")
	if err != nil {
		logger.SysError("PDF covers pending: pdftoppm is unavailable on PATH")
		return
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for ctx.Err() == nil {
		job, err := model.ClaimKnowledgeDocumentCover(ctx, time.Now(), 90*time.Second)
		if err != nil {
			logger.Errorf(ctx, "claim PDF cover: %s", err)
		} else if job != nil {
			runKnowledgeCoverJob(ctx, renderer, job)
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runKnowledgeCoverJob(ctx context.Context, renderer string, job *model.KnowledgeDocumentCover) {
	var cover []byte
	var retry time.Time
	if job.Attempts <= 3 {
		work, cancel := context.WithTimeout(ctx, 45*time.Second)
		var err error
		cover, err = downloadAndRenderKnowledgeCover(work, renderer, job)
		cancel()
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			logger.Errorf(ctx, "generate PDF cover for library %d: %s", job.KnowledgeBaseId, err)
			if job.Attempts < 3 {
				retry = time.Now().Add(time.Duration(job.Attempts) * 10 * time.Second)
			}
		}
	}
	if err := model.FinishKnowledgeDocumentCover(ctx, job, cover, retry); err != nil && ctx.Err() == nil {
		logger.Errorf(ctx, "save PDF cover: %s", err)
	}
}

func downloadAndRenderKnowledgeCover(ctx context.Context, renderer string, job *model.KnowledgeDocumentCover) ([]byte, error) {
	base, err := model.GetKnowledgeBase(job.KnowledgeBaseId)
	if err != nil {
		return nil, err
	}
	client, err := ragflow.NewFromEnvironment()
	if err != nil {
		return nil, err
	}
	_, pdf, err := client.DownloadDocument(ctx, base.RagflowDatasetId, job.DocumentId)
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, renderer, "-f", "1", "-l", "1", "-scale-to", "320", "-singlefile", "-jpeg", "-")
	cmd.Stdin = bytes.NewReader(pdf)
	cover, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(cover))
	if err != nil || cfg.Width > 320 || cfg.Height > 320 || len(cover) > 256<<10 {
		return nil, errors.New("invalid PDF cover output")
	}
	return cover, nil
}

// GetKnowledgeDocumentCover returns a stored cover to a reader entitled to preview the file.
func GetKnowledgeDocumentCover(c *gin.Context) {
	documentId, ok := managedDocumentID(c)
	if !ok {
		return
	}
	base, ok := authorizedKnowledgeBase(c)
	if !ok {
		return
	}
	if !allowPassiveKnowledgePreview(c, base, documentId) {
		return
	}
	var cover model.KnowledgeDocumentCover
	err := model.DB.WithContext(c.Request.Context()).Select("jpeg").
		Where("knowledge_base_id = ? AND document_id = ? AND status = ?", base.Id, documentId, "ready").Take(&cover).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		knowledgeCreditFailure(c, http.StatusNotFound, errors.New("暂无文件封面"))
		return
	}
	if err != nil {
		knowledgeCreditFailure(c, http.StatusInternalServerError, errors.New("读取文件封面失败"))
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, gin.H{"success": true, "data": cover.JPEG})
}

func allowPassiveKnowledgePreview(c *gin.Context, base *model.KnowledgeBase, documentId string) bool {
	userId := c.GetInt("id")
	terms, err := model.ReadKnowledgeCreditTerms(base, userId)
	if err != nil {
		knowledgeCreditFailure(c, http.StatusInternalServerError, err)
		return false
	}
	if terms == nil || terms.Price.BrowseCents == 0 {
		return true
	}
	until, err := model.KnowledgePreviewPaidUntil(userId, base.Id, documentId)
	if err != nil {
		knowledgeCreditFailure(c, http.StatusInternalServerError, err)
		return false
	}
	if !until.After(time.Now()) {
		knowledgeCreditFailure(c, http.StatusPaymentRequired, errors.New("请先打开文件预览"))
		return false
	}
	return true
}
