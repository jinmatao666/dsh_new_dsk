/** Generate the checked-in office demo skill packages from one reviewed definition list. */

import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const airRoot = resolve(here, '..');
const skillsRoot = join(airRoot, 'public', 'skills');
const runtimeSource = join(here, 'office-skill-runtime', 'office_tools.py');
const generatedAt = '2026-09-14 19:00:00';

const skills = [
  {
    slug: 'office-word-to-pdf', name: 'Word 转 PDF', icon: 'W', accent: '#2563eb',
    summary: '将一个或多个 Word 文档转换为便于打印、发送和归档的 PDF，并保持原文件不变。',
    capabilities: ['Word 批量转 PDF', '优先使用 Microsoft Word 高保真转换', '不覆盖原文件并生成处理报告'],
    params: [fileList('inputPaths', '一个或多个 .doc、.docx、.docm 文件'), outputDirectory()],
    command: 'word-to-pdf', requirements: [], special: 'word',
    body: `## 适用场景

- 用户要把一个或多个 Word 文件转换成 PDF，用于打印、发送或归档。
- 不负责改写正文、合并多个 PDF 或对 PDF 再压缩；这些请求应交给对应技能。

## 执行与交互

1. 确认输入是 \`.doc\`、\`.docx\` 或 \`.docm\`。多个候选文件且用户没有说清时，先列出文件让用户确认。
2. 运行 \`scripts/invoke.ps1 -InputPaths <文件列表> -OutputDirectory <目录>\`。脚本优先调用 Microsoft Word；不可用时回退到 LibreOffice。
3. 每个输入独立转换。输出与原文件同名；重名时自动追加序号，绝不覆盖原文件。
4. 转换失败时保留其他已成功文件，并明确列出失败文件和原因，不把“已复制但未转换”的文件冒充 PDF。

## 交付

- 逐项列出生成的 PDF 链接、页数（可读取时）和输出目录。
- 用“成功 N 个、失败 N 个”的短摘要收尾；失败项附可操作的依赖提示。
- 转换后的 PDF 是主要交付物，处理日志不是主要交付物。`,
  },
  {
    slug: 'office-pdf-organizer', name: 'PDF 合并拆分', icon: '合', accent: '#7c3aed',
    summary: '将多个 PDF 按指定顺序合并，或按页码范围拆分和提取页面。',
    capabilities: ['PDF 顺序合并', '按页码范围拆分', '按单页批量拆分'],
    params: [enumParam('operation', '处理方式', ['merge', 'split']), fileList('inputPaths', '合并时按顺序提供 PDF；拆分时提供一个 PDF'), stringParam('ranges', '拆分页码，例如 1-3,5,8-10', false), outputDirectory()],
    command: 'pdf-organizer', requirements: ['pypdf>=5.0,<7'],
    body: `## 适用场景

- 合并多个 PDF，或从一个 PDF 中提取指定页码、按范围拆分、逐页拆分。
- 页码按用户看到的页码从 1 开始。不要把程序内部从 0 开始的页号暴露给用户。

## 执行与交互

1. 合并前按用户给出的顺序复述文件列表；顺序不明确时必须询问。
2. 合并：\`scripts/invoke.ps1 merge --inputs <PDF...> --output-directory <目录>\`。
3. 范围拆分：\`scripts/invoke.ps1 split --input <PDF> --ranges "1-3,5" --output-directory <目录>\`。逐页拆分追加 \`--separate-pages\`。
4. 输入页码越界、倒序或重复时停止并说明问题，不擅自修正。

## 交付

- 合并结果：PDF、输入顺序、总页数和处理报告。
- 拆分结果：每个 PDF 对应的页码范围、页数和处理报告。
- 输出名称可读且不覆盖已有文件；仅把最终 PDF 作为主要交付文件。`,
  },
  {
    slug: 'office-pdf-to-images', name: 'PDF 转图片', icon: '图', accent: '#0891b2',
    summary: '将 PDF 每一页批量转换为 PNG 或 JPG，支持清晰度和页码范围控制。',
    capabilities: ['PDF 逐页转图', 'PNG 与 JPG 输出', '页码范围和清晰度控制'],
    params: [fileParam('inputPath', 'PDF 文件'), enumParam('format', '图片格式', ['png', 'jpg']), numberParam('dpi', '清晰度 DPI', 144), stringParam('pages', '可选页码范围，例如 1-3,5', false), outputDirectory()],
    command: 'pdf-to-images', requirements: ['PyMuPDF>=1.24,<2'],
    body: `## 适用场景

- 把 PDF 页面转成预览图、插图或便于发送的 PNG/JPG。

## 执行与交互

1. 默认输出 PNG、144 DPI、全部页面。用户强调印刷或高清时建议 200–300 DPI，并提示文件会更大。
2. 运行 \`scripts/invoke.ps1 --input <PDF> --format png --dpi 144 --output-directory <目录>\`；指定页面时追加 \`--pages "1-3,5"\`。
3. 页码从 1 开始。超出范围时明确报错，不产生不完整的“成功”结论。

## 交付

- 图片统一放入独立输出目录，按 \`页-001\`、\`页-002\` 命名。
- 汇报格式、DPI、生成张数、页面范围和失败项；图片较多时只展示前几项并提供目录链接。`,
  },
  {
    slug: 'office-images-to-pdf', name: '图片转 PDF', icon: '册', accent: '#ea580c',
    summary: '将多张图片按指定顺序排版为一个 PDF，支持常见纸张、方向和页边距。',
    capabilities: ['多图按序合成 PDF', 'A4/A3/Letter 与原尺寸', '自动旋转和留白排版'],
    params: [fileList('inputPaths', '按页面顺序提供图片'), enumParam('pageSize', '纸张', ['A4', 'A3', 'Letter', 'original']), enumParam('orientation', '方向', ['auto', 'portrait', 'landscape']), numberParam('marginMm', '页边距（毫米）', 10), outputDirectory()],
    command: 'images-to-pdf', requirements: ['Pillow>=10,<13'],
    body: `## 适用场景

- 将扫描件、截图或照片按顺序合成便于提交、打印和归档的 PDF。

## 执行与交互

1. 合成顺序必须明确；文件名不能可靠代表顺序时先让用户确认。
2. 默认 A4、自动方向、10mm 页边距。证件或扫描件需要保留原尺寸时使用 \`original\`。
3. 运行 \`scripts/invoke.ps1 --inputs <图片...> --page-size A4 --orientation auto --margin-mm 10 --output-directory <目录>\`。
4. 自动应用图片方向信息，保持宽高比，不裁切内容；透明图片铺白底。

## 交付

- 交付一个合成 PDF，并汇报图片顺序、页数、纸张和方向。
- 无法读取的图片单独报错，不静默跳过；输出不覆盖已有文件。`,
  },
  {
    slug: 'office-excel-data-cleaner', name: 'Excel 数据处理', icon: '表', accent: '#16a34a',
    summary: '清理 Excel 台账，完成去重、筛选、文本规范化、格式统一和基础统计。',
    capabilities: ['Excel 去重与筛选', '文本和表格格式统一', '基础统计与处理报告'],
    params: [fileParam('inputPath', 'Excel 工作簿'), stringParam('sheet', '工作表名称；留空使用首个工作表', false), stringParam('dedupeColumns', '去重列名，多个用英文逗号分隔', false), stringParam('filter', '筛选条件，例如 状态=有效', false), outputDirectory()],
    command: 'excel-process', requirements: ['openpyxl>=3.1,<4'],
    body: `## 适用场景

- 清理和整理 Excel 台账：去重、筛选、清除文本首尾空格、统一表头样式、冻结表头、自动筛选和基础统计。
- 复杂公式建模、透视图和业务口径分析应先和用户确认规则，不在未知口径下猜测。

## 执行与交互

1. 先读取工作簿的工作表和表头。去重列、筛选列或业务口径不明确时再询问用户。
2. 运行 \`scripts/invoke.ps1 --input <xlsx> --sheet <工作表> --dedupe-columns "列1,列2" --filter "状态=有效" --output-directory <目录>\`；未要求去重或筛选时省略对应参数。
3. 原始工作簿只读。输出固定为 \`.xlsx\`，避免把未保留宏的内容错误标为 \`.xlsm\`。
4. 处理后的工作表增加规范样式，并追加“处理报告”工作表记录输入、输出、原始行数、保留行数和删除原因。

## 交付

- 交付清理后的 Excel 和 Markdown/JSON 处理报告。
- 摘要说明处理规则、删除多少行、保留多少行以及是否发现空表头或重复表头。`,
  },
  {
    slug: 'office-document-compare', name: '文档对比助手', icon: '比', accent: '#db2777',
    summary: '对比两份 Word、PDF 或文本文件，整理新增、删除和修改内容。',
    capabilities: ['Word/PDF/文本差异提取', '新增删除内容统计', '可读 HTML 与 Markdown 对比报告'],
    params: [fileParam('originalPath', '原始版本'), fileParam('revisedPath', '新版本'), outputDirectory()],
    command: 'document-compare', requirements: ['python-docx>=1.1,<2', 'pypdf>=5.0,<7', 'openpyxl>=3.1,<4'],
    body: `## 适用场景

- 比较两份 Word、PDF、TXT、Markdown、CSV、JSON 或 Excel 文件的文本内容。

## 执行与交互

1. 明确哪个是“原始版本”、哪个是“新版本”，不能仅按文件时间自行猜测。
2. 运行 \`scripts/invoke.ps1 --original <旧文件> --revised <新文件> --output-directory <目录>\`。
3. 脚本生成逐行差异、并排 HTML 和结构化统计。对扫描型 PDF，若提取不到文本，明确提示需要 OCR，不输出“无差异”。
4. 模型读取差异后，按“核心变化、增加内容、删除内容、风险与建议”形成业务摘要，不逐行复述全部差异。

## 交付

- Markdown 摘要、可视化 HTML 对比、JSON 统计和文本差异文件。
- 明确文本对比不等同于版式、图片、批注和修订痕迹的像素级比较。`,
  },
  {
    slug: 'office-document-summary', name: '文档摘要与要点提取', icon: '摘', accent: '#4f46e5',
    summary: '读取 Word、PDF、Excel 和文本材料，提炼重点、风险、时间节点和待办事项。',
    capabilities: ['多格式文本提取', '结构化摘要与风险识别', '待办和时间节点整理'],
    params: [fileList('inputPaths', '一个或多个 Word、PDF、Excel 或文本文件'), stringParam('focus', '可选关注重点', false), outputDirectory()],
    command: 'document-summary', requirements: ['python-docx>=1.1,<2', 'pypdf>=5.0,<7', 'openpyxl>=3.1,<4'],
    body: `## 适用场景

- 快速阅读一份或多份 Word、PDF、Excel、TXT、Markdown、CSV 或 JSON 材料，提炼管理摘要。

## 执行与交互

1. 运行 \`scripts/invoke.ps1 extract --inputs <文件...> --output-directory <目录>\`，得到带来源边界的文本底稿。
2. 若用户给出关注重点，围绕该重点组织；否则使用默认结构：“一句话结论、关键要点、风险与问题、时间节点、待办事项、来源说明”。
3. 每个事实尽量标注来源文件；材料没有明确责任人、期限或结论时写“未明确”，不得补造。
4. 将最终 Markdown 保存后，运行 \`scripts/invoke.ps1 render --input <摘要.md> --title "文档摘要与要点" --output-directory <目录>\` 生成 Word。

## 交付

- 优先交付 Word 摘要和 Markdown 底稿；在对话中展示精炼摘要。
- 扫描 PDF 无可提取文本时明确提示需要 OCR。长材料应分来源归纳，避免把不同文件中的观点混为一个事实。`,
  },
  {
    slug: 'office-batch-rename', name: '文件批量重命名', icon: '名', accent: '#0f766e',
    summary: '按项目名、日期、序号等规则批量重命名文件，执行前先生成预览清单。',
    capabilities: ['批量命名规则生成', '执行前 CSV 预览', '冲突检查与两阶段安全改名'],
    params: [fileList('inputPaths', '需要重命名的文件'), stringParam('template', '命名模板，支持 {project} {date} {index} {name} {ext}', true), stringParam('project', '项目名', false), numberParam('startIndex', '起始序号', 1), outputDirectory()],
    command: 'batch-rename', requirements: [],
    body: `## 适用场景

- 按统一规则给一批文件增加项目名、日期、序号或保留原文件名。

## 安全交互（必须遵守）

1. 先运行预览，不得第一次调用就执行改名：\`scripts/invoke.ps1 --inputs <文件...> --template "{project}_{date}_{index}_{name}{ext}" --project <名称> --preview --output-directory <目录>\`。
2. 向用户展示“原名称 → 新名称”预览和冲突检查结果。只有用户明确确认后，才使用完全相同参数把 \`--preview\` 改为 \`--apply\`。
3. 支持占位符：\`{project}\`、\`{date}\`、\`{index}\`、\`{name}\`、\`{ext}\`。默认日期格式 \`yyyyMMdd\`，序号默认 3 位。
4. 脚本拒绝重名、非法字符和目标已存在；实际执行采用临时名过渡，尽量避免交叉改名导致覆盖。

## 交付

- 预览阶段交付 CSV 清单，不宣称文件已改名。
- 执行后交付最终映射 CSV，并汇报成功和失败数量。原文件内容不变，仅修改名称。`,
  },
  {
    slug: 'office-image-optimizer', name: '图片压缩与格式转换', icon: '压', accent: '#ca8a04',
    summary: '批量压缩图片、按最大尺寸缩放，并转换为 JPG、PNG 或 WebP。',
    capabilities: ['批量图片压缩', '等比例尺寸调整', 'JPG/PNG/WebP 格式转换'],
    params: [fileList('inputPaths', '一个或多个图片'), enumParam('format', '输出格式', ['jpg', 'png', 'webp']), numberParam('quality', '质量 1–100', 85), numberParam('maxWidth', '最大宽度；0 表示不限制', 0), numberParam('maxHeight', '最大高度；0 表示不限制', 0), outputDirectory()],
    command: 'image-process', requirements: ['Pillow>=10,<13'],
    body: `## 适用场景

- 批量压缩图片、等比例缩小尺寸，或在 JPG、PNG、WebP 之间转换。

## 执行与交互

1. 默认输出 WebP、质量 85、不主动放大。用户要求兼容办公软件时优先 JPG 或 PNG。
2. 运行 \`scripts/invoke.ps1 --inputs <图片...> --format webp --quality 85 --max-width 1920 --max-height 1080 --output-directory <目录>\`。
3. 保留宽高比并应用 EXIF 方向。转 JPG 时透明区域铺白底；不覆盖原图。
4. PNG 的 quality 不是有损质量控制，脚本会使用优化压缩；不要承诺 PNG 一定显著变小。

## 交付

- 列出输出目录、成功/失败数量、处理前后总大小和节省比例。
- 图片较多时提供报告和目录链接，不在对话中铺满所有图片。`,
  },
  {
    slug: 'office-meeting-minutes', name: '会议纪要', icon: '会', accent: '#9333ea',
    summary: '将会议语音转为文字，并结合会议材料生成结构化 Markdown 和 Word 会议纪要。',
    capabilities: ['Qwen3-ASR 语音转写', 'Qwen3.8 结构化会议纪要', 'Markdown 与 Word 交付'],
    params: [fileList('materials', '会议材料或已有转写稿'), fileParam('audioPath', '可选语音文件；需先配置转写接口', false), stringParam('meetingTitle', '会议名称', false), outputDirectory()],
    command: 'meeting-minutes', requirements: ['python-docx>=1.1,<2', 'pypdf>=5.0,<7', 'openpyxl>=3.1,<4'],
    body: `## 当前能力

- 可基于语音、已有转写稿、Word、PDF、Excel、Markdown、TXT、CSV、JSON 材料生成会议纪要。
- 默认服务为 \`http://ac.zjugis.com:20330/v1\`：\`Qwen3-ASR-1.7B\` 通过 \`/audio/transcriptions\` 转写，\`qwen3.8-27b-fp8\` 通过 \`/chat/completions\` 生成纪要。

## 执行与交互

1. 文字材料：\`scripts/invoke.ps1 prepare --materials <文件...> --transcript <可选转写稿> --meeting-title <名称> --output-directory <目录>\`。
2. 音频材料：\`scripts/invoke.ps1 prepare --audio <音频> --materials <可选文件...> --meeting-title <名称> --output-directory <目录>\`。脚本依次完成转写、内容整理和 Word 渲染。
3. 默认服务不要求密钥；如网关后来启用鉴权，通过 \`WANWEI_MEETING_API_KEY\` 提供，不能写入技能包、命令记录或报告。服务地址和两个模型均可通过同名前缀的环境变量覆盖。
4. 责任人、期限、参会人未在材料中出现时必须写“未明确”。接口失败时保留已产生的材料或转写文件并报告原始原因，不得伪造纪要。

## 输出样式

- 开头用信息表展示会议名称、时间、地点、参会人、记录人。
- 决策事项使用编号列表；待办事项必须使用“事项｜责任人｜截止时间｜状态”表格；风险单独成节。
- 对话中只给执行摘要和主要文件链接，Word 为主要交付，Markdown 与材料汇总用于追溯。
- 清楚区分“材料明确内容”和“未明确项”，不得补造会议结论。`,
  },
];

