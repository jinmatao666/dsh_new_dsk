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
    "version": "1.4.0",
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
    "version": "1.4.0",
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
    "version": "1.4.0",
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
  }
];
