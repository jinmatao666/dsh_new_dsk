/** Exact interaction-only translations. Unknown host text remains unchanged. */
const permissionLabels = {
  'Read Only': '只读',
  'Workspace Write': '工作区写入',
  'Full access': '完全访问',
  'Custom': '自定义',
  'Write inside the workspace and permitted temporary directories; wider retries require approval.': '允许写入工作区和获准的临时目录；扩大操作范围需要确认。',
  'Full file access without approval prompts.': '允许访问所有文件，不再逐次请求操作确认。',
  'Current sandbox and approval settings do not match a preset.': '当前沙箱和审批设置不属于预设模式。',
}

const currentRisk = {
  'confirm.title': '确认启用完全访问？',
  'confirm.description': '启用完全访问后，智能体将减少确认步骤，并且可以直接执行敏感操作、文件修改或外部命令。请仅在信任当前任务时启用。',
  'confirm.enable': '启用完全访问',
}

/** Namespace contributions for the independently selectable zh-CN language. */
export const dictionaries = {
  conversation: {
    ...permissionLabels,
    'access.fullLabel': '完全访问',
    'access.confirm.title': currentRisk['confirm.title'],
    'access.confirm.description': currentRisk['confirm.description'],
    'access.confirm.enable': currentRisk['confirm.enable'],
  },
  'permission.access': { ...permissionLabels, ...currentRisk },
  'settings.permission': {
    ...permissionLabels,
    'confirm.title': currentRisk['confirm.title'],
    'confirm.description': '启用完全访问后，新会话将减少确认步骤，并且可以直接执行敏感操作、文件修改或外部命令。请仅在信任后续任务时启用。',
    'confirm.enable': currentRisk['confirm.enable'],
  },
  'slash.menu': {
    'Compact older conversation history': '压缩较早的对话历史',
    'Download this Session log as a ZIP archive': '将当前会话日志导出为 ZIP 文件',
    'record feedback about this session': '记录当前会话的反馈',
    'set or view the goal for a long-running task': '设置或查看长期任务目标',
    'Switch the permission preset (sandbox mode + approval policy)': '切换权限模式（沙箱和操作确认策略）',
    'Enter or leave plan mode': '进入或退出计划模式',
    'Switch or inspect the model for this session': '切换或查看当前会话的模型',
  },
  model: {
    'effort.providerDefault': '默认',
    'Off': '关闭', 'Low': '低', 'Medium': '中', 'High': '高',
    'Max': '最高', 'Default': '默认',
  },
  'session-log-download': {
    'header.action': '会话日志',
    'dialog.preparingTitle': '正在导出会话',
    'dialog.preparingDescription': '正在准备包含当前会话、子会话和附件的 ZIP 文件。',
    'dialog.successTitle': '会话日志下载已启动',
    'dialog.successDescription': '浏览器已收到会话日志 ZIP 文件的下载请求。',
    'dialog.savedTitle': '会话日志已保存',
    'dialog.errorTitle': '会话日志导出失败',
    'dialog.commandFailed': '无法启动会话日志导出。',
  },
} satisfies Record<string, Record<string, string>>