for (const skill of skills) {
  const directory = join(skillsRoot, skill.slug);
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(directory, 'scripts'), { recursive: true });
  const files = ['manifest.json', 'SKILL.md', 'scripts/invoke.ps1'];
  if (skill.special !== 'word') {
    await copyFile(runtimeSource, join(directory, 'scripts', 'office_tools.py'));
    files.push('scripts/office_tools.py');
  }
  if (skill.requirements.length > 0) {
    await writeText(join(directory, 'requirements.txt'), `${skill.requirements.join('\n')}\n`);
    files.push('requirements.txt');
  }
  await writeText(join(directory, 'manifest.json'), `${JSON.stringify(manifest(skill, files), null, 2)}\n`);
  await writeText(join(directory, 'SKILL.md'), skillMarkdown(skill));
  const wrapper = skill.special === 'word' ? wordWrapper() : pythonWrapper(skill.command);
  const normalizedWrapper = wrapper
    .replaceAll('\n+', '\n')
    .replace("  [string] $OutputDirectory = '',\n  [switch] $Overwrite\n)", "  [string] $OutputDirectory = ''\n)")
    .replace('if ($Overwrite -or -not (Test-Path -LiteralPath $candidate))', 'if (-not (Test-Path -LiteralPath $candidate))')
    .replace("$ErrorActionPreference = 'Stop'\n", "$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n")
    .replace(
      'if ($word) { $word.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }',
      "if ($word) {\n  try { $word.Quit() } catch { # Word may close its RPC server immediately after export.\n  }\n  try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) } catch { # The COM object may already be released.\n  }\n}",
    );
  await writeText(join(directory, 'scripts', 'invoke.ps1'), `\uFEFF${normalizedWrapper}`);
}

