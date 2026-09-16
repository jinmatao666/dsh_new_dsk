/** Generated from the checked-in official skill manifests. */
export const OFFICIAL_SKILLS = [
  {
    "id": "gis-geology-analysis",
    "name": "market-gis-geology-analysis",
    "slug": "market-gis-geology-analysis",
    "display_name": "地质条件分析",
    "category": "空间制图",
    "tags": [
      "官方",
      "推荐"
    ],
    "summary": "识别 GeoJSON、Shape 文件夹或 Shape ZIP 的项目范围，调用 GIS_Service 分析地质环境与地质灾害隐患分区。",
    "description": "读取工作区中的 GeoJSON、完整 Shape 文件夹、.shp 文件或 Shape ZIP，自动提取面范围和坐标系信息，调用地质条件分析服务并交付原始 JSON、Excel 明细表和详尽 Word 分析报告。",
    "capabilities": [
      "GeoJSON 与 Shape 面范围识别",
      "地质灾害隐患分区分析",
      "Excel 明细与 Word 专业报告交付"
    ],
    "version": "1.4.6",
    "team": "ZJUGIS GIS 服务",
    "submitter": "root",
    "created_at": "2026-08-29 09:30:00",
    "updated_at": "2026-08-29 09:30:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "inputPath",
        "type": "file",
        "required": true,
        "description": "Polygon/MultiPolygon GeoJSON、.shp、包含完整 Shape 文件的 ZIP 或文件夹"
      },
      {
        "name": "YfxFieldName",
        "type": "string",
        "required": false,
        "description": "分区名称字段",
        "defaultValue": "分区名称"
      }
    ],
    "package_files": [
      "manifest.json",
      "SKILL.md",
      "scripts/invoke.ps1",
      "scripts/export-office.ps1",
      "references/api.md"
    ],
    "package_base": "/skills/market-gis-geology-analysis",
    "source": "official-package"
  },
  {
    "id": "gis-land-use-plan-review",
    "name": "market-gis-land-use-plan-review",
    "slug": "market-gis-land-use-plan-review",
    "display_name": "土地利用规划审查",
    "category": "空间制图",
    "tags": [
      "官方",
      "推荐"
    ],
    "summary": "识别 GeoJSON、Shape 文件夹或 Shape ZIP 的项目范围，调用 GIS_Service 开展土地利用规划符合性审查。",
    "description": "读取工作区中的 GeoJSON、完整 Shape 文件夹、.shp 文件或 Shape ZIP，自动提取面范围和坐标系信息，调用规划审查接口并交付原始 JSON、Excel 明细表和详尽 Word 分析报告。当前服务示例审查类别 Blxsw 默认为 4。",
    "capabilities": [
      "GeoJSON 与 Shape 面范围识别",
      "土地利用规划符合性审查",
      "Excel 明细与 Word 专业报告交付"
    ],
    "version": "1.4.6",
    "team": "ZJUGIS GIS 服务",
    "submitter": "root",
    "created_at": "2026-08-29 09:35:00",
    "updated_at": "2026-08-29 09:35:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "inputPath",
        "type": "file",
        "required": true,
        "description": "Polygon/MultiPolygon GeoJSON、.shp、包含完整 Shape 文件的 ZIP 或文件夹"
      },
      {
        "name": "Blxsw",
        "type": "number",
        "required": false,
        "description": "服务审查类别编码",
        "defaultValue": "4"
      }
    ],
    "package_files": [
      "manifest.json",
      "SKILL.md",
      "scripts/invoke.ps1",
      "scripts/invoke-implementation.ps1",
      "scripts/export-office.ps1",
      "references/api.md"
    ],
    "package_base": "/skills/market-gis-land-use-plan-review",
    "source": "official-package"
  },
  {
    "id": "gis-third-survey-analysis",
    "name": "market-gis-third-survey-analysis",
    "slug": "market-gis-third-survey-analysis",
    "display_name": "三调土地利用现状分析",
    "category": "空间制图",
    "tags": [
      "官方",
      "推荐"
    ],
    "summary": "识别 GeoJSON、Shape 文件夹或 Shape ZIP 的项目范围，调用 GIS_Service 开展三调土地利用现状与图斑分析。",
    "description": "读取工作区中的 GeoJSON、完整 Shape 文件夹、.shp 文件或 Shape ZIP，自动提取面范围和坐标系信息，调用 SanDXzAnalysis 并交付原始 JSON、Excel 明细表和详尽 Word 分析报告。",
    "capabilities": [
      "GeoJSON 与 Shape 面范围识别",
      "三调现状与图斑分析",
      "Excel 明细与 Word 专业报告交付"
    ],
    "version": "1.4.6",
    "team": "ZJUGIS GIS 服务",
    "submitter": "root",
    "created_at": "2026-08-29 09:40:00",
    "updated_at": "2026-08-29 09:40:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "inputPath",
        "type": "file",
        "required": true,
        "description": "Polygon/MultiPolygon GeoJSON、.shp、包含完整 Shape 文件的 ZIP 或文件夹"
      },
      {
        "name": "Xznf",
        "type": "number",
        "required": false,
        "description": "三调现状年度",
        "defaultValue": "2024"
      }
    ],
    "package_files": [
      "manifest.json",
      "SKILL.md",
      "scripts/invoke.ps1",
      "scripts/invoke-implementation.ps1",
      "scripts/export-office.ps1",
      "references/api.md"
    ],
    "package_base": "/skills/market-gis-third-survey-analysis",
    "source": "official-package"
  },
  {
    "id": "office-batch-rename",
    "name": "office-batch-rename",
    "slug": "office-batch-rename",
    "display_name": "文件批量重命名",
    "category": "办公工具",
    "tags": [
      "官方",
      "办公",
      "演示"
    ],
    "summary": "按项目名、日期、序号等规则批量重命名文件，执行前先生成预览清单。",
    "description": "按项目名、日期、序号等规则批量重命名文件，执行前先生成预览清单。 包含可直接运行的本地处理脚本、依赖说明、错误处理和统一中文交付规范。",
    "capabilities": [
      "批量命名规则生成",
      "执行前 CSV 预览",
      "冲突检查与两阶段安全改名"
    ],
    "version": "1.0.1",
    "team": "万维Buddy 办公工具",
    "submitter": "root",
    "created_at": "2026-09-14 19:00:00",
    "updated_at": "2026-09-14 19:00:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "inputPaths",
        "type": "files",
        "required": true,
        "description": "需要重命名的文件"
      },
      {
        "name": "template",
        "type": "string",
        "required": true,
        "description": "命名模板，支持 {project} {date} {index} {name} {ext}"
      },
      {
        "name": "project",
        "type": "string",
        "required": false,
        "description": "项目名"
      },
      {
        "name": "startIndex",
        "type": "number",
        "required": false,
        "description": "起始序号",
        "defaultValue": "1"
      },
      {
        "name": "outputDirectory",
        "type": "directory",
        "required": false,
        "description": "输出目录；留空时在输入文件旁创建独立目录"
      }
    ],
    "package_files": [
      "manifest.json",
      "SKILL.md",
      "scripts/invoke.ps1",
      "scripts/office_tools.py"
    ],
    "package_base": "/skills/office-batch-rename",
    "source": "official-package"
  },
  {
    "id": "office-document-compare",
    "name": "office-document-compare",
    "slug": "office-document-compare",
    "display_name": "文档对比助手",
    "category": "办公工具",
    "tags": [
      "官方",
      "办公",
      "演示"
    ],
    "summary": "对比两份 Word、PDF 或文本文件，整理新增、删除和修改内容。",
    "description": "对比两份 Word、PDF 或文本文件，整理新增、删除和修改内容。 包含可直接运行的本地处理脚本、依赖说明、错误处理和统一中文交付规范。",
    "capabilities": [
      "Word/PDF/文本差异提取",
      "新增删除内容统计",
      "可读 HTML 与 Markdown 对比报告"
    ],
    "version": "1.0.1",
    "team": "万维Buddy 办公工具",
    "submitter": "root",
    "created_at": "2026-09-14 19:00:00",
    "updated_at": "2026-09-14 19:00:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "originalPath",
        "type": "file",
        "required": true,
        "description": "原始版本"
      },
      {
        "name": "revisedPath",
        "type": "file",
        "required": true,
        "description": "新版本"
      },
      {
        "name": "outputDirectory",
        "type": "directory",
        "required": false,
        "description": "输出目录；留空时在输入文件旁创建独立目录"
      }
    ],
    "package_files": [
      "manifest.json",
      "SKILL.md",
      "scripts/invoke.ps1",
      "scripts/office_tools.py",
      "requirements.txt"
    ],
    "package_base": "/skills/office-document-compare",
    "source": "official-package"
  },
  {
    "id": "office-document-summary",
    "name": "office-document-summary",
    "slug": "office-document-summary",
    "display_name": "文档摘要与要点提取",
    "category": "办公工具",
    "tags": [
      "官方",
      "办公",
      "演示"
    ],
    "summary": "读取 Word、PDF、Excel 和文本材料，提炼重点、风险、时间节点和待办事项。",
    "description": "读取 Word、PDF、Excel 和文本材料，提炼重点、风险、时间节点和待办事项。 包含可直接运行的本地处理脚本、依赖说明、错误处理和统一中文交付规范。",
    "capabilities": [
      "多格式文本提取",
      "结构化摘要与风险识别",
      "待办和时间节点整理"
    ],
    "version": "1.0.1",
    "team": "万维Buddy 办公工具",
    "submitter": "root",
    "created_at": "2026-09-14 19:00:00",
    "updated_at": "2026-09-14 19:00:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "inputPaths",
        "type": "files",
        "required": true,
        "description": "一个或多个 Word、PDF、Excel 或文本文件"
      },
      {
        "name": "focus",
        "type": "string",
        "required": false,
        "description": "可选关注重点"
      },
      {
        "name": "outputDirectory",
        "type": "directory",
        "required": false,
        "description": "输出目录；留空时在输入文件旁创建独立目录"
      }
    ],
    "package_files": [
      "manifest.json",
      "SKILL.md",
      "scripts/invoke.ps1",
      "scripts/office_tools.py",
      "requirements.txt"
    ],
    "package_base": "/skills/office-document-summary",
    "source": "official-package"
  },
  {
    "id": "office-excel-data-cleaner",
    "name": "office-excel-data-cleaner",
    "slug": "office-excel-data-cleaner",
    "display_name": "Excel 数据处理",
    "category": "办公工具",
    "tags": [
      "官方",
      "办公",
      "演示"
    ],
    "summary": "清理 Excel 台账，完成去重、筛选、文本规范化、格式统一和基础统计。",
    "description": "清理 Excel 台账，完成去重、筛选、文本规范化、格式统一和基础统计。 包含可直接运行的本地处理脚本、依赖说明、错误处理和统一中文交付规范。",
    "capabilities": [
      "Excel 去重与筛选",
      "文本和表格格式统一",
      "基础统计与处理报告"
    ],
    "version": "1.0.1",
    "team": "万维Buddy 办公工具",
    "submitter": "root",
    "created_at": "2026-09-14 19:00:00",
    "updated_at": "2026-09-14 19:00:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "inputPath",
        "type": "file",
        "required": true,
        "description": "Excel 工作簿"
      },
      {
        "name": "sheet",
        "type": "string",
        "required": false,
        "description": "工作表名称；留空使用首个工作表"
      },
      {
        "name": "dedupeColumns",
        "type": "string",
        "required": false,
        "description": "去重列名，多个用英文逗号分隔"
      },
      {
        "name": "filter",
        "type": "string",
        "required": false,
        "description": "筛选条件，例如 状态=有效"
      },
      {
        "name": "outputDirectory",
        "type": "directory",
        "required": false,
        "description": "输出目录；留空时在输入文件旁创建独立目录"
      }
    ],
    "package_files": [
      "manifest.json",
      "SKILL.md",
      "scripts/invoke.ps1",
      "scripts/office_tools.py",
      "requirements.txt"
    ],
    "package_base": "/skills/office-excel-data-cleaner",
    "source": "official-package"
  },
  {
    "id": "office-image-optimizer",
    "name": "office-image-optimizer",
    "slug": "office-image-optimizer",
    "display_name": "图片压缩与格式转换",
    "category": "办公工具",
    "tags": [
      "官方",
      "办公",
      "演示"
    ],
    "summary": "批量压缩图片、按最大尺寸缩放，并转换为 JPG、PNG 或 WebP。",
    "description": "批量压缩图片、按最大尺寸缩放，并转换为 JPG、PNG 或 WebP。 包含可直接运行的本地处理脚本、依赖说明、错误处理和统一中文交付规范。",
    "capabilities": [
      "批量图片压缩",
      "等比例尺寸调整",
      "JPG/PNG/WebP 格式转换"
    ],
    "version": "1.0.1",
    "team": "万维Buddy 办公工具",
    "submitter": "root",
    "created_at": "2026-09-14 19:00:00",
    "updated_at": "2026-09-14 19:00:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "inputPaths",
        "type": "files",
        "required": true,
        "description": "一个或多个图片"
      },
      {
        "name": "format",
        "type": "select",
        "required": true,
        "description": "输出格式",
        "options": [
          "jpg",
          "png",
          "webp"
        ],
        "defaultValue": "jpg"
      },
      {
        "name": "quality",
        "type": "number",
        "required": false,
        "description": "质量 1–100",
        "defaultValue": "85"
      },
      {
        "name": "maxWidth",
        "type": "number",
        "required": false,
        "description": "最大宽度；0 表示不限制",
        "defaultValue": "0"
      },
      {
        "name": "maxHeight",
        "type": "number",
        "required": false,
        "description": "最大高度；0 表示不限制",
        "defaultValue": "0"
      },
      {
        "name": "outputDirectory",
        "type": "directory",
        "required": false,
        "description": "输出目录；留空时在输入文件旁创建独立目录"
      }
    ],
    "package_files": [
      "manifest.json",
      "SKILL.md",
      "scripts/invoke.ps1",
      "scripts/office_tools.py",
      "requirements.txt"
    ],
    "package_base": "/skills/office-image-optimizer",
    "source": "official-package"
  },
  {
    "id": "office-images-to-pdf",
    "name": "office-images-to-pdf",
    "slug": "office-images-to-pdf",
    "display_name": "图片转 PDF",
    "category": "办公工具",
    "tags": [
      "官方",
      "办公",
      "演示"
    ],
    "summary": "将多张图片按指定顺序排版为一个 PDF，支持常见纸张、方向和页边距。",
    "description": "将多张图片按指定顺序排版为一个 PDF，支持常见纸张、方向和页边距。 包含可直接运行的本地处理脚本、依赖说明、错误处理和统一中文交付规范。",
    "capabilities": [
      "多图按序合成 PDF",
      "A4/A3/Letter 与原尺寸",
      "自动旋转和留白排版"
    ],
    "version": "1.0.1",
    "team": "万维Buddy 办公工具",
    "submitter": "root",
    "created_at": "2026-09-14 19:00:00",
    "updated_at": "2026-09-14 19:00:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "inputPaths",
        "type": "files",
        "required": true,
        "description": "按页面顺序提供图片"
      },
      {
        "name": "pageSize",
        "type": "select",
        "required": true,
        "description": "纸张",
        "options": [
          "A4",
          "A3",
          "Letter",
          "original"
        ],
        "defaultValue": "A4"
      },
      {
        "name": "orientation",
        "type": "select",
        "required": true,
        "description": "方向",
        "options": [
          "auto",
          "portrait",
          "landscape"
        ],
        "defaultValue": "auto"
      },
      {
        "name": "marginMm",
        "type": "number",
        "required": false,
        "description": "页边距（毫米）",
        "defaultValue": "10"
      },
      {
        "name": "outputDirectory",
        "type": "directory",
        "required": false,
        "description": "输出目录；留空时在输入文件旁创建独立目录"
      }
    ],
    "package_files": [
      "manifest.json",
      "SKILL.md",
      "scripts/invoke.ps1",
      "scripts/office_tools.py",
      "requirements.txt"
    ],
    "package_base": "/skills/office-images-to-pdf",
    "source": "official-package"
  },
  {
    "id": "office-meeting-minutes",
    "name": "office-meeting-minutes",
    "slug": "office-meeting-minutes",
    "display_name": "会议纪要",
    "category": "办公工具",
    "tags": [
      "官方",
      "办公",
      "演示"
    ],
    "summary": "将常见音频转换、分段转写，并结合会议材料生成结构化会议纪要。",
    "description": "将常见音频转换、分段转写，并结合会议材料生成结构化会议纪要。 包含可直接运行的本地处理脚本、依赖说明、错误处理和统一中文交付规范。",
    "capabilities": [
      "Qwen3-ASR 或后台百炼 Qwen-Audio 语音转写",
      "音频转 WAV 与长录音分段转写",
      "Qwen3.8 结构化会议纪要",
      "Markdown 与 Word 交付"
    ],
    "version": "1.0.3",
    "team": "万维Buddy 办公工具",
    "submitter": "root",
    "created_at": "2026-09-14 19:00:00",
    "updated_at": "2026-09-14 19:00:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "materials",
        "type": "files",
        "required": false,
        "description": "可选会议材料或已有转写稿"
      },
      {
        "name": "audioPath",
        "type": "file",
        "required": false,
        "description": "可选 WAV、M4A、MP3 等语音文件；长音频自动分段转写"
      },
      {
        "name": "meetingTitle",
        "type": "string",
        "required": false,
        "description": "会议名称"
      },
      {
        "name": "outputDirectory",
        "type": "directory",
        "required": false,
        "description": "输出目录；留空时在输入文件旁创建独立目录"
      }
    ],
    "package_files": [
      "manifest.json",
      "SKILL.md",
      "scripts/invoke.ps1",
      "scripts/office_tools.py",
      "requirements.txt"
    ],
    "package_base": "/skills/office-meeting-minutes",
    "source": "official-package"
  },
  {
    "id": "office-pdf-organizer",
    "name": "office-pdf-organizer",
    "slug": "office-pdf-organizer",
    "display_name": "PDF 合并拆分",
    "category": "办公工具",
    "tags": [
      "官方",
      "办公",
      "演示"
    ],
    "summary": "将多个 PDF 按指定顺序合并，或按页码范围拆分和提取页面。",
    "description": "将多个 PDF 按指定顺序合并，或按页码范围拆分和提取页面。 包含可直接运行的本地处理脚本、依赖说明、错误处理和统一中文交付规范。",
    "capabilities": [
      "PDF 顺序合并",
      "按页码范围拆分",
      "按单页批量拆分"
    ],
    "version": "1.0.1",
    "team": "万维Buddy 办公工具",
    "submitter": "root",
    "created_at": "2026-09-14 19:00:00",
    "updated_at": "2026-09-14 19:00:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "operation",
        "type": "select",
        "required": true,
        "description": "处理方式",
        "options": [
          "merge",
          "split"
        ],
        "defaultValue": "merge"
      },
      {
        "name": "inputPaths",
        "type": "files",
        "required": true,
        "description": "合并时按顺序提供 PDF；拆分时提供一个 PDF"
      },
      {
        "name": "ranges",
        "type": "string",
        "required": false,
        "description": "拆分页码，例如 1-3,5,8-10"
      },
      {
        "name": "outputDirectory",
        "type": "directory",
        "required": false,
        "description": "输出目录；留空时在输入文件旁创建独立目录"
      }
    ],
    "package_files": [
      "manifest.json",
      "SKILL.md",
      "scripts/invoke.ps1",
      "scripts/office_tools.py",
      "requirements.txt"
    ],
    "package_base": "/skills/office-pdf-organizer",
    "source": "official-package"
  },
  {
    "id": "office-pdf-to-images",
    "name": "office-pdf-to-images",
    "slug": "office-pdf-to-images",
    "display_name": "PDF 转图片",
    "category": "办公工具",
    "tags": [
      "官方",
      "办公",
      "演示"
    ],
    "summary": "将 PDF 每一页批量转换为 PNG 或 JPG，支持清晰度和页码范围控制。",
    "description": "将 PDF 每一页批量转换为 PNG 或 JPG，支持清晰度和页码范围控制。 包含可直接运行的本地处理脚本、依赖说明、错误处理和统一中文交付规范。",
    "capabilities": [
      "PDF 逐页转图",
      "PNG 与 JPG 输出",
      "页码范围和清晰度控制"
    ],
    "version": "1.0.1",
    "team": "万维Buddy 办公工具",
    "submitter": "root",
    "created_at": "2026-09-14 19:00:00",
    "updated_at": "2026-09-14 19:00:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "inputPath",
        "type": "file",
        "required": true,
        "description": "PDF 文件"
      },
      {
        "name": "format",
        "type": "select",
        "required": true,
        "description": "图片格式",
        "options": [
          "png",
          "jpg"
        ],
        "defaultValue": "png"
      },
      {
        "name": "dpi",
        "type": "number",
        "required": false,
        "description": "清晰度 DPI",
        "defaultValue": "144"
      },
      {
        "name": "pages",
        "type": "string",
        "required": false,
        "description": "可选页码范围，例如 1-3,5"
      },
      {
        "name": "outputDirectory",
        "type": "directory",
        "required": false,
        "description": "输出目录；留空时在输入文件旁创建独立目录"
      }
    ],
    "package_files": [
      "manifest.json",
      "SKILL.md",
      "scripts/invoke.ps1",
      "scripts/office_tools.py",
      "requirements.txt"
    ],
    "package_base": "/skills/office-pdf-to-images",
    "source": "official-package"
  },
  {
    "id": "office-word-to-pdf",
    "name": "office-word-to-pdf",
    "slug": "office-word-to-pdf",
    "display_name": "Word 转 PDF",
    "category": "办公工具",
    "tags": [
      "官方",
      "办公",
      "演示"
    ],
    "summary": "将一个或多个 Word 文档转换为便于打印、发送和归档的 PDF，并保持原文件不变。",
    "description": "将一个或多个 Word 文档转换为便于打印、发送和归档的 PDF，并保持原文件不变。 包含可直接运行的本地处理脚本、依赖说明、错误处理和统一中文交付规范。",
    "capabilities": [
      "Word 批量转 PDF",
      "Microsoft Word、WPS 与 LibreOffice 逐级回退",
      "不覆盖原文件并生成处理报告"
    ],
    "version": "1.0.1",
    "team": "万维Buddy 办公工具",
    "submitter": "root",
    "created_at": "2026-09-14 19:00:00",
    "updated_at": "2026-09-14 19:00:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "inputPaths",
        "type": "files",
        "required": true,
        "description": "一个或多个 .doc、.docx、.docm 文件"
      },
      {
        "name": "outputDirectory",
        "type": "directory",
        "required": false,
        "description": "输出目录；留空时在输入文件旁创建独立目录"
      }
    ],
    "package_files": [
      "manifest.json",
      "SKILL.md",
      "scripts/invoke.ps1"
    ],
    "package_base": "/skills/office-word-to-pdf",
    "source": "official-package"
  }
];
