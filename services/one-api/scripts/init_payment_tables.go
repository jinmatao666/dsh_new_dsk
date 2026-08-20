package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "github.com/go-sql-driver/mysql"
)

func main() {
	// 从环境变量读取数据库连接信息;不再提供任何硬编码默认值,
	// 防止凭据泄露 + 误连生产库。历史上这里曾硬编码远程生产 DSN。
	dsn := os.Getenv("SQL_DSN")
	if dsn == "" {
		log.Fatal("必须设置 SQL_DSN 环境变量(MySQL 连接串),不再提供默认 DSN")
	}

	// 连接数据库
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatal("连接数据库失败:", err)
	}
	defer db.Close()

	// 测试连接
	if err := db.Ping(); err != nil {
		log.Fatal("数据库连接测试失败:", err)
	}

	fmt.Println("数据库连接成功")

	// 读取SQL文件
	sqlContent, err := os.ReadFile("sql/payment_tables.sql")
	if err != nil {
		log.Fatal("读取SQL文件失败:", err)
	}

	// 执行SQL（分割多个语句）
	sqlStatements := string(sqlContent)

	// 执行整个SQL脚本
	_, err = db.Exec(sqlStatements)
	if err != nil {
		log.Fatal("执行SQL失败:", err)
	}

	fmt.Println("支付表创建成功！")

	// 验证表是否创建成功
	tables := []string{"recharge_packages", "orders", "recharge_records", "payment_config"}
	for _, table := range tables {
		var count int
		err := db.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM %s", table)).Scan(&count)
		if err != nil {
			log.Printf("警告: 表 %s 可能未创建成功: %v", table, err)
		} else {
			fmt.Printf("✓ 表 %s 已创建，当前记录数: %d\n", table, count)
		}
	}
}