console.log(`Generated ${skills.length} office demo skill packages.`);

function manifest(skill, files) {
  return {
    schemaVersion: 1,
    id: skill.slug,
    name: skill.slug,
    slug: skill.slug,
    displayName: skill.name,
    summary: skill.summary,
    description: `${skill.summary} 包含可直接运行的本地处理脚本、依赖说明、错误处理和统一中文交付规范。`,
    category: '办公工具',
    tags: ['官方', '办公', '演示'],
    capabilities: skill.capabilities,
    version: '1.0.0',
    author: '万维Buddy 办公工具',
    submitter: 'root',
    createdAt: generatedAt,
    featured: true,
    status: 'published',
    accent: skill.accent,
    icon: skill.icon,
    params: skill.params,
    files,
  };
}

function skillMarkdown(skill) {
  const dependencies = skill.requirements.length > 0
    ? `\n## 运行依赖\n\n首次执行前运行 \`python -m pip install -r <技能目录>/requirements.txt\`。若依赖缺失，只提供这条安装命令，不得自行安装。\n`
    : '';
  return `---\nname: ${skill.slug}\ndescription: ${skill.name}：${skill.summary} 当用户明确提出这类办公文件处理请求时使用。\n---\n\n# ${skill.name}\n\n${skill.body}${dependencies}\n## 通用约束\n\n- 输入可以来自工作区外；先使用用户提供的绝对路径。技能安装目录视为只读，所有输出写入用户指定目录或输入文件旁的独立输出目录。\n- 不修改、不删除、不覆盖输入文件。除批量重命名的确认执行外，所有产物都使用安全的新文件名。\n- 只有命令成功且目标文件真实存在时才能声明完成。错误信息应包含失败文件、原因和下一步，不展示堆栈给普通用户。\n- 最终回复先给结果摘要，再给主要产物链接，最后列出必要的限制或失败项。\n`;
}

