import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import css from './MeetingMinutesWorkbench.module.css'
import { ExpertProfileIcon } from './ExpertProfileIcon.tsx'
import type { MeetingResult, MeetingTask, MeetingTaskService } from './meeting-task.ts'
import { meetingIconImages } from './MeetingIconData.ts'
import { geologyIconImages } from './GeologyIconData.ts'

type Section = 'workbench' | 'history' | 'files' | 'guide'
type Step = 'home' | 'prepare' | 'review'
const audioPattern = /\.(?:wav|m4a|mp3)$/i
const materialPattern = /\.(?:txt|md|csv|tsv|json|ya?ml|docx|pdf|xlsx|xlsm)$/i

function Icon({ name }: { name: 'meeting' | 'new' | 'workbench' | 'history' | 'file' | 'guide' | 'audio' | 'material' | 'check' | 'error' | 'clock' }) {
  const source = {
    meeting: meetingIconImages.expert,
    new: meetingIconImages.upload,
    workbench: meetingIconImages.workbench,
    history: meetingIconImages.history,
    file: meetingIconImages.files,
    guide: meetingIconImages.guide,
    audio: meetingIconImages.audio,
    material: meetingIconImages.supplement,
    check: meetingIconImages.success,
    error: meetingIconImages.failed,
    clock: meetingIconImages.history,
  }[name]
  return <img className={css.icon} src={source} alt="" aria-hidden="true" />
}

function validateFiles(files: readonly File[]): string | null {
  if (files.length === 0) return '请添加一份录音或至少一份可读取的文字材料。'
  if (files.filter(file => audioPattern.test(file.name)).length > 1) return '一次任务最多添加一个录音文件。'
  const unsupported = files.filter(file => !audioPattern.test(file.name) && !materialPattern.test(file.name))
  if (unsupported.length > 0) return `暂不支持这些文件：${unsupported.map(file => file.name).join('、')}`
  return null
}

function RichText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/)
  const nodes: JSX.Element[] = []
  for (let index = 0; index < lines.length;) {
    const line = lines[index]?.trim() ?? ''
    if (line.includes('|') && (lines[index + 1]?.trim() ?? '').match(/^\|?\s*:?-+/)) {
      const headers = line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
      const rows: string[][] = []
      index += 2
      while (index < lines.length && (lines[index]?.includes('|') ?? false)) { rows.push((lines[index] ?? '').replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())); index += 1 }
      nodes.push(<div className={css.answerTable} key={`table-${index}`}><table><thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{cell}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{row[cellIndex] ?? '—'}</td>)}</tr>)}</tbody></table></div>)
      continue
    }
    const content = line.replace(/\*\*/g, '')
    if (/^#{1,3}\s/.test(content)) nodes.push(<h4 key={index}>{content.replace(/^#{1,3}\s/, '')}</h4>)
    else if (/^(?:[-•*]|\d+\.)\s/.test(content)) nodes.push(<p className={css.answerPoint} key={index}>{content.replace(/^(?:[-•*]|\d+\.)\s/, '')}</p>)
    else if (content !== '') nodes.push(<p key={index}>{content}</p>)
    else nodes.push(<Fragment key={index}><br /></Fragment>)
    index += 1
  }
  return <div className={css.answer}>{nodes}</div>
}

