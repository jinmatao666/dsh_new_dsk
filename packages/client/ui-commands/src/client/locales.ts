/** `command` namespace dictionaries (the popupSelect shell's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'search.placeholder': '搜索…',
  'search.aria': '筛选选项',
  'status.loading': '正在加载选项…',
  'status.applying': '正在应用…',
  'status.empty': '无选项',
  'overlay.aria': '/{command} 选项',
  'listbox.aria': '/{command} 匹配项',
  'notice.imagesUnsupported': '/{command} 不接受图片附件，请先移除图片',
  'host.goal.description': '设置或查看长期任务目标',
  'host.goal.hint': '<目标>',
  'host.permission.description': '切换访问权限与审批方式',
  'host.permission.hint': '<权限预设>',
  'host.plan.description': '进入或退出计划模式',
  'host.plan.hint': '[关闭|任务说明]',
  'host.model.description': '选择本会话使用的模型',
  'host.model.hint': '<模型>',
} satisfies Record<string, string>

/** The command namespace key union. */
export type CommandKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
  'notice.imagesUnsupported': '/{command} does not accept image attachments; remove them first',
  'host.goal.description': 'set or view the goal for a long-running task',
  'host.goal.hint': '<objective>',
  'host.permission.description': 'Switch the permission preset (sandbox mode + approval policy)',
  'host.permission.hint': '<preset>',
  'host.plan.description': 'Enter or leave plan mode',
  'host.plan.hint': '[off|message]',
  'host.model.description': 'Select the model for this conversation',
  'host.model.hint': '<model>',
} satisfies Record<CommandKey, string>
