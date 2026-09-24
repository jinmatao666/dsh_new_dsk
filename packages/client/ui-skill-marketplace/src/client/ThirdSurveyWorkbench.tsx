import { useEffect, useRef, useState } from 'react'
import css from './GeologyWorkbench.module.css'
import { ExpertProfileIcon } from './ExpertProfileIcon.tsx'
import type { ThirdSurveyResult, ThirdSurveyTask, ThirdSurveyTaskService } from './third-survey-task.ts'
import { TerrainIllustration } from './TerrainIllustration.tsx'
import { geologyIconImages } from './GeologyIconData.ts'
import { GeologyAnalysisView } from './GeologyAnalysisView.tsx'
import { SpatialAnalysisAnswer, SpatialAnalysisProgress } from './SpatialAnalysisResult.tsx'
import { thirdSurveyHero } from './LandExpertHeroImages.ts'

type ThirdSurveyIconName = 'mountain' | 'new' | 'workspace' | 'history' | 'files' | 'guide' | 'upload' | 'back' | 'layers' | 'geojson' | 'zip' | 'word' | 'excel' | 'result' | 'success' | 'failed' | 'running' | 'info' | 'help' | 'empty'
export function ThirdSurveyIcon({ name, className = '' }: { name: ThirdSurveyIconName; className?: string }) {
  return <img className={`${css.spriteIcon} ${className}`} src={geologyIconImages[name]} alt="" aria-hidden="true" />
}

type Section = 'workbench' | 'history' | 'files' | 'guide'
type Step = 'home' | 'prepare' | 'review'

const sections: readonly { id: Section; label: string; icon: string }[] = [
  { id: 'workbench', label: '分析工作台', icon: '◫' },
  { id: 'history', label: '我的分析记录', icon: '◷' },
  { id: 'files', label: '我的成果文件', icon: '▤' },
  { id: 'guide', label: '使用说明', icon: 'ⓘ' },
]

function checkFiles(files: readonly File[]): string | null {
  if (files.length === 0) return '请选择地块范围文件。'
  if (files.length === 1 && /\.(geojson|json|zip)$/i.test(files[0]?.name ?? '')) return null
  if (files.some(file => /\.(geojson|json|zip)$/i.test(file.name))) return '一次只能提交一个 GeoJSON、JSON 或 Shape ZIP 数据集。'
  const shapes = files.filter(file => /\.shp$/i.test(file.name))
  if (shapes.length > 1) return '检测到多个 Shape 数据集，请每次只提交一个同名文件组。'
  const shape = shapes[0]
  if (shape === undefined) return '请选择 GeoJSON、Shape ZIP，或完整的 Shape 文件。'
  const stem = shape.name.replace(/\.shp$/i, '').toLowerCase()
  for (const extension of ['shx', 'dbf']) {
    if (!files.some(file => file.name.toLowerCase() === `${stem}.${extension}`)) {
      return `Shape 数据还缺少与 ${shape.name} 同名的 .${extension} 文件。`
    }
  }
  return null
}

function outputFiles(result: ThirdSurveyResult | undefined): readonly string[] {
  return result?.files.filter(path => /\.(?:docx|xlsx)$/i.test(path) && !/^~\$/u.test(path.split(/[\\/]/u).at(-1) ?? '')) ?? []
}

function ResultStatus({ result }: { result: ThirdSurveyResult | undefined }) {
  return <span className={`${css.status} ${result?.status === 'completed' ? css.statusComplete : result?.status === 'failed' ? css.statusFailed : css.statusRunning}`}>
    {result === undefined ? '状态待读取' : result.status === 'completed' ? '已完成' : result.status === 'failed' ? '未完成' : '分析中'}
  </span>
}

