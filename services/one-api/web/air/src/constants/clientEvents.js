// 客户端埋点事件清单 — 与 packages/app、packages/desktop、packages/ui 中
// telemetry.track / trackLoginEvent 的实际调用保持一致。新增埋点时同步更新此文件。

export const EXCEPTION_EVENTS = [
  '登录异常',
  '启动异常',
  '模型异常',
  '会话中断',
  '会话异常',
  '订阅异常',
  '语音输入异常',
  '自动更新失败',
  'JS运行时错误',
  '未处理异步异常',
  '未登录退出',
  '登录后无操作退出',
  '未选择会话退出',
  '违规输入拦截',
  '通知拉取异常',
  '工具异常',
  '图像编辑异常',
];

export const FEATURE_EVENTS = [
  'dsh_question',
  '进入应用',
  '用户登录',
  '对话',
  '专业写作点击',
  '语音输入点击',
  'IM机器人开关',
  '专业广场操作',
  '会话操作',
  '项目操作',
  '个人库操作',
  '反馈提交',
  '退出软件',
  '首次操作耗时',
  '官网首页访问',
  '官网下载点击',
  '工具调用',
  '技能调用',
  '图像编辑操作',
  '通知曝光',
  '通知点击',
  '通知关闭',
  '站内信已读',
  '阻断层触发',
  '阻断层重试',
];

export const EVENT_CATEGORY = {
  exception: { label: '异常埋点', events: EXCEPTION_EVENTS },
  feature: { label: '功能埋点', events: FEATURE_EVENTS },
};

export const ALL_KNOWN_EVENTS = [...EXCEPTION_EVENTS, ...FEATURE_EVENTS];

export const getEventCategory = (name) => {
  if (EXCEPTION_EVENTS.includes(name)) return 'exception';
  if (FEATURE_EVENTS.includes(name)) return 'feature';
  return 'unknown';
};

// 多级事件分类树：后台自定义看板的「埋点事件」选择器按此树展示，
// 支持只勾父级 = 选中该父级下所有叶子事件。叶子即真实 event_name（上报值）。
// 结构：顶级分类 → (可选)子分类 → 事件名。改埋点分类时改这里即可，
// 后端 /stats、/funnel 仍只吃展开后的 event_name 列表，无需改动。
export const EVENT_TREE = [
  {
    key: 'app',
    label: 'App',
    children: [
      { key: 'app.auth', label: '登录登出', events: ['进入应用', '用户登录', '退出软件'] },
      {
        key: 'app.conversation',
        label: '对话行为',
        events: ['对话', '会话操作', '项目操作', '首次操作耗时', '专业写作点击', '语音输入点击', '工具调用', '技能调用', '图像编辑操作'],
      },
      { key: 'app.plaza', label: '专业广场', events: ['专业广场操作', '个人库操作'] },
      {
        key: 'app.notification',
        label: '通知体系',
        events: ['通知曝光', '通知点击', '通知关闭', '站内信已读', '阻断层触发', '阻断层重试'],
      },
      { key: 'app.other', label: '其他', events: ['IM机器人开关', '反馈提交'] },
    ],
  },
  {
    key: 'site',
    label: '主站',
    events: ['官网首页访问', '官网下载点击'],
  },
  {
    key: 'exception',
    label: '异常埋点',
    events: [...EXCEPTION_EVENTS],
  },
];

// 递归收集一个树节点（及其所有子节点）下的全部叶子事件名。
const collectTreeEvents = (node) => {
  const out = [];
  if (Array.isArray(node.events)) out.push(...node.events);
  if (Array.isArray(node.children)) node.children.forEach((c) => out.push(...collectTreeEvents(c)));
  return out;
};

// 树里已归类的全部事件名（用于识别「未归类的其他事件」）。
export const CLASSIFIED_EVENTS = [...new Set(EVENT_TREE.flatMap(collectTreeEvents))];

// 把发现的未知事件（不在树里的）补成一个顶级「其他」分类，返回完整树。
// discoveredNames 来自后端 event-names 接口，保证新埋点未及时归类也能选到。
export const buildEventTree = (discoveredNames = []) => {
  const known = new Set(CLASSIFIED_EVENTS);
  const extras = [...new Set(discoveredNames)].filter((n) => n && !known.has(n));
  if (extras.length === 0) return EVENT_TREE;
  return [...EVENT_TREE, { key: 'misc', label: '其他', events: extras }];
};

// 展开一批「选中的节点 key 或事件名」到实际事件名列表（去重）。
// 传入既可以是树节点 key（如 'app.auth'）也可以是叶子事件名。
export const expandToEventNames = (selected, discoveredNames = []) => {
  const tree = buildEventTree(discoveredNames);
  const byKey = new Map();
  const walk = (node) => {
    byKey.set(node.key, collectTreeEvents(node));
    (node.children || []).forEach(walk);
  };
  tree.forEach(walk);
  const out = new Set();
  (selected || []).forEach((item) => {
    if (byKey.has(item)) byKey.get(item).forEach((e) => out.add(e));
    else out.add(item); // 已是事件名
  });
  return [...out];
};

// event_data 常见字段的中文含义。埋点上报的 event_data 是自由 JSON，
// 字段名跨事件复用（action/type/context…）。这里维护一份通用字段字典，
// 后台在“细分维度”下拉里把字段名后面显示中文含义，便于选择。
// 新增埋点若引入通用字段，补一行即可；覆盖不到的字段前端会退回展示样例值。
export const EVENT_FIELD_LABELS = {
  action: '操作动作',
  type: '子类型/结果',
  tool: '工具名',
  context: '场景',
  source: '来源',
  platform: '平台',
  enabled: '开关状态',
  name: '名称',
  id: '标识',
  code: '兑换码',
  error: '错误信息',
  count: '数量',
  quota: '额度',
  duration_ms: '耗时(毫秒)',
  sessionID: '会话ID',
  project: '项目',
  url: '地址',
  canRecover: '可恢复',
  durationMs: '耗时(毫秒)',
  attempts: '尝试次数',
  directories: '重新同步项目数',
};

// 细分维度基数阈值：采样内不同取值数 ≤ 此值视为“低基数枚举”，适合当维度；
// 超过则多为标识符/错误信息，拆开无意义，前端降级到“其他字段”。
export const SUBDIVIDE_CARDINALITY_LIMIT = 30;

// 匿名（未登录）事件：上报时没有 user_id，UV 去重键落在 device_id / username 空间，
// 与登录后事件（按 user_id 去重）的身份键不互通。漏斗按用户求交时，
// 把匿名事件和登录事件放同一漏斗会因身份键不匹配而恒为 0——用于前端防呆提示。
// 官网首页/下载在旧埋点里连 device_id 都没有，只能回退 username，跨阶段无法与 App 用户对齐。
export const ANONYMOUS_EVENTS = [
  '官网首页访问',
  '官网下载点击',
];
