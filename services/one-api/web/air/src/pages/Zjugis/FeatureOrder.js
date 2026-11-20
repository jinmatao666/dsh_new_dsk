export const FEATURE_ENTRIES = [['automations', '自动化'], ['connectors', '连接器'], ['knowledgeBases', '知识库'], ['expertLibrary', '专家库'], ['landMarket', '土地市场'], ['skillMarketplace', '技能市场'], ['planningLecture', '资规讲坛'], ['policyEncyclopedia', '政策宝典']];
export const DEFAULT_FEATURE_ORDER = FEATURE_ENTRIES.map(([key]) => key);
export function normalizeFeatureOrder(value) {
  if (value === undefined) return [...DEFAULT_FEATURE_ORDER];
  if (!Array.isArray(value) || value.length !== DEFAULT_FEATURE_ORDER.length || new Set(value).size !== value.length || value.some(key => !DEFAULT_FEATURE_ORDER.includes(key))) throw new Error('功能排序配置无效');
  return [...value];
}
export function moveFeature(order, from, to) {
  const next = [...order];
  const source = next.indexOf(from), target = next.indexOf(to);
  if (source < 0 || target < 0 || source === target) return next;
  next.splice(source, 1); next.splice(target, 0, from);
  return next;
}
