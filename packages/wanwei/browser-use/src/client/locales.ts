/** Browser assistant settings copy. */
export const zh = {
  title: '浏览器助手', description: '允许 AI 操作本机浏览器完成网页任务。',
  enabled: '已启用', disabled: '已停用', saving: '正在保存…',
  expand: '展开：浏览器助手', collapse: '收起：浏览器助手', permission: '启用浏览器助手',
  intranet: '纯内网环境暂不可用', unavailable: '当前无法修改设置',
  failed: '保存失败，请重试', timing: '开关自动保存，对后续浏览器调用生效；已开始的操作不会强制中断。',
}
/** Matching English settings copy. */
export const en: Record<keyof typeof zh, string> = {
  title: 'Browser assistant', description: 'Allow AI to operate a local browser for web tasks.',
  enabled: 'Enabled', disabled: 'Disabled', saving: 'Saving…',
  expand: 'Expand: Browser assistant', collapse: 'Collapse: Browser assistant', permission: 'Enable browser assistant',
  intranet: 'Unavailable in pure intranet mode', unavailable: 'Settings are not writable',
  failed: 'Could not save. Try again.', timing: 'Changes save automatically and apply to subsequent browser calls; running operations are not interrupted.',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'wanwei.browser': keyof typeof zh }
}
