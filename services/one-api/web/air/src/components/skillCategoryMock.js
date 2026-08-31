/**
 * 技能分类演示数据源。
 *
 * 结构与 `/api/skill-category/` 与 `/api/skill-category/types` 对齐：
 * 分类携带 type_id / type_code / type_name / skill_count / status / sort_order /
 * updated_at（unix 秒）。编辑结果只保存在本浏览器。
 */

/** 分类类型（skill_package = 技能包，function_category = 功能分类）。 */
export const MOCK_CATEGORY_TYPES = [
  { id: 1, code: 'skill_package', name: '技能包' },
  { id: 2, code: 'function_category', name: '功能分类' }
];

const TYPE_NAME_BY_ID = Object.fromEntries(MOCK_CATEGORY_TYPES.map((type) => [type.id, type]));

/** 演示数据的更新时间统一落在 2026-08-25 之后（本地时区，返回 unix 秒）。 */
const seedTime = (day, hour, minute) =>
  Math.floor(new Date(`2026-08-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`).getTime() / 1000);

/** 预置分类：5 个业务分类 + 1 个兜底分类 + 4 个功能分类。 */
export const SKILL_CATEGORIES_MOCK = [
  { id: 1, type_id: 1, code: 'spatial-mapping', name: '空间制图', description: '制图、图层处理与 ArcGIS 相关技能。', status: 1, sort_order: 1, skill_count: 6, updated_at: seedTime(25, 10, 0) },
  { id: 2, type_id: 1, code: 'pro-writing', name: '专业写作', description: '合同、报告等规划行业文书写作技能。', status: 1, sort_order: 2, skill_count: 4, updated_at: seedTime(25, 14, 30) },
  { id: 3, type_id: 1, code: 'research-consulting', name: '研究咨询', description: '可研、政策解析与案例研究类技能。', status: 1, sort_order: 3, skill_count: 5, updated_at: seedTime(26, 9, 20) },
  { id: 4, type_id: 1, code: 'office-doc', name: '办公文档', description: '公文、表格与演示文稿处理技能。', status: 1, sort_order: 4, skill_count: 6, updated_at: seedTime(26, 16, 45) },
  { id: 5, type_id: 1, code: 'data-analysis', name: '数据分析', description: '数据清洗、统计与计量分析技能。', status: 1, sort_order: 5, skill_count: 4, updated_at: seedTime(27, 11, 5) },
  { id: 6, type_id: 1, code: 'others', name: '其他', description: '暂未归类的技能。', status: 1, sort_order: 9, skill_count: 1, updated_at: seedTime(27, 18, 30) },
  { id: 7, type_id: 2, code: 'report-gen', name: '报告生成', description: '面向成稿输出的功能分类。', status: 1, sort_order: 1, skill_count: 0, updated_at: seedTime(28, 10, 15) },
  { id: 8, type_id: 2, code: 'data-process', name: '数据处理', description: '面向表格与数据加工的功能分类。', status: 1, sort_order: 2, skill_count: 0, updated_at: seedTime(28, 15, 40) },
  { id: 9, type_id: 2, code: 'map-export', name: '图纸出图', description: '面向批量出图与图纸整饰的功能分类。', status: 1, sort_order: 3, skill_count: 0, updated_at: seedTime(29, 9, 30) },
  { id: 10, type_id: 2, code: 'doc-parse', name: '文档解析', description: '面向文档内容提取的功能分类。', status: 0, sort_order: 4, skill_count: 0, updated_at: seedTime(29, 10, 5) }
].map((category) => ({
  ...category,
  type_code: TYPE_NAME_BY_ID[category.type_id]?.code || '',
  type_name: TYPE_NAME_BY_ID[category.type_id]?.name || ''
}));

export const nextCategoryId = (items) => Math.max(0, ...items.map((item) => item.id)) + 1;
