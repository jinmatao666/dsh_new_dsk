import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import css from './OfficeExpertWorkbench.module.css'
import type {
  OfficeResult,
  OfficeTask,
  OfficeTaskService,
} from './office-task.ts'
import { ExpertProfileIcon } from './ExpertProfileIcon.tsx'

export type ToolDef = {
  id: string
  name: string
  description: string
  accept: string
  multiple: boolean
  skill: string
  expected: readonly string[]
  params?: readonly {
    key: string
    label: string
    type: 'text' | 'select'
    options?: readonly string[]
    default: string
  }[]
}
export type OfficeVisuals = {
  expert: string
  home: string
  history: string
  files: string
  guide: string
  info: string
  emptyHistory: string
  emptyFiles: string
  toolIcons: Record<string, string>
  heroTitle: string
  heroText: string
  heroPoints: readonly string[]
}
type Section = 'home' | 'history' | 'files' | 'guide'
const statusText = (status: OfficeResult['status']) =>
  status === 'completed'
    ? '已完成'
    : status === 'partial'
      ? '部分完成'
      : status === 'failed'
        ? '失败'
        : '处理中'
const formatSize = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1048576
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1048576).toFixed(1)} MB`
function MarkdownResult({ text }: { text: string }) {
  const lines = text.split(/\r?\n/)
  return (
    <div className={css.markdown}>
      {lines.map((line, index) => {
        if (/^###\s+/.test(line))
          return <h4 key={index}>{line.replace(/^###\s+/, '')}</h4>
        if (/^##\s+/.test(line))
          return <h3 key={index}>{line.replace(/^##\s+/, '')}</h3>
        if (/^#\s+/.test(line))
          return <h2 key={index}>{line.replace(/^#\s+/, '')}</h2>
        if (/^[-*]\s+/.test(line))
          return (
            <div className={css.bullet} key={index}>
              • {line.replace(/^[-*]\s+/, '').replace(/\*\*/g, '')}
            </div>
          )
        if (/^\d+[.)]\s+/.test(line))
          return (
            <div className={css.bullet} key={index}>
              {line.replace(/\*\*/g, '')}
            </div>
          )
        return line.trim() ? (
          <p key={index}>{line.replace(/\*\*/g, '')}</p>
        ) : (
          <Fragment key={index} />
        )
      })}
    </div>
  )
}
type CompareChange = {
  type: 'added' | 'deleted' | 'modified'
  old: readonly string[]
  new: readonly string[]
}
type CompareData = {
  counts: {
    added: number
    deleted: number
    modified: number
    unchanged: number
  }
  changes: readonly CompareChange[]
}
function CompareResult({ result }: { result: OfficeResult }) {
  const source = Object.entries(result.textArtifacts).find(([path]) =>
    path.toLowerCase().endsWith('.json'),
  )?.[1]
  let data: CompareData | null = null
  try {
    const value = source ? (JSON.parse(source) as Partial<CompareData>) : null
    if (value?.counts && Array.isArray(value.changes))
      data = value as CompareData
  } catch {}
  if (!data)
    return result.answer ? <MarkdownResult text={result.answer} /> : null
  return (
    <section className={css.compare}>
      <div className={css.stats}>
        <span>
          <b>{data.counts.added}</b>新增
        </span>
        <span>
          <b>{data.counts.deleted}</b>删除
        </span>
        <span>
          <b>{data.counts.modified}</b>修改
        </span>
        <span>
          <b>{data.counts.unchanged}</b>未变化
        </span>
      </div>
      <h3>关键差异</h3>
      {data.changes.length ? (
        <div className={css.changes}>
          {data.changes.slice(0, 100).map((change, index) => (
            <article key={index} className={css[change.type]}>
              <strong>
                {change.type === 'added'
                  ? '新增'
                  : change.type === 'deleted'
                    ? '删除'
                    : '修改'}{' '}
                {index + 1}
              </strong>
              {change.old.length > 0 && (
                <p>
                  <small>原内容</small>
                  {change.old.join(' / ')}
                </p>
              )}
              {change.new.length > 0 && (
                <p>
                  <small>新内容</small>
                  {change.new.join(' / ')}
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p>两份文档提取后的文本内容一致。</p>
      )}
    </section>
  )
}
function SummaryResult({ result }: { result: OfficeResult }) {
  const source =
    Object.entries(result.textArtifacts).find(([path]) =>
      path.toLowerCase().endsWith('.md'),
    )?.[1] ?? result.answer
  if (!source) return null
  const chunks = source.split(/^##\s+/m).filter(Boolean)
  return (
    <div className={css.summary}>
      {chunks.map((chunk, index) => {
        const [heading, ...body] = chunk.split(/\r?\n/)
        return (
          <section key={index}>
            <h3>{heading?.replace(/^#\s+/, '') || '处理摘要'}</h3>
            <MarkdownResult text={body.join('\n')} />
          </section>
        )
      })}
    </div>
  )
}
function pageSelectionCount(value: string) {
  const seen = new Set<number>()
  for (const part of value.replace(/\s/g, '').split(',')) {
    if (!part) continue
    const [aText, bText] = part.split('-')
    const a = Number(aText),
      b = bText === undefined ? a : Number(bText)
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a)
      return null
    for (let n = a; n <= b; n++) {
      if (seen.has(n)) return null
      seen.add(n)
    }
  }
  return seen.size
}

export function OfficeExpertWorkbench({
  title,
  subtitle,
  icon,
  service,
  tools,
  guide,
  visuals,
}: {
  title: string
  subtitle: string
  icon?: string | undefined
  service?: OfficeTaskService | undefined
  tools: readonly ToolDef[]
  guide: readonly { title: string; text: string }[]
  visuals: OfficeVisuals
}) {
  const [section, setSection] = useState<Section>('home'),
    [tool, setTool] = useState<ToolDef | null>(null),
    [step, setStep] = useState<'form' | 'review'>('form')
  const [name, setName] = useState(''),
    [files, setFiles] = useState<File[]>([]),
    [params, setParams] = useState<Record<string, string>>({})
  const [results, setResults] = useState<readonly OfficeResult[]>([]),
    [active, setActive] = useState<OfficeTask | null>(null),
    [result, setResult] = useState<OfficeResult | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const load = async () => {
    if (!service) return
    try {
      const listed = await service.list()
      setResults(
        await Promise.all(
          listed.map(task =>
            service
              .read(task)
              .catch(() => ({
                task,
                status: 'failed' as const,
                answer: '',
                files: [],
                textArtifacts: {},
                error: '任务记录暂时无法读取。',
              })),
          ),
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  useEffect(() => {
    void load()
  }, [service])
  const begin = (next: ToolDef) => {
    setTool(next)
    setName(`${next.name}-${new Date().toLocaleDateString('zh-CN')}`)
    setFiles([])
    setParams(
      Object.fromEntries(next.params?.map(p => [p.key, p.default]) ?? []),
    )
    setStep('form')
    setActive(null)
    setResult(null)
    setError(null)
    setSection('home')
  }
  const validate = () => {
    if (!tool) return '请选择工具。'
    if (!name.trim()) return '请填写任务名称。'
    if (files.length === 0) return '请选择输入文件。'
    if (!tool.multiple && files.length !== 1)
      return '该工具每次只能选择一个文件。'
    if (tool.id === 'compare' && files.length !== 2)
      return '文档对比必须选择原始版本和新版本各一份。'
    if (
      tool.id === 'pdf-organize' &&
      params.mode === '合并' &&
      files.length < 2
    )
      return 'PDF 合并至少需要两个文件。'
    if (
      tool.id === 'pdf-organize' &&
      params.mode !== '合并' &&
      files.length !== 1
    )
      return 'PDF 拆分每次只能选择一个文件。'
    const pageValue =
      tool.id === 'pdf-images' ||
      (tool.id === 'pdf-organize' && params.mode === '按范围拆分')
        ? params.pages
        : ''
    if (pageValue && pageSelectionCount(pageValue) === null)
      return '页码必须从 1 开始，不能重复、倒序或使用 0。'
    const numberRules: [string, number, number, string][] = [
      ['dpi', 72, 600, 'DPI'],
      ['quality', 1, 100, '质量'],
      ['maxWidth', 0, 100000, '最大宽度'],
      ['maxHeight', 0, 100000, '最大高度'],
      ['margin', 0, 1000, '页边距'],
    ]
    for (const [key, min, max, label] of numberRules) {
      const value = params[key]
      if (
        value !== undefined &&
        value !== '' &&
        (!Number.isFinite(Number(value)) ||
          Number(value) < min ||
          Number(value) > max)
      )
        return `${label}必须是 ${min} 到 ${max} 之间的数字。`
    }
    const accepted = tool.accept.split(',').map(x => x.trim().toLowerCase())
    const bad = files.find(
      f => !accepted.some(ext => f.name.toLowerCase().endsWith(ext)),
    )
    return bad ? `不支持文件 ${bad.name}。` : null
  }
  const expectedCount = () => {
    if (!tool) return undefined
    if (tool.id === 'word-pdf' || tool.id === 'image-optimize')
      return files.length
    if (tool.id === 'pdf-images' && params.pages)
      return pageSelectionCount(params.pages) ?? undefined
    return undefined
  }
  const run = async () => {
    if (!tool || !service) {
      setError('请在桌面端使用该专家。')
      return
    }
    try {
      setBusy(true)
      setError(null)
      const count = expectedCount()
      const task = await service.start({
        name,
        kind: tool.id,
        skill: tool.skill,
        files,
        expected: tool.expected,
        ...(count === undefined ? {} : { expectedOutputCount: count }),
        parameters: params,
        instruction: `任务类型：${tool.name}。参数：${JSON.stringify(
          params,
        )}。严格按照技能支持的参数执行，输入文件顺序与页面一致。`,
      })
      setActive(task)
      void service.wait(task, (value) => {
        setResult(value)
        if (value.status !== 'running') void load()
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const open = async (task: OfficeTask) => {
    if (!service) return
    setSection('home')
    setActive(task)
    setTool(tools.find(item => item.id === task.kind) ?? null)
    setResult(await service.read(task))
  }
  const activeTool = active
    ? tools.find(item => item.id === active.kind)
    : tool
  const allFiles = useMemo(
    () =>
      results.flatMap(item =>
        item.files.map(path => ({ path, result: item })),
      ),
    [results],
  )
  return (
    <div className={css.shell}>
      <aside className={css.side}>
        <div className={css.brand}>
          <span><ExpertProfileIcon icon={icon} fallbackImage={visuals.expert} /></span>
          <div>
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </div>
        </div>
        <button
          className={css.new}
          onClick={() => {
            setTool(null)
            setActive(null)
            setResult(null)
            setSection('home')
          }}
        >
          ＋ 新建处理
        </button>
        <nav>
          <button
            className={section === 'home' ? css.active : ''}
            onClick={() => setSection('home')}
          >
            <img src={visuals.home} alt="" />
            工具工作台
          </button>
          <button
            className={section === 'history' ? css.active : ''}
            onClick={() => {
              setSection('history')
              void load()
            }}
          >
            <img src={visuals.history} alt="" />
            我的处理记录
          </button>
          <button
            className={section === 'files' ? css.active : ''}
            onClick={() => {
              setSection('files')
              void load()
            }}
          >
            <img src={visuals.files} alt="" />
            我的成果文件
          </button>
          <button
            className={section === 'guide' ? css.active : ''}
            onClick={() => setSection('guide')}
          >
            <img src={visuals.guide} alt="" />
            使用说明
          </button>
        </nav>
        <p className={css.note}>结果以任务目录中的真实产物为准</p>
      </aside>
      <main className={css.main}>
        {error && (
          <p className={css.error} role="alert">
            {error}
          </p>
        )}
        {section === 'home' && !tool && !active && (
          <div className={css.dashboard}>
            <section className={css.hero}>
              <div>
                <span>{title}</span>
                <h2>{visuals.heroTitle}</h2>
                <p>{visuals.heroText}</p>
                <button
                  className={css.heroButton}
                  onClick={() => { const first = tools[0]; if (first) begin(first) }}
                >
                  ＋ 开始新任务
                </button>
              </div>
              <div className={css.heroArt}>
                {tools.slice(0, 3).map((item, index) => (
                  <img
                    key={item.id}
                    className={css[`art${index}`]}
                    src={visuals.toolIcons[item.id]}
                    alt=""
                  />
                ))}
              </div>
              <div className={css.heroPoints}>
                {visuals.heroPoints.map(point => (
                  <span key={point}>✓ {point}</span>
                ))}
              </div>
            </section>
            <section className={css.toolSection}>
              <div className={css.sectionTitle}>
                <div>
                  <h3>选择处理工具</h3>
                  <p>按任务类型进入，上传文件后再核对参数。</p>
                </div>
              </div>
              <div className={css.tools}>
                {tools.map(item => (
                  <button
                    key={item.id}
                    className={css.tool}
                    onClick={() => begin(item)}
                  >
                    <img src={visuals.toolIcons[item.id]} alt="" />
                    <span>
                      <b>{item.name}</b>
                      <small>{item.description}</small>
                      <em>开始处理 →</em>
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <section className={css.recent}>
              <div className={css.sectionTitle}>
                <div>
                  <h3>最近处理</h3>
                  <p>仅显示当前用户在本机创建的真实任务。</p>
                </div>
                {results.length > 0 && (
                  <button onClick={() => setSection('history')}>
                    查看全部
                  </button>
                )}
              </div>
              {results.length ? (
                <div className={css.recentList}>
                  {results.slice(0, 3).map(item => (
                    <button
                      key={item.task.id}
                      onClick={() => void open(item.task)}
                    >
                      <img
                        src={
                          visuals.toolIcons[item.task.kind] ??
                          visuals.emptyFiles
                        }
                        alt=""
                      />
                      <span>
                        <b>{item.task.name}</b>
                        <small>
                          {new Date(item.task.createdAt).toLocaleString()}
                        </small>
                      </span>
                      <em className={css[item.status]}>
                        {statusText(item.status)}
                      </em>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={visuals.emptyHistory}
                  title="暂无处理记录"
                  text="选择上方工具，创建第一次处理任务。"
                  action="新建处理"
                  onAction={() => { const first = tools[0]; if (first) begin(first) }}
                />
              )}
            </section>
          </div>
        )}
        {section === 'home' && tool && !active && (
          <>
            <div className={css.steps}>
              <span className={css.current}>1 准备材料</span>
              <span className={step === 'review' ? css.current : ''}>
                2 核对信息
              </span>
              <span>3 处理与交付</span>
            </div>
            <header className={css.head}>
              <span>{title}</span>
              <h2>{step === 'form' ? tool.name : '核对处理信息'}</h2>
              <p>{tool.description}</p>
            </header>
            {step === 'form' ? (
              <div className={css.formGrid}>
                <section className={css.form}>
                  <label>
                    任务名称
                    <input
                      value={name}
                      onChange={e => setName(e.target.value)}
                    />
                  </label>
                  <input
                    ref={input}
                    hidden
                    type="file"
                    accept={tool.accept}
                    multiple={tool.multiple}
                    onChange={e => setFiles(Array.from(e.target.files ?? []))}
                  />
                  <button
                    className={css.upload}
                    onClick={() => input.current?.click()}
                  >
                    选择{tool.multiple ? '一个或多个' : '一个'}文件
                    <br />
                    <small>{tool.accept}</small>
                  </button>
                  <div className={css.files}>
                    {files.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}`}>
                        <span>
                          <b>{file.name}</b>
                          <small>{formatSize(file.size)} · 格式已校验</small>
                        </span>
                        <button
                          aria-label={`删除 ${file.name}`}
                          onClick={() =>
                            setFiles(files.filter((_, i) => i !== index))
                          }
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                  {tool.id === 'compare' && files.length === 2 && (
                    <button onClick={() => {
                      const [original, updated] = files
                      if (original && updated) setFiles([updated, original])
                    }}>
                      交换原始版本与新版本
                    </button>
                  )}
                </section>
                <aside className={css.parameters}>
                  <h3>处理参数</h3>
                  {tool.params
                    ?.filter(
                      p =>
                        !(
                          tool.id === 'image-optimize' &&
                          p.key === 'quality' &&
                          !['jpg', 'webp'].includes(params.format ?? '')
                        ),
                    )
                    .map(p => (
                      <label key={p.key}>
                        {p.label}
                        {p.type === 'select' ? (
                          <select
                            value={params[p.key]}
                            onChange={e =>
                              setParams({ ...params, [p.key]: e.target.value })
                            }
                          >
                            {p.options?.map(x => (
                              <option key={x}>{x}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={params[p.key]}
                            onChange={e =>
                              setParams({ ...params, [p.key]: e.target.value })
                            }
                          />
                        )}
                      </label>
                    ))}
                  <p>
                    只使用技能实际支持的参数。越界页码由正式脚本读取真实 PDF
                    后返回失败。
                  </p>
                </aside>
              </div>
            ) : (
              <div className={css.review}>
                <h3>{name}</h3>
                <dl>
                  <dt>处理类型</dt>
                  <dd>{tool.name}</dd>
                  <dt>输入文件</dt>
                  <dd>{files.map(f => f.name).join('；')}</dd>
                  <dt>用户参数</dt>
                  <dd>
                    {Object.entries(params)
                      .map(([k, v]) => `${k}=${v}`)
                      .join('；') || '使用技能默认值'}
                  </dd>
                  <dt>预计成果</dt>
                  <dd>{tool.expected.join('、')}</dd>
                </dl>
              </div>
            )}
            <div className={css.actions}>
              <button
                onClick={() =>
                  step === 'review' ? setStep('form') : setTool(null)
                }
              >
                返回
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (step === 'form') {
                    const issue = validate()
                    if (issue) setError(issue)
                    else {
                      setError(null)
                      setStep('review')
                    }
                  } else void run()
                }}
              >
                {step === 'form'
                  ? '核对处理信息'
                  : busy
                    ? '正在创建任务…'
                    : '开始处理'}
              </button>
            </div>
          </>
        )}
        {section === 'home' && active && (
          <>
            <div className={css.steps}>
              <span>1 准备材料</span>
              <span>2 核对信息</span>
              <span className={css.current}>3 处理与交付</span>
            </div>
            <header className={css.head}>
              <span>{activeTool?.name}</span>
              <h2>{active.name}</h2>
              <p>
                {new Date(active.createdAt).toLocaleString()} ·{' '}
                {active.inputs.length} 个输入文件
              </p>
            </header>
            <div
              className={`${css.result} ${
                result?.status ? css[result.status] : ''
              }`}
            >
              <div className={css.resultHead}>
                <div>
                  <small>真实任务状态</small>
                  <h3>{result ? statusText(result.status) : '读取中'}</h3>
                </div>
                <button
                  onClick={() => void service?.openFile(active.directory)}
                >
                  打开任务目录
                </button>
              </div>
              {result?.error && <p className={css.error}>{result.error}</p>}
              {result &&
                (active.kind === 'compare' ? (
                  <CompareResult result={result} />
                ) : active.kind === 'summary' ? (
                  <SummaryResult result={result} />
                ) : (
                  result.answer && <MarkdownResult text={result.answer} />
                ))}
              <h3>真实成果文件</h3>
              <div className={css.outputs}>
                {result?.files.length ? (
                  result.files.map(path => (
                    <div key={path}>
                      <span title={path}>{path.split(/[\\/]/).at(-1)}</span>
                      <button
                        className={css.open}
                        onClick={() => void service?.openFile(path)}
                      >
                        打开文件
                      </button>
                    </div>
                  ))
                ) : (
                  <p>尚未找到符合本任务要求的成果文件。</p>
                )}
              </div>
              {active.kind === 'compare' && (
                <p className={css.limit}>
                  文本内容对比不等同于视觉版式或 Word 修订比较。
                </p>
              )}
            </div>
          </>
        )}
        {section === 'history' && (
          <>
            <header className={css.head}>
              <span>{title}</span>
              <h2>我的处理记录</h2>
              <p>只显示当前用户在本机创建的任务。</p>
            </header>
            <div className={css.list}>
              {results.length ? (
                results.map(item => (
                  <button
                    key={item.task.id}
                    onClick={() => void open(item.task)}
                  >
                    <img
                      src={
                        visuals.toolIcons[item.task.kind] ??
                        visuals.emptyHistory
                      }
                      alt=""
                    />
                    <span>
                      <b>{item.task.name}</b>
                      <small>
                        {new Date(item.task.createdAt).toLocaleString()} ·{' '}
                        {item.task.inputs.length} 个文件 ·{' '}
                        {tools.find(x => x.id === item.task.kind)?.name ??
                          item.task.kind}
                      </small>
                    </span>
                    <em className={css[item.status]}>
                      {statusText(item.status)}
                    </em>
                  </button>
                ))
              ) : (
                <EmptyState
                  icon={visuals.emptyHistory}
                  title="暂无处理记录"
                  text="新建任务后，处理状态和结果会显示在这里。"
                  action="新建处理"
                  onAction={() => {
                    setSection('home')
                    const first = tools[0]
                    if (first) begin(first)
                  }}
                />
              )}
            </div>
          </>
        )}
        {section === 'files' && (
          <>
            <header className={css.head}>
              <span>{title}</span>
              <h2>我的成果文件</h2>
              <p>汇总当前全部任务目录中仍可访问的真实成果。</p>
            </header>
            {allFiles.length ? (
              <div className={css.outputs}>
                {allFiles.map(({ path, result: item }) => (
                  <div key={`${item.task.id}-${path}`}>
                    <span>
                      <b>{path.split(/[\\/]/).at(-1)}</b>
                      <small>
                        {item.task.name} · {statusText(item.status)}
                      </small>
                    </span>
                    <button
                      className={css.open}
                      onClick={() => void service?.openFile(path)}
                    >
                      打开文件
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={visuals.emptyFiles}
                title="暂无成果文件"
                text="任务完成后，可打开的真实成果会汇总在这里。"
                action="新建处理"
                onAction={() => {
                  setSection('home')
                  const first = tools[0]
                  if (first) begin(first)
                }}
              />
            )}
          </>
        )}
        {section === 'guide' && (
          <>
            <header className={css.head}>
              <h2>使用说明</h2>
            </header>
            <div className={css.guide}>
              {guide.map(item => (
                <section key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  text,
  action,
  onAction,
}: {
  icon: string
  title: string
  text: string
  action: string
  onAction: () => void
}) {
  return (
    <div className={css.empty}>
      <img src={icon} alt="" />
      <h3>{title}</h3>
      <p>{text}</p>
      <button onClick={onAction}>{action}</button>
    </div>
  )
}
