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
    "summary": "调用 GIS_Service 分析指定面范围的地质灾害隐患分区与地质环境条件。",
    "description": "读取当前工作区的 GeoJSON 面范围，调用地质条件分析服务并交付不可覆盖的原始分析结果。使用前必须确认输入坐标系与服务数据一致。",
    "capabilities": [
      "GeoJSON 面范围校验",
      "地质灾害隐患分区分析",
      "原始分析结果留档"
    ],
    "version": "1.0.0",
    "team": "ZJUGIS GIS 服务",
    "submitter": "root",
    "created_at": "2026-08-29 09:30:00",
    "updated_at": "2026-08-29 09:30:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "geoJsonFile",
        "type": "file",
        "required": true,
        "description": "包含 Polygon 或 MultiPolygon 的 GeoJSON 文件"
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
    "summary": "调用 GIS_Service 对项目范围开展土地利用规划符合性审查。",
    "description": "读取当前工作区的 GeoJSON 面范围，调用规划审查接口并交付不可覆盖的原始审查结果。当前服务示例审查类别 Blxsw 默认为 4。",
    "capabilities": [
      "GeoJSON 面范围校验",
      "土地利用规划符合性审查",
      "原始审查结果留档"
    ],
    "version": "1.0.0",
    "team": "ZJUGIS GIS 服务",
    "submitter": "root",
    "created_at": "2026-08-29 09:35:00",
    "updated_at": "2026-08-29 09:35:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "geoJsonFile",
        "type": "file",
        "required": true,
        "description": "包含 Polygon 或 MultiPolygon 的 GeoJSON 文件"
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
    "summary": "调用 GIS_Service 对指定面范围开展三调土地利用现状与图斑专项分析。",
    "description": "读取当前工作区的 GeoJSON 面范围与三调年度，调用 SanDXzAnalysis 并交付不可覆盖的原始分析结果。",
    "capabilities": [
      "GeoJSON 面范围校验",
      "三调现状与图斑分析",
      "原始分析结果留档"
    ],
    "version": "1.0.0",
    "team": "ZJUGIS GIS 服务",
    "submitter": "root",
    "created_at": "2026-08-29 09:40:00",
    "updated_at": "2026-08-29 09:40:00",
    "downloads": 0,
    "status": "published",
    "params": [
      {
        "name": "geoJsonFile",
        "type": "file",
        "required": true,
        "description": "包含 Polygon 或 MultiPolygon 的 GeoJSON 文件"
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
      "references/api.md"
    ],
    "package_base": "/skills/market-gis-third-survey-analysis",
    "source": "official-package"
  }
];