function pythonWrapper(command) {
  const dispatch = {
    'pdf-organizer': `$operation = $ToolArguments[0]\nif ($operation -notin @('merge', 'split')) { throw '第一个参数必须是 merge 或 split。' }\n$runtimeCommand = if ($operation -eq 'merge') { 'pdf-merge' } else { 'pdf-split' }\n$ToolArguments = @($ToolArguments | Select-Object -Skip 1)`,
    'document-summary': `$operation = $ToolArguments[0]\nif ($operation -notin @('extract', 'render')) { throw '第一个参数必须是 extract 或 render。' }\n$runtimeCommand = if ($operation -eq 'extract') { 'document-extract' } else { 'render-markdown-docx' }\n$ToolArguments = @($ToolArguments | Select-Object -Skip 1)`,
    'meeting-minutes': `$operation = $ToolArguments[0]\nif ($operation -notin @('prepare', 'render')) { throw '第一个参数必须是 prepare 或 render。' }\n$runtimeCommand = if ($operation -eq 'prepare') { 'meeting-prepare' } else { 'render-markdown-docx' }\n$ToolArguments = @($ToolArguments | Select-Object -Skip 1)`,
  }[command] ?? `$runtimeCommand = '${command}'`;
  return `param(\n  [Parameter(ValueFromRemainingArguments = $true)]\n  [string[]] $ToolArguments\n)\n\n$ErrorActionPreference = 'Stop'\n$env:PYTHONIOENCODING = 'utf-8'\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n$python = Get-Command python -ErrorAction SilentlyContinue\nif (-not $python) {\n  throw '未找到 Python。请先安装 Python 3.10 或更高版本，并确保 python 在 PATH 中。'\n}\n\n${dispatch}\n$runtime = Join-Path $PSScriptRoot 'office_tools.py'\n& $python.Source $runtime $runtimeCommand @ToolArguments\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n`;
}