export function MeetingMinutesWorkbench({ service, expertIcon, expertName, expertSubtitle }: {
  service?: MeetingTaskService
  expertIcon?: string | undefined
  expertName?: string | undefined
  expertSubtitle?: string | undefined
}) {
  const [section, setSection] = useState<Section>('workbench')
  const [step, setStep] = useState<Step>('home')
  const [name, setName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [directory, setDirectory] = useState('')
  const [tasks, setTasks] = useState<readonly MeetingTask[]>([])
  const [results, setResults] = useState<Record<string, MeetingResult>>({})
  const [activeTask, setActiveTask] = useState<MeetingTask | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | MeetingResult['status']>('all')
  const audioInput = useRef<HTMLInputElement>(null)
  const materialInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void service?.list().then(setTasks).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [service])
  const refresh = async (task: MeetingTask) => {
    if (!service) return
    const result = await service.read(task)
    setResults(current => ({ ...current, [task.id]: result }))
    return result
  }
  useEffect(() => {
    if (!service || (section !== 'history' && section !== 'files')) return
    void Promise.all(tasks.map(task => refresh(task))).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [section, service, tasks])
  const startNew = () => { setActiveTask(null); setSection('workbench'); setStep('prepare'); setName(''); setFiles([]); setDirectory(''); setError(null) }
  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return
    const next = [...files, ...Array.from(incoming)].filter((file, index, all) =>
      all.findIndex(item => item.name === file.name && item.size === file.size) === index)
    const validation = validateFiles(next)
    if (validation?.includes('最多添加一个录音')) { setError(validation); return }
    setFiles(next); setDirectory(''); setError(validation)
  }
  const review = async () => {
    const validation = validateFiles(files)
    if (validation) { setError(validation); return }
    if (!service) { setError('当前没有连接会议纪要执行服务。'); return }
    setBusy(true); setError(null)
    try {
      const chosen = directory || await service.chooseDirectory(name)
      if (chosen === null) return
      setDirectory(chosen); setStep('review')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }
  const run = async () => {
    if (!service || !directory) return
    setBusy(true); setError(null)
    try {
      const task = await service.start({ name, files, directory })
      setTasks(current => [task, ...current.filter(item => item.id !== task.id)])
      setActiveTask(task)
      const running: MeetingResult = { task, status: 'running', answer: '' }
      setResults(current => ({ ...current, [task.id]: running }))
      void service.wait(task, result => setResults(current => ({ ...current, [task.id]: result })))
        .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }
  const openTask = async (task: MeetingTask) => { setActiveTask(task); setSection('workbench'); setError(null); try { await refresh(task) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } }
  const listed = useMemo(() => tasks.filter(task => task.name.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || results[task.id]?.status === filter)), [tasks, results, query, filter])
  const words = useMemo(() => tasks.flatMap(task => results[task.id]?.wordPath ? [{ task, path: results[task.id]?.wordPath ?? '' }] : []).filter(item => item.task.name.toLowerCase().includes(query.toLowerCase())), [tasks, results, query])
  const audioCount = files.filter(file => audioPattern.test(file.name)).length
  const materialCount = files.length - audioCount
  const result = activeTask ? results[activeTask.id] : undefined

  const nav: { id: Section; label: string; icon: 'workbench' | 'history' | 'file' | 'guide' }[] = [
    { id: 'workbench', label: '纪要工作台', icon: 'workbench' }, { id: 'history', label: '我的纪要记录', icon: 'history' }, { id: 'files', label: '我的成果文件', icon: 'file' }, { id: 'guide', label: '使用说明', icon: 'guide' },
  ]
  return <div className={css.shell}>
    <aside className={css.sidebar} aria-label="会议纪要专家功能"><div className={css.identity}><span><ExpertProfileIcon icon={expertIcon ?? 'meeting'} /></span><div><strong>{expertName || '会议纪要专家'}</strong><small>{expertSubtitle || '录音转写与结构化纪要'}</small></div></div><button type="button" className={css.newButton} onClick={startNew}><Icon name="new" />新建纪要</button><nav>{nav.map(item => <button type="button" key={item.id} className={section === item.id ? css.active : ''} onClick={() => setSection(item.id)}><img className={css.icon} src={geologyIconImages[item.id === 'workbench' ? 'workspace' : item.id]} alt="" aria-hidden="true" />{item.label}</button>)}</nav><p className={css.sideNote}>每个任务只交付一个 Word 会议纪要</p></aside>
    <main className={css.main}>
      {error && <p className={css.error} role="alert">{error}</p>}
      {section === 'workbench' && activeTask && <TaskResult task={activeTask} result={result} {...(service ? { service } : {})} onHistory={() => setSection('history')} onRetry={startNew} />}
      {section === 'workbench' && !activeTask && <>{step === 'home' ? <MeetingHome tasks={tasks} onStart={startNew} onGuide={() => setSection('guide')} onHistory={() => setSection('history')} /> : <><header className={css.pageHead}><span>会议纪要专家</span><h2>{step === 'prepare' ? '把会议材料整理成一份正式纪要' : '核对本次纪要任务'}</h2><p>可以添加一个录音，也可以只使用已有转写稿和文字材料。</p></header><div className={css.steps}><b className={step === 'prepare' ? css.current : ''}>1　准备材料</b><i /><b className={step === 'review' ? css.current : ''}>2　核对信息</b><i /><b>3　生成纪要</b></div>{step === 'prepare' ? <div className={css.prepareGrid}><div><section className={css.nameField}><label>会议名称（可选）<input value={name} onChange={(event) => { setName(event.target.value); setDirectory('') }} placeholder="例如：项目推进周会" /></label><small>未填写时由材料推断，无法确认则写“未明确”。</small></section><div className={css.sourceGrid}><button type="button" onClick={() => audioInput.current?.click()} onDragOver={event => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const dropped = Array.from(event.dataTransfer.files).filter(file => audioPattern.test(file.name)); if (dropped[0]) { setFiles(current => [...current.filter(file => !audioPattern.test(file.name)), dropped[0] as File]); setDirectory(''); setError(null) } }}><Icon name="audio" /><strong>{audioCount ? '更换录音' : '添加录音'}</strong><small>WAV、M4A 或 MP3，最多一个</small></button><button type="button" onClick={() => materialInput.current?.click()} onDragOver={event => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files) }}><Icon name="material" /><strong>添加会议材料</strong><small>支持常见文字、Word、PDF 和表格材料</small></button></div><input ref={audioInput} hidden type="file" accept=".wav,.m4a,.mp3" onChange={(event) => { const next = event.target.files?.[0]; if (next) { setFiles(current => [...current.filter(file => !audioPattern.test(file.name)), next]); setDirectory(''); setError(null) } }} /><input ref={materialInput} hidden multiple type="file" accept=".txt,.md,.csv,.tsv,.json,.yaml,.yml,.docx,.pdf,.xlsx,.xlsm" onChange={event => addFiles(event.target.files)} />{files.length > 0 && <div className={css.selectedFiles}>{files.map(file => <div key={`${file.name}-${file.size}`}><Icon name={audioPattern.test(file.name) ? 'audio' : 'material'} /><span><strong title={file.name}>{file.name}</strong><small>{audioPattern.test(file.name) ? '录音' : '补充材料'} · {(file.size / 1024).toFixed(1)} KB</small></span><button type="button" aria-label={`移除 ${file.name}`} onClick={() => { setFiles(current => current.filter(item => item !== file)); setDirectory('') }}>×</button></div>)}</div>}<button type="button" className={css.primary} disabled={busy} onClick={() => void review()}>{busy ? '正在准备目录…' : '核对纪要信息'}</button></div><aside className={css.paperNote}><Icon name="meeting" /><h3>材料越清楚，纪要越可靠</h3><p>已有转写稿、议程、签到表和项目资料都可以作为补充。扫描 PDF 没有可读文字时，请先完成 OCR。</p><dl><div><dt>当前录音</dt><dd>{audioCount} 个</dd></div><div><dt>文字材料</dt><dd>{materialCount} 个</dd></div></dl></aside></div> : <Review name={name} files={files} directory={directory} busy={busy} onBack={() => setStep('prepare')} onRun={() => void run()} />}</>}</>}
      {section === 'history' && <ListPage title="我的纪要记录" subtitle="仅显示当前用户在这台设备上创建的会议纪要任务。"><Toolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} />{listed.length === 0 ? <Empty icon="history" title="暂无纪要记录" text="新建纪要后，任务状态和执行摘要会显示在这里。" action={startNew} /> : <div className={css.taskList}>{listed.map(task => <button type="button" key={task.id} onClick={() => void openTask(task)}><span><strong>{task.name}</strong><small>{new Date(task.createdAt).toLocaleString('zh-CN')} · {task.inputs.length} 个来源</small></span><em data-status={results[task.id]?.status ?? 'running'}>{results[task.id]?.status === 'completed' ? '已完成' : results[task.id]?.status === 'failed' ? '未完成' : '处理中'}</em></button>)}</div>}</ListPage>}
      {section === 'files' && <ListPage title="我的成果文件" subtitle="这里只展示本专家实际生成并且仍可访问的 Word 会议纪要。">{words.length === 0 ? <Empty icon="file" title="暂无成果文件" text="任务完成后，唯一的 Word 会议纪要会出现在这里。" action={startNew} /> : <div className={css.wordList}>{words.map(item => <div key={item.path}><Icon name="file" /><span><strong>{item.path.split(/[\\/]/).at(-1)}</strong><small>{item.task.name}</small></span><button type="button" onClick={() => void service?.openFile(item.path)}>打开会议纪要</button></div>)}</div>}</ListPage>}
      {section === 'guide' && <ListPage title="准备清楚的会议来源" subtitle="添加录音、已有转写稿或可读取材料，系统会据此生成结构化 Word 纪要。"><div className={css.guide}><section><h3>可以添加什么</h3><p>一个 WAV、M4A 或 MP3 录音，以及多个 TXT、Markdown、CSV、JSON、YAML、Word、PDF 或 Excel 材料。也可以不添加录音。</p></section><section><h3>材料无法读取时</h3><p>扫描 PDF 请先完成 OCR。非标准 WAV 转换需要 ffmpeg；依赖或转写接口失败时，任务会显示真实原因。</p></section><section><h3>纪要如何处理不明确内容</h3><p>参会人、时间、地点、责任人和截止时间未在材料中出现时会写“未明确”，相对时间保留原文。</p></section><section><h3>会得到什么</h3><p>每个成功任务只交付一个正式 Word 会议纪要。转写文本和处理文件属于内部过程文件，不会出现在成果页。</p></section></div></ListPage>}
    </main>
  </div>
}

