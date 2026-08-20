// checkin-reset —— 测试用：清除指定用户「今天」的签到痕迹，便于反复重测自动签到。
//
// 单事务一致回滚以下四处（金额按今天实发精确回减，防止像 users.quota 那样漂移）：
//  1. activity_participations —— 今天该用户在签到活动下的参与记录（签到判定依据）
//  2. user_timed_quotas       —— 签到合并批次（source=activity, source_ref=activity_{id}）按额回减，空则删行
//  3. users                   —— timed_quota_total / quota 汇总列回减
//  4. activities.used_budget  —— 活动已用预算回减
//  5. logs                    —— 今天的签到流水（权益变更记录展示源）
//
// 用法（在 packages/one-api 目录）：
//
//	go run ./cmd/checkin-reset               # 默认 user=315, activity=5，仅打印当前状态（dry-run）
//	go run ./cmd/checkin-reset -user 315 -activity 5 -do   # 实际删除
//
// DSN 取自环境变量 SQL_DSN。支持 MySQL DSN 与 postgres:// URL。
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"os"
	"strings"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func bindQuery(query string, postgres bool) string {
	if !postgres {
		return query
	}
	var result strings.Builder
	parameter := 1
	for _, char := range query {
		if char == '?' {
			fmt.Fprintf(&result, "$%d", parameter)
			parameter++
		} else {
			result.WriteRune(char)
		}
	}
	return result.String()
}

func main() {
	uid := flag.Int("user", 315, "用户 ID")
	activityID := flag.Int("activity", 5, "签到活动 ID")
	do := flag.Bool("do", false, "true=实际删除；缺省=dry-run 仅打印")
	flag.Parse()

	dsn := os.Getenv("SQL_DSN")
	if dsn == "" {
		fmt.Println("SQL_DSN is required")
		os.Exit(1)
	}
	postgres := strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://")
	driver := "mysql"
	logTimeExpr := "FROM_UNIXTIME(created_at)"
	if postgres {
		driver = "pgx"
		logTimeExpr = "TO_TIMESTAMP(created_at)"
	}
	query := func(value string) string {
		return bindQuery(value, postgres)
	}

	db, err := sql.Open(driver, dsn)
	if err != nil {
		fmt.Println("open error:", err)
		os.Exit(1)
	}
	defer db.Close()

	sourceRef := fmt.Sprintf("activity_%d", *activityID)

	printState := func(tag string) {
		var quota, timed int64
		db.QueryRow(query(`SELECT quota, timed_quota_total FROM users WHERE id=?`), *uid).Scan(&quota, &timed)
		var pc, lc, tc int
		db.QueryRow(query(`SELECT COUNT(*) FROM activity_participations WHERE user_id=? AND activity_id=? AND DATE(participation_time)=CURRENT_DATE`), *uid, *activityID).Scan(&pc)
		db.QueryRow(query(`SELECT COUNT(*) FROM logs WHERE user_id=? AND content LIKE '%每日签到%' AND `+logTimeExpr+`>=CURRENT_DATE`), *uid).Scan(&lc)
		db.QueryRow(query(`SELECT COUNT(*) FROM user_timed_quotas WHERE user_id=? AND source='activity' AND source_ref=?`), *uid, sourceRef).Scan(&tc)
		var ub int64
		db.QueryRow(query(`SELECT used_budget FROM activities WHERE id=?`), *activityID).Scan(&ub)
		fmt.Printf("[%s] users(quota=%d timed=%d) 今天participation=%d 今天签到日志=%d 签到台账=%d activity.used_budget=%d\n",
			tag, quota, timed, pc, lc, tc, ub)
	}

	printState("before")

	if !*do {
		fmt.Println("\n(dry-run，未删除。加 -do 实际执行)")
		return
	}

	tx, err := db.Begin()
	if err != nil {
		fmt.Println("begin:", err)
		os.Exit(1)
	}

	var todayAmount int64
	tx.QueryRow(query(`SELECT COALESCE(SUM(reward_amount),0) FROM activity_participations
		WHERE user_id=? AND activity_id=? AND DATE(participation_time)=CURRENT_DATE AND reward_status='granted'`),
		*uid, *activityID).Scan(&todayAmount)
	fmt.Printf("今天签到发放合计 = %d\n", todayAmount)

	r1, err := tx.Exec(query(`DELETE FROM activity_participations
		WHERE user_id=? AND activity_id=? AND DATE(participation_time)=CURRENT_DATE`), *uid, *activityID)
	if err != nil {
		tx.Rollback()
		fmt.Println("del participation:", err)
		os.Exit(1)
	}
	n1, _ := r1.RowsAffected()
	fmt.Printf("删除 participation = %d 行\n", n1)

	if todayAmount > 0 {
		if _, err = tx.Exec(query(`UPDATE user_timed_quotas
			SET remaining=GREATEST(remaining-?,0), amount=GREATEST(amount-?,0)
			WHERE user_id=? AND source='activity' AND source_ref=? AND expires_at IS NULL`),
			todayAmount, todayAmount, *uid, sourceRef); err != nil {
			tx.Rollback()
			fmt.Println("update ledger:", err)
			os.Exit(1)
		}
		r2b, _ := tx.Exec(query(`DELETE FROM user_timed_quotas
			WHERE user_id=? AND source='activity' AND source_ref=? AND expires_at IS NULL AND remaining=0 AND amount=0`),
			*uid, sourceRef)
		n2b, _ := r2b.RowsAffected()
		fmt.Printf("删除空台账 = %d 行\n", n2b)

		r3, err := tx.Exec(query(`UPDATE users
			SET timed_quota_total=GREATEST(timed_quota_total-?,0), quota=GREATEST(quota-?,0) WHERE id=?`),
			todayAmount, todayAmount, *uid)
		if err != nil {
			tx.Rollback()
			fmt.Println("update user:", err)
			os.Exit(1)
		}
		n3, _ := r3.RowsAffected()
		fmt.Printf("更新 users = %d 行\n", n3)

		r4, err := tx.Exec(query(`UPDATE activities SET used_budget=GREATEST(used_budget-?,0) WHERE id=?`), todayAmount, *activityID)
		if err != nil {
			tx.Rollback()
			fmt.Println("update activity:", err)
			os.Exit(1)
		}
		n4, _ := r4.RowsAffected()
		fmt.Printf("更新 activity = %d 行\n", n4)
	}

	r5, err := tx.Exec(query(`DELETE FROM logs
		WHERE user_id=? AND content LIKE '%每日签到%' AND `+logTimeExpr+` >= CURRENT_DATE`), *uid)
	if err != nil {
		tx.Rollback()
		fmt.Println("del logs:", err)
		os.Exit(1)
	}
	n5, _ := r5.RowsAffected()
	fmt.Printf("删除签到日志 = %d 行\n", n5)

	if err := tx.Commit(); err != nil {
		fmt.Println("commit:", err)
		os.Exit(1)
	}
	fmt.Println()
	printState("after")
}