function wordWrapper() {
  return `param(\n+  [Parameter(Mandatory = $true)] [string[]] $InputPaths,\n+  [string] $OutputDirectory = '',\n+  [switch] $Overwrite\n+)\n+\n+$ErrorActionPreference = 'Stop'\n+$supported = @('.doc', '.docx', '.docm')\n+$inputs = foreach ($item in $InputPaths) {\n+  $resolved = Resolve-Path -LiteralPath $item -ErrorAction Stop\n+  $file = Get-Item -LiteralPath $resolved.Path\n+  if ($file.PSIsContainer -or $supported -notcontains $file.Extension.ToLowerInvariant()) {\n+    throw "不支持的 Word 输入：$($file.FullName)"\n+  }\n+  $file\n+}\n+if (-not $OutputDirectory) { $OutputDirectory = Join-Path $inputs[0].DirectoryName 'Word转PDF' }\n+$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)\n+[System.IO.Directory]::CreateDirectory($outputRoot) | Out-Null\n+\n+function New-OutputPath([string] $baseName) {\n+  $candidate = Join-Path $outputRoot "$baseName.pdf"\n+  if ($Overwrite -or -not (Test-Path -LiteralPath $candidate)) { return $candidate }\n+  for ($index = 2; ; $index++) {\n+    $candidate = Join-Path $outputRoot "$baseName-$index.pdf"\n+    if (-not (Test-Path -LiteralPath $candidate)) { return $candidate }\n+  }\n+}\n+\n+$results = [System.Collections.Generic.List[object]]::new()\n+$word = $null\n+try {\n+  try {\n+    $word = New-Object -ComObject Word.Application\n+    $word.Visible = $false\n+    $word.DisplayAlerts = 0\n+  } catch {\n+    $word = $null\n+  }\n+\n+  $soffice = if (-not $word) { Get-Command soffice -ErrorAction SilentlyContinue } else { $null }\n+  if (-not $word -and -not $soffice) {\n+    throw '未找到 Microsoft Word 或 LibreOffice。请安装其中一个后重试。'\n+  }\n+\n+  foreach ($input in $inputs) {\n+    $target = New-OutputPath $input.BaseName\n+    try {\n+      if ($word) {\n+        $document = $word.Documents.Open($input.FullName, $false, $true)\n+        try { $document.ExportAsFixedFormat($target, 17) } finally { $document.Close($false) }\n+      } else {\n+        $temporary = Join-Path $outputRoot ('.convert-' + [guid]::NewGuid().ToString('N'))\n+        [System.IO.Directory]::CreateDirectory($temporary) | Out-Null\n+        try {\n+          & $soffice.Source --headless --convert-to pdf --outdir $temporary $input.FullName | Out-Null\n+          if ($LASTEXITCODE -ne 0) { throw "LibreOffice 返回退出码 $LASTEXITCODE" }\n+          $converted = Join-Path $temporary ($input.BaseName + '.pdf')\n+          if (-not (Test-Path -LiteralPath $converted)) { throw 'LibreOffice 未生成 PDF' }\n+          Move-Item -LiteralPath $converted -Destination $target\n+        } finally { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }\n+      }\n+      if (-not (Test-Path -LiteralPath $target)) { throw '转换命令结束但未生成 PDF' }\n+      $results.Add([pscustomobject]@{ input = $input.FullName; output = $target; success = $true; error = $null })\n+    } catch {\n+      $results.Add([pscustomobject]@{ input = $input.FullName; output = $null; success = $false; error = $_.Exception.Message })\n+    }\n+  }\n+} finally {\n+  if ($word) { $word.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }\n+}\n+\n+$report = Join-Path $outputRoot 'Word转PDF-处理报告.json'\n+$results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $report -Encoding utf8\n+$successCount = @($results | Where-Object success).Count\n+$payload = [ordered]@{ success = ($successCount -eq $results.Count); successCount = $successCount; failureCount = $results.Count - $successCount; outputDirectory = $outputRoot; report = $report; files = @($results) }\n+Write-Output ('WANWEI_RESULT=' + ($payload | ConvertTo-Json -Compress -Depth 6))\n+if ($successCount -ne $results.Count) { exit 2 }\n+`;
}

function fileParam(name, description, required = true) { return { name, type: 'file', required, description }; }
function fileList(name, description) { return { name, type: 'files', required: true, description }; }
function stringParam(name, description, required = false) { return { name, type: 'string', required, description }; }
function numberParam(name, description, defaultValue) { return { name, type: 'number', required: false, description, defaultValue: String(defaultValue) }; }
function enumParam(name, description, options) { return { name, type: 'select', required: true, description, options, defaultValue: options[0] }; }
function outputDirectory() { return { name: 'outputDirectory', type: 'directory', required: false, description: '输出目录；留空时在输入文件旁创建独立目录' }; }
async function writeText(path, content) { await writeFile(path, content.endsWith('\n') ? content : `${content}\n`, 'utf8'); }