function Review({ name, files, directory, busy, onBack, onRun }: {
  name: string
  files: readonly File[]
  directory: string
  busy: boolean
  onBack: () => void
  onRun: () => void
}) {
  return <div className={css.review}><section><h3>任务信息</h3><dl><div><dt>会议名称</dt><dd>{name.trim() || '未填写，将由材料推断'}</dd></div><div><dt>录音文件</dt><dd>{files.find(file => audioPattern.test(file.name))?.name ?? '未添加'}</dd></div><div><dt>补充材料</dt><dd>{files.filter(file => !audioPattern.test(file.name)).map(file => file.name).join('、') || '未添加'}</dd></div><div><dt>输出目录</dt><dd title={directory}>{directory}</dd></div></dl><p>开始后任务会在后台处理。录音将按顺序分段转写；任一片段失败会停止，不会跳过。</p><footer><button type="button" onClick={onBack}>返回修改</button><button type="button" className={css.primary} disabled={busy} onClick={onRun}>{busy ? '正在提交…' : '开始生成纪要'}</button></footer></section><aside><Icon name="file" /><h3>本次交付</h3><strong>一个 Word 会议纪要</strong><p>包含会议基本信息、核心结论、议题与讨论、决策事项、待办事项和风险与未决问题。</p></aside></div>
}