/** Third survey workspace; its service executes the fixed shipped skill through an archived session. */
export function ThirdSurveyWorkbench({ service, expertIcon, expertName, expertSubtitle }: {
  service?: ThirdSurveyTaskService
  expertIcon?: string | undefined
  expertName?: string | undefined
  expertSubtitle?: string | undefined
}) {
  const [section, setSection] = useState<Section>('workbench')
  const [step, setStep] = useState<Step>('home')
  const [projectName, setProjectName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [year, setYear] = useState('2024')
  const [coordinateSystem, setCoordinateSystem] = useState('')
  const [tasks, setTasks] = useState<readonly ThirdSurveyTask[]>([])
  const [results, setResults] = useState<Record<string, ThirdSurveyResult>>({})
  const [activeTask, setActiveTask] = useState<ThirdSurveyTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [historyFilter, setHistoryFilter] = useState<'all' | ThirdSurveyResult['status']>('all')
  const [fileFilter, setFileFilter] = useState<'all' | 'docx' | 'xlsx'>('all')
  const [loadingSummaries, setLoadingSummaries] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.querySelector('.dsh-skill-market-panel')?.scrollTo({ top: 0 })
  }, [section, step])

  useEffect(() => {
    if (service === undefined) return
    let cancelled = false
    void service.list().then((items) => { if (!cancelled) setTasks(items) }).catch((failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : '无法读取分析记录') })
    return () => { cancelled = true }
  }, [service])

  useEffect(() => {
    if (service === undefined || tasks.length === 0 || (section !== 'history' && section !== 'files')) return
    let cancelled = false
    setLoadingSummaries(true)
    setSummaryError(null)
    void Promise.allSettled(tasks.map(task => service.read(task))).then((outcomes) => {
      if (cancelled) return
      setResults((current) => {
        const next = { ...current }
        outcomes.forEach((outcome, index) => { if (outcome.status === 'fulfilled' && tasks[index] !== undefined) next[tasks[index].id] = outcome.value })
        return next
      })
      if (outcomes.some(outcome => outcome.status === 'rejected')) setSummaryError('部分任务无法读取；请检查本机任务目录与会话是否仍可访问。')
      setLoadingSummaries(false)
    })
    return () => { cancelled = true }
  }, [service, section, tasks])

  const openTask = async (task: ThirdSurveyTask) => {
    if (service === undefined) return
    setActiveTask(task)
    setSection('workbench')
    setError(null)
    try {
      const result = await service.read(task)
      setResults(current => ({ ...current, [task.id]: result }))
      if (result.status === 'running') {
        void service.wait(task, (update) => { setResults(current => ({ ...current, [task.id]: update })) })
          .catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : '无法读取分析进度') })
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '无法读取分析结果') }
  }

  const run = async () => {
    if (service === undefined) { setError('当前环境没有连接专家执行服务。'); return }
    setBusy(true)
    setError(null)
    try {
      const task = await service.start({ name: projectName.trim(), files, year: Number(year) || 2024, coordinateSystem })
      setTasks(current => [task, ...current])
      setActiveTask(task)
      void service.wait(task, (update) => { setResults(current => ({ ...current, [task.id]: update })) })
        .catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : '无法读取分析进度') })
    } catch (failure) { setError(failure instanceof Error ? failure.message : '分析未能启动') }
    finally { setBusy(false) }
  }

  const startNew = () => {
    setSection('workbench')
    setStep('prepare')
    setProjectName('')
    setFiles([])
    setYear('2024')
    setCoordinateSystem('')
    setActiveTask(null)
    setError(null)
    if (fileInput.current !== null) fileInput.current.value = ''
  }
  const selectFiles = (selected: FileList | null) => {
    if (selected === null) return
    const next = Array.from(selected)
    setFiles(next)
    setError(checkFiles(next))
    if (projectName.trim() === '' && next[0] !== undefined) {
      setProjectName(next[0].name.replace(/\.(geojson|json|zip|shp)$/i, ''))
    }
  }
  const review = () => {
    const fileError = checkFiles(files)
    if (fileError !== null) { setError(fileError); return }
    if (projectName.trim() === '') { setError('请填写项目名称。'); return }
    setError(null)
    setStep('review')
  }

  const filteredTasks = tasks.filter(task => task.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (historyFilter === 'all' || results[task.id]?.status === historyFilter))
  const listedFiles = tasks.flatMap(task => outputFiles(results[task.id]).map(path => ({ task, path }))).filter(item => item.task.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) || item.path.split(/[\\/]/).at(-1)?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).filter(item => fileFilter === 'all' || item.path.toLocaleLowerCase().endsWith(`.${fileFilter}`))

  return <div className={css.shell}>
    <aside className={css.sidebar} aria-label="三调土地利用现状分析专家功能">
      <div className={css.identity}>
        <span className={css.identityMark}><ExpertProfileIcon icon={expertIcon ?? 'survey'} /></span>
        <div><strong>{expertName || '三调土地利用现状分析专家'}</strong><small>{expertSubtitle || '项目范围研判工作台'}</small></div>
      </div>
      <button type="button" className={css.newButton} onClick={startNew}>＋ 新建分析</button>
      <nav className={css.sideNav} aria-label="专家页面">
        {sections.map(item => <button key={item.id} type="button" className={section === item.id ? css.sideActive : ''} onClick={() => { setSection(item.id) }}><ThirdSurveyIcon name={item.id === 'workbench' ? 'workspace' : item.id} />{item.label}</button>)}
      </nav>
      <div className={css.sideFoot}><span className={css.statusDot} /> 三调土地利用现状分析<br /><small>记录和成果仅在此专家中查看</small></div>
    </aside>

    <main className={css.main}>{summaryError !== null && (section === 'history' || section === 'files') && <p className={css.error} role="alert">{summaryError}</p>}
      {section === 'workbench' && activeTask !== null && <>
        <div className={css.heading}><div><span className={css.kicker}>三调土地利用现状分析专家 · 分析任务</span><h2>{activeTask.name}</h2><p>创建于 {new Date(activeTask.createdAt).toLocaleString('zh-CN')}，结果和文件均来自本次任务。</p></div><button type="button" className={css.secondaryButton} onClick={() => void openTask(activeTask)}>刷新结果</button></div>
        <div className={css.steps} aria-label="分析步骤"><span><b>✓</b> 准备材料</span><i /><span><b>✓</b> 核对信息</span><i /><span className={css.stepCurrent}><b>3</b> 分析与交付</span></div>
        <div className={css.resultLayout}>
          <div className={css.resultBody}>
            <section className={`${css.resultBanner} ${results[activeTask.id]?.status === 'failed' ? css.resultBannerFailed : results[activeTask.id]?.status === 'completed' ? css.resultBannerComplete : css.resultBannerRunning}`}>
              <ThirdSurveyIcon name={results[activeTask.id]?.status === 'failed' ? 'failed' : results[activeTask.id]?.status === 'completed' ? 'success' : 'running'} />
              <div><h3>{results[activeTask.id]?.status === 'failed' ? '分析未完成' : results[activeTask.id]?.status === 'completed' ? '分析已完成' : '正在分析地块条件'}</h3><p>{results[activeTask.id]?.status === 'failed' ? '请根据下方实际回答核对材料，然后新建一次分析。' : results[activeTask.id]?.status === 'completed' ? '本次会话已结束，Word 报告和 Excel 明细均已在任务目录中找到。' : '任务已提交。完成后会在这里展示模型回答和实际生成的成果文件。'}</p>{results[activeTask.id]?.status !== 'completed' && results[activeTask.id]?.status !== 'failed' && <SpatialAnalysisProgress createdAt={activeTask.createdAt} />}</div>
            </section>
            {error !== null && <p className={css.error} role="alert">{error}</p>}
            {results[activeTask.id]?.status === 'failed' && <section className={css.failurePanel}><h3>未完成的原因</h3><p>{results[activeTask.id]?.error ?? '本次分析未正常完成。'}</p><button type="button" className={css.secondaryButton} onClick={startNew}>修改材料并新建分析</button></section>}
            {results[activeTask.id]?.answer ? <SpatialAnalysisAnswer text={results[activeTask.id]?.answer ?? ''} /> : <section className={css.pendingPanel}><h3>{results[activeTask.id]?.status === 'running' || results[activeTask.id] === undefined ? '等待分析结果' : '本次没有可展示的模型回答'}</h3><p>{results[activeTask.id]?.status === 'running' || results[activeTask.id] === undefined ? '正在持续检查任务状态；可切换到分析记录，任务会继续运行。' : '请核对本次任务状态和成果文件。'}</p></section>}
            {results[activeTask.id]?.analysisViewPath && service && <GeologyAnalysisView path={results[activeTask.id]?.analysisViewPath ?? ''} service={service} />}
            {results[activeTask.id] !== undefined && <section className={css.outputs}><h3>本次成果文件 <small>{outputFiles(results[activeTask.id]).length} 个</small></h3>{outputFiles(results[activeTask.id]).length === 0 ? <p>任务目录中尚未找到 Word 报告或 Excel 明细。</p> : <div className={css.outputGrid}>{outputFiles(results[activeTask.id]).map(path => <button type="button" key={path} onClick={() => void service?.openFile(path)}><span className={css.fileGlyph} aria-hidden="true">{/\.docx$/i.test(path) ? 'W' : 'X'}</span><span><strong>{path.split(/[\\/]/).at(-1)}</strong><small>{/\.docx$/i.test(path) ? 'Word 报告' : 'Excel 明细'} · 打开文件</small></span></button>)}</div>}</section>}
          </div>
          <aside className={css.resultAside}><section className={css.asidePanel}><h3>任务信息</h3><dl><div><dt>项目名称</dt><dd>{activeTask.name}</dd></div><div><dt>创建时间</dt><dd>{new Date(activeTask.createdAt).toLocaleString('zh-CN')}</dd></div><div><dt>当前状态</dt><dd><ResultStatus result={results[activeTask.id]} /></dd></div></dl></section><section className={css.asidePanel}><h3>查看与继续</h3><p>分析记录只保存在当前用户的本机索引中；成果文件保存在本次任务目录。</p><button type="button" className={css.secondaryButton} onClick={() =>{  setSection('history') }}>查看我的分析记录</button></section></aside>
        </div>
      </>}
      {section === 'workbench' && activeTask === null && <>
        {step === 'home' ? <HomeView onAction={startNew} onGuide={() => setSection('guide')} onHistory={() => setSection('history')} tasks={tasks} /> : <>
          <div className={css.heading}><div><span className={css.kicker}>三调土地利用现状分析专家</span><h2>{step === 'prepare' ? '从项目范围开始' : '确认本次分析'}</h2><p>上传项目地块范围并填写项目信息，系统将调用正式三调技能分析地类、面积与权属现状。</p></div></div>
          <div className={css.steps} aria-label="分析步骤"><span className={css.stepCurrent}><b>1</b> 填写资料</span><i /><span className={step === 'review' ? css.stepCurrent : ''}><b>2</b> 确认信息</span><i /><span><b>3</b> 分析交付</span></div>
          {step === 'prepare' ? <div className={css.columns}>
            <div className={css.primaryColumn}>
              <section className={css.formSection}><div className={css.sectionHeading}><span>01</span><div><h3>项目资料</h3><p>先给这次分析一个易于查找的名称。</p></div></div><label className={css.field}>项目名称<input value={projectName} onChange={(event) => { setProjectName(event.target.value); setError(null) }} placeholder="例如：东侧地块三调土地利用现状分析" /></label></section>
              <section className={css.formSection}><div className={css.sectionHeading}><span>02</span><div><h3>地块范围</h3><p>上传项目范围数据；提交分析后，技能会核查几何类型和坐标系。</p></div></div><input ref={fileInput} className={css.hiddenInput} type="file" accept=".geojson,.json,.zip,.shp,.shx,.dbf,.prj,.cpg" multiple onChange={(event) =>{  selectFiles(event.target.files) }} /><button type="button" className={css.uploadZone} onClick={() => fileInput.current?.click()} onDragOver={(event) =>{  event.preventDefault() }} onDrop={(event) => { event.preventDefault(); selectFiles(event.dataTransfer.files) }}><ThirdSurveyIcon name="upload" /><strong>{files.length > 0 ? '更换地块文件' : '点击或拖拽文件到此处上传'}</strong><small>支持 GeoJSON、完整 Shape ZIP，或同名的 .shp / .shx / .dbf 文件</small></button>{files.length > 0 && <div className={css.fileList}>{files.map(file => <span key={`${file.name}-${file.size}`}>{file.name}<small>{(file.size / 1024).toFixed(1)} KB</small></span>)}</div>}</section>
              <section className={css.advanced}><button type="button" aria-expanded={advanced} onClick={() =>{  setAdvanced(value => !value) }}>高级选项 <span>{advanced ? '−' : '＋'}</span></button>{advanced && <><label className={css.field}>三调年度<input type="number" min="2009" max="2100" value={year} onChange={(event) =>{  setYear(event.target.value) }} /><small>默认 2024；仅在需要分析其他三调年度时修改。</small></label><label className={css.field}>坐标系说明（可选）<input value={coordinateSystem} onChange={(event) =>{  setCoordinateSystem(event.target.value) }} placeholder="例如 CGCS2000；文件有 .prj 时可留空" /><small>仅在文件中无法识别坐标系时填写，不能猜测。</small></label></>}</section>
              {error !== null && <p className={css.error} role="alert">{error}</p>}
              <div className={css.formActions}><button type="button" className={css.primaryButton} onClick={review}>核对分析信息 <span aria-hidden="true">→</span></button><small>核对后再决定是否开始分析</small></div>
            </div>
            <aside className={css.infoColumn}>
              <section className={css.guidePanel}>
                <span className={css.guideIcon}><ThirdSurveyIcon name="geojson" /></span>
                <h3>准备地块数据</h3>
                <p>范围应为面或多面。GeoJSON、完整 Shape ZIP，或同名的 .shp / .shx / .dbf 文件均可提交。</p>
                <TerrainIllustration className={css.terrainArt} />
              </section>
              <section className={css.guidePanel}>
                <span className={css.guideIcon}><ThirdSurveyIcon name="result" /></span>
                <h3>本专家将交付</h3>
                <ul><li>三调地类、面积与权属现状分析</li><li>Word 专业分析报告</li><li>Excel 明细表</li></ul>
              </section>
              <p className={css.infoNote}>分析用于资料研判，不替代行政审批或规划合规认定。</p>
            </aside>
          </div> : <div className={css.reviewLayout}><section className={css.reviewCard}><h3>请核对这些信息</h3><dl><div><dt>项目名称</dt><dd>{projectName}</dd></div><div><dt>范围文件</dt><dd>{files.map(file => file.name).join('、')}</dd></div><div><dt>三调年度</dt><dd>{year || '2024'}</dd></div><div><dt>坐标系</dt><dd>{coordinateSystem || '从文件识别；无法确定时分析会说明'}</dd></div></dl><div className={css.reviewActions}><button type="button" className={css.secondaryButton} onClick={() =>{  setStep('prepare') }}>返回修改</button><button type="button" className={css.primaryButton} disabled={busy} onClick={() => void run()}>{busy ? '正在启动…' : '开始分析'}</button></div>{error !== null && <p className={css.error} role="alert">{error}</p>}</section><aside className={css.reviewAside}><strong>运行后将展示</strong><p>本次模型生成的综合结论、关键发现、项目影响与建议，以及实际生成的 Word 和 Excel 成果文件。</p><span>不会展示示例结论或不存在的文件。</span></aside></div>}</>}
      </>}
      {section === 'history' && <div className={css.taskPage}><div className={css.heading}><div><span className={css.kicker}>三调土地利用现状分析专家</span><h2>我的分析记录</h2><p>仅显示当前用户在这台设备上创建的三调现状分析任务。</p></div></div><div className={css.statStrip}><span><ThirdSurveyIcon name="history" /><b>{tasks.length}</b><small>全部记录</small></span><span><ThirdSurveyIcon name="running" /><b>{tasks.filter(task => results[task.id]?.status === 'running').length}</b><small>分析中</small></span><span><ThirdSurveyIcon name="success" /><b>{tasks.filter(task => results[task.id]?.status === 'completed').length}</b><small>已完成</small></span><span><ThirdSurveyIcon name="failed" /><b>{tasks.filter(task => results[task.id]?.status === 'failed').length}</b><small>未完成</small></span></div>{tasks.length === 0 ? <div className={css.emptyWithAside}><EmptyView title="我的分析记录" description="仅展示本专家创建的分析任务。" detail="发起新分析后，相关记录将在这里显示。" steps={['上传地块范围', '核对输入信息', '查看分析结果']} onAction={startNew} /><aside className={css.emptySideCard}><ThirdSurveyIcon name="info" /><h3>记录范围说明</h3><strong>仅显示本专家创建的分析记录</strong><p>这里展示的是您使用「三调土地利用现状分析专家」创建的任务。其他专家的分析记录不会在此显示。</p></aside></div> : <><div className={css.listToolbar}><label className={css.searchField}>搜索项目<input value={query} onChange={(event) =>{  setQuery(event.target.value) }} placeholder="输入项目名称" /></label><div className={css.filterGroup} aria-label="筛选分析状态">{([['all', '全部'], ['running', '分析中'], ['completed', '已完成'], ['failed', '未完成']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={historyFilter === value} onClick={() =>{  setHistoryFilter(value) }}>{label}</button>)}</div></div>{loadingSummaries && <p className={css.listHint}>正在读取任务状态…</p>}<div className={css.taskList}>{filteredTasks.map(task => <button type="button" key={task.id} onClick={() => void openTask(task)}><span className={css.taskName}><strong>{task.name}</strong><small>创建于 {new Date(task.createdAt).toLocaleString('zh-CN')}</small></span><ResultStatus result={results[task.id]} /><span className={css.taskAction}>查看结果 ›</span></button>)}</div>{filteredTasks.length === 0 && !loadingSummaries && <p className={css.listHint}>没有符合当前搜索或筛选条件的分析记录。</p>}</>}</div>}
      {section === 'files' && <div className={css.taskPage}><div className={css.heading}><div><span className={css.kicker}>三调土地利用现状分析专家</span><h2>我的成果文件</h2><p>这里只列出本专家任务目录中实际找到的 Word 报告和 Excel 明细。</p></div></div><div className={css.statStrip}><span><ThirdSurveyIcon name="files" /><b>{listedFiles.length}</b><small>成果文件</small></span><span><ThirdSurveyIcon name="word" /><b>{listedFiles.filter(item => /\.docx$/i.test(item.path)).length}</b><small>Word 报告</small></span><span><ThirdSurveyIcon name="excel" /><b>{listedFiles.filter(item => /\.xlsx$/i.test(item.path)).length}</b><small>Excel 明细</small></span></div>{tasks.length === 0 ? <EmptyView title="我的成果文件" description="这里只展示本专家实际生成的成果文件。" detail="完成分析后，Word 报告与 Excel 明细会保存在这里。" steps={['完成地块分析', '生成 Word 报告', '打开 Excel 明细']} onAction={startNew} /> : <><div className={css.listToolbar}><label className={css.searchField}>搜索成果<input value={query} onChange={(event) =>{  setQuery(event.target.value) }} placeholder="输入文件名或项目名称" /></label><div className={css.filterGroup} aria-label="筛选文件类型">{([['all', '全部'], ['docx', 'Word 报告'], ['xlsx', 'Excel 明细']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={fileFilter === value} onClick={() =>{  setFileFilter(value) }}>{label}</button>)}</div></div>{loadingSummaries && <p className={css.listHint}>正在读取任务目录中的成果…</p>}{listedFiles.length === 0 && !loadingSummaries && summaryError === null ? <div className={css.noFiles}><span aria-hidden="true">▤</span><h3>暂无成果文件</h3><p>{query || fileFilter !== 'all' ? '没有符合当前搜索或筛选条件的文件。' : '当前任务目录中尚未找到 Word 报告或 Excel 明细。'}</p><button type="button" className={css.primaryButton} onClick={startNew}>新建分析</button></div> : <div className={css.fileTable}>{listedFiles.map(({ task, path }) => <div className={css.fileRow} key={`${task.id}:${path}`}><span className={css.fileGlyph} aria-hidden="true">{/\.docx$/i.test(path) ? 'W' : 'X'}</span><span className={css.fileIdentity}><strong>{path.split(/[\\/]/).at(-1)}</strong><small>{task.name} · {/\.docx$/i.test(path) ? 'Word 报告' : 'Excel 明细'}</small></span><button type="button" className={css.secondaryButton} onClick={() => void service?.openFile(path)}>打开文件</button></div>)}</div>}</>}</div>}
      {section === 'guide' && <div className={css.guidePage}><span className={css.kicker}>三调土地利用现状分析专家 · 使用说明</span><h2>准备一份完整的地块范围</h2><p>上传项目面范围，核对输入信息，再由分析技能生成结论与本次任务的 Word、Excel 成果。</p><div className={css.guideSteps}><span><b>1</b> 准备材料</span><span><b>2</b> 核对信息</span><span><b>3</b> 查看分析与交付</span></div><div className={css.guideCards}><section><h3>支持的材料</h3><p>面或多面的 GeoJSON、包含完整 Shape 文件的 ZIP，或同名的 .shp、.shx、.dbf 组件。若有 .prj，也请一并提供。</p></section><section><h3>坐标系与年度</h3><p>坐标系无法从文件识别时，请提供明确的坐标系说明。三调年度默认使用 2024，需要其他年度时在高级选项中修改。</p></section><section><h3>无法确认数据时</h3><p>如果存在多个候选数据集，或无法确定几何类型与坐标系，分析会说明需要补充的材料；请核对后新建任务。</p></section><section><h3>如何理解结果</h3><p>综合结论和建议来自本次模型回答；成果文件从本次任务目录读取。本分析用于前期资料研判，不替代行政审批或规划合规认定。</p></section></div></div>}
    </main>
  </div>
}

function HomeView({ onAction, onGuide, onHistory, tasks }: {
  onAction: () => void
  onGuide: () => void
  onHistory: () => void
  tasks: readonly ThirdSurveyTask[]
}) {
  return <div className={css.homeLayout}>
    <div className={css.homeMain}>
      <section className={css.homeHero}>
        <img className={css.homeHeroImage} src={thirdSurveyHero} alt="" aria-hidden="true" />
        <span className={css.kicker}>三调土地利用现状分析专家</span>
        <h2>三调土地利用现状分析专家</h2>
        <p className={css.homeSubhead}>三调地类、面积与权属现状分析</p>
        <div className={css.homeFeature}>
          <ThirdSurveyIcon name="layers" />
          <div>
            <strong>基于项目范围，形成专业分析</strong>
            <p>上传真实地块数据，识别地类构成条件与耕地保护，查看分析结论和本次任务实际生成的成果文件。</p>
            <div className={css.featureTags}>
              <span>地类构成</span><span>耕地保护</span><span>Word 报告</span><span>Excel 明细</span>
            </div>
          </div>
        </div>
        <div className={css.homeActions}><button type="button" className={css.primaryButton} onClick={onAction}>＋ 新建分析</button><button type="button" className={css.secondaryButton} onClick={onGuide}>查看使用说明</button></div>
      </section>
      <section className={css.homeNext}>
        <h3>接下来可以做什么？</h3>
        <div>
          <span><b>1</b><strong>准备数据</strong><small>整理项目地块的范围文件</small></span>
          <span><b>2</b><strong>新建分析</strong><small>上传文件并核对信息</small></span>
          <span><b>3</b><strong>查看任务</strong><small>读取运行状态与真实成果</small></span>
        </div>
      </section>
    </div>
    <aside className={css.homeAside}><section className={css.homeInfo}>
      <h3>能力说明</h3>
      <p>✓ 支持 GeoJSON 和完整 Shape 范围数据</p>
      <p>✓ 分析三调地类、面积与耕地保护情况</p>
      <p>✓ 查看本次任务实际生成的 Word 报告和 Excel 明细</p>
    </section></aside>
    <section className={css.homeRecent}><header><div><h3>最近的分析记录</h3><p>这里展示本专家在当前设备上的任务。</p></div>{tasks.length > 0 && <button type="button" onClick={onHistory}>查看全部</button>}</header>{tasks[0] ? <button type="button" onClick={onHistory}><strong>{tasks[0].name}</strong><small>{new Date(tasks[0].createdAt).toLocaleString('zh-CN')}</small></button> : <div className={css.homeRecentEmpty}><ThirdSurveyIcon name="history" /><strong>暂无分析记录</strong><small>点击“新建分析”开始第一次分析。</small></div>}</section>
  </div>
}

function EmptyView({ title, description, detail, steps, onAction }: {
  title: string
  description: string
  detail: string
  steps: readonly string[]
  onAction: () => void
}) {
  return <div className={css.emptyPage}>
    <span className={css.emptyMark}><ThirdSurveyIcon name={title === '我的成果文件' ? 'files' : 'history'} /></span>
    <h3>{title === '我的成果文件' ? '暂无成果文件' : '暂无分析记录'}</h3>
    <p>{detail}</p>
    <button type="button" className={css.primaryButton} onClick={onAction}>新建分析</button>
    <p className={css.emptyContext}>{description}</p>
    <ol className={css.emptySequence}>{steps.map((item, index) => <li key={item}><b>{index + 1}</b>{item}</li>)}</ol>
  </div>
}
