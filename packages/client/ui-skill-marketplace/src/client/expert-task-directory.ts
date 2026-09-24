/** Desktop expert tasks need a real folder even when the Host uses the native picker. */
export async function createExpertTaskDirectory(
  invoke: (command: string, args: unknown) => Promise<unknown>,
  parent: string,
  name: string,
): Promise<string> {
  const directory = await invoke('create_expert_task_directory', { parent, name })
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new Error('无法创建专家任务目录。')
  }
  return directory
}