function MeetingHome({ tasks, onStart, onGuide, onHistory }: {
  tasks: readonly MeetingTask[]
  onStart: () => void
  onGuide: () => void
  onHistory: () => void
}) {
  return <div className={css.home}>
    <section className={css.homeHero} style={{ backgroundImage: `url(${meetingIconImages.hero})` }}><div><span>会议纪要专家</span><h2>专注会议内容，生成专业纪要</h2><p>把录音、已有转写稿和相关材料整理成结构清晰的 Word 会议纪要。</p><div><button type="button" className={css.primary} onClick={onStart}><Icon name="new" />新建纪要</button><button type="button" onClick={onGuide}><Icon name="guide" />查看使用说明</button></div></div></section>
    <aside className={css.capabilities}><h3>能力说明</h3><p><Icon name="check" /><span><strong>支持多种会议材料</strong><small>一个录音和多个可读取的文字材料</small></span></p><p><Icon name="check" /><span><strong>按材料整理内容</strong><small>提炼结论、决策、待办和未决问题</small></span></p><p><Icon name="check" /><span><strong>生成正式会议纪要</strong><small>每个任务交付一个 Word 文件</small></span></p></aside>
    <section className={css.homeSteps}><h3>4 步完成会议纪要</h3><div>{[['1','准备材料','添加录音或文字材料'],['2','核对信息','确认文件与输出目录'],['3','系统处理','转写并整理会议内容'],['4','打开结果','查看 Word 会议纪要']].map(([number,title,copy]) => <span key={number}><b>{number}</b><strong>{title}</strong><small>{copy}</small></span>)}</div></section>
    <section className={css.recent}><header><div><h3>最近的纪要记录</h3><p>这里展示本专家在当前设备上的任务。</p></div>{tasks.length > 0 && <button type="button" onClick={onHistory}>查看全部</button>}</header>{tasks.length === 0 ? <div><Icon name="history" /><strong>暂无纪要记录</strong><small>点击“新建纪要”开始第一次整理。</small></div> : <button type="button" className={css.recentTask} onClick={onHistory}><span><strong>{tasks[0]?.name}</strong><small>{new Date(tasks[0]?.createdAt ?? 0).toLocaleString('zh-CN')}</small></span><b>查看记录</b></button>}</section>
  </div>
}

function TaskResult({ task, result, service, onHistory, onRetry }: {
  task: MeetingTask
  result: MeetingResult | undefined
  service?: MeetingTaskService
  onHistory: () => void
  onRetry: () => void
}) {
  const state = result?.status ?? 'running'
  return <><header className={css.pageHead}><span>会议纪要任务</span><h2>{task.name}</h2><p>创建于 {new Date(task.createdAt).toLocaleString('zh-CN')}</p></header><section className={css.statusPanel} data-status={state}><Icon name={state === 'completed' ? 'check' : state === 'failed' ? 'error' : 'clock'} /><div><h3>{state === 'completed' ? '会议纪要已生成' : state === 'failed' ? '本次纪要未完成' : '正在处理会议材料'}</h3><p>{state === 'completed' ? '任务正常结束，并已在本次目录中找到 Word 文件。' : state === 'failed' ? result?.error : '任务已提交，可以切换到记录页，处理会继续进行。'}</p></div></section><div className={css.resultGrid}><div>{result?.answer ? <section className={css.answerPanel}><h3>执行摘要</h3><RichText text={result.answer} /></section> : <section className={css.waiting}><span className={css.wave} aria-hidden="true" /><h3>{state === 'running' ? '正在生成纪要' : '没有可展示的执行摘要'}</h3><p>{state === 'running' ? '录音转写和纪要整理所需时间取决于材料长度。' : '请根据任务状态检查材料。'}</p></section>}{result?.wordPath && <section className={css.deliverable}><Icon name="file" /><div><strong>{result.wordPath.split(/[\\/]/).at(-1)}</strong><small>本次任务唯一正式成果</small></div><button type="button" onClick={() => void service?.openFile(result.wordPath ?? '')}>打开会议纪要</button></section>}</div><aside className={css.taskInfo}><h3>本次来源</h3>{task.inputs.map(file => <p key={file.name}><Icon name={file.kind === 'audio' ? 'audio' : 'material'} /><span title={file.name}>{file.name}</span></p>)}<small title={task.directory}>保存位置：{task.directory}</small><button type="button" onClick={onHistory}>查看我的纪要记录</button>{state === 'failed' && <button type="button" onClick={onRetry}>修改材料后重新创建</button>}</aside></div></>
}

function ListPage({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className={css.listPage}>
    <header className={css.pageHead}><span>会议纪要专家</span><h2>{title}</h2><p>{subtitle}</p></header>
    {children}
  </div>
}
function Empty({ icon, title, text, action }: { icon: 'history' | 'file'; title: string; text: string; action: () => void }) { return <div className={css.empty}><Icon name={icon} /><h3>{title}</h3><p>{text}</p><button type="button" className={css.primary} onClick={action}>新建纪要</button></div> }
function Toolbar({ query, setQuery, filter, setFilter }: { query: string; setQuery: (value: string) => void; filter: 'all' | MeetingResult['status']; setFilter: (value: 'all' | MeetingResult['status']) => void }) { return <div className={css.toolbar}><input aria-label="搜索会议" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索会议名称" /><div>{([['all', '全部'], ['running', '处理中'], ['completed', '已完成'], ['failed', '未完成']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div></div> }
