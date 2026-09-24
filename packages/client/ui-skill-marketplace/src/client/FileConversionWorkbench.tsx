import {
  OfficeExpertWorkbench,
  type ToolDef,
} from './OfficeExpertWorkbench.tsx'
import type { OfficeTaskService } from './office-task.ts'
import { meetingIconImages } from './MeetingIconData.ts'
import { fileHero } from './OfficeExpertHeroImages.ts'
import {
  fileHome,
  fileHistory,
  fileFolder,
  fileGuide,
  fileUpload,
  wordPdf,
  pdfImages,
  pdfOrganize,
  imagesPdf,
  imageOptimize,
} from './office-icons.ts'
const tools: readonly ToolDef[] = [
  {
    id: 'word-pdf',
    name: 'Word 转 PDF',
    description:
      '批量将 DOC、DOCX 或 DOCM 转为 PDF，结果取决于本机可用转换器。',
    accept: '.doc,.docx,.docm',
    multiple: true,
    skill: 'office-word-to-pdf',
    expected: ['\\.pdf$'],
  },
  {
    id: 'pdf-images',
    name: 'PDF 转图片',
    description: '将一个 PDF 的全部页面或指定页码导出为 PNG 或 JPG。',
    accept: '.pdf',
    multiple: false,
    skill: 'office-pdf-to-images',
    expected: ['\\.(png|jpg)$'],
    params: [
      {
        key: 'format',
        label: '输出格式',
        type: 'select',
        options: ['png', 'jpg'],
        default: 'png',
      },
      {
        key: 'pages',
        label: '页码范围（留空表示全部）',
        type: 'text',
        default: '',
      },
      {
        key: 'dpi',
        label: 'DPI',
        type: 'select',
        options: ['144', '200', '300'],
        default: '144',
      },
    ],
  },
  {
    id: 'pdf-organize',
    name: 'PDF 合并拆分',
    description: '合并多个 PDF，或按合法页码范围拆分一个 PDF。',
    accept: '.pdf',
    multiple: true,
    skill: 'office-pdf-organizer',
    expected: ['\\.pdf$'],
    params: [
      {
        key: 'mode',
        label: '处理模式',
        type: 'select',
        options: ['合并', '按范围拆分', '逐页拆分'],
        default: '合并',
      },
      { key: 'pages', label: '拆分页码范围', type: 'text', default: '' },
    ],
  },
  {
    id: 'images-pdf',
    name: '图片转 PDF',
    description:
      '按选择顺序将 JPG、PNG、WebP 图片生成一个 PDF，保持比例且不裁切。',
    accept: '.jpg,.jpeg,.png,.webp',
    multiple: true,
    skill: 'office-images-to-pdf',
    expected: ['\\.pdf$'],
    params: [
      {
        key: 'pageSize',
        label: '页面尺寸',
        type: 'select',
        options: ['原始尺寸', 'A4', 'A3', 'Letter'],
        default: 'A4',
      },
      {
        key: 'orientation',
        label: '方向',
        type: 'select',
        options: ['自动', '纵向', '横向'],
        default: '自动',
      },
      { key: 'margin', label: '页边距（mm）', type: 'text', default: '10' },
    ],
  },
  {
    id: 'image-optimize',
    name: '图片压缩与格式转换',
    description: '批量优化 JPG、PNG、WebP；保持比例、不放大。',
    accept: '.jpg,.jpeg,.png,.webp',
    multiple: true,
    skill: 'office-image-optimizer',
    expected: ['\\.(jpg|jpeg|png|webp)$'],
    params: [
      {
        key: 'format',
        label: '输出格式',
        type: 'select',
        options: ['保持原格式', 'jpg', 'png', 'webp'],
        default: 'webp',
      },
      {
        key: 'quality',
        label: '质量（PNG 不使用有损质量）',
        type: 'text',
        default: '85',
      },
      {
        key: 'maxWidth',
        label: '最大宽度（可留空）',
        type: 'text',
        default: '1920',
      },
      {
        key: 'maxHeight',
        label: '最大高度（可留空）',
        type: 'text',
        default: '1080',
      },
    ],
  },
]
export function FileConversionWorkbench({
  service,
  expertIcon,
  expertName,
  expertSubtitle,
}: {
  service?: OfficeTaskService | undefined
  expertIcon?: string | undefined
  expertName?: string | undefined
  expertSubtitle?: string | undefined
}) {
  return (
    <OfficeExpertWorkbench
      title={expertName ?? '文件转换与 PDF 工具专家'}
      subtitle={expertSubtitle ?? '常用文档、PDF 与图片批量处理'}
      icon={expertIcon}
      service={service}
      tools={tools}
      visuals={{
        expert: wordPdf,
        home: fileHome,
        history: fileHistory,
        files: fileFolder,
        guide: fileGuide,
        info: fileGuide,
        emptyHistory: meetingIconImages.history,
        emptyFiles: fileUpload,
        toolIcons: {
          'word-pdf': wordPdf,
          'pdf-images': pdfImages,
          'pdf-organize': pdfOrganize,
          'images-pdf': imagesPdf,
          'image-optimize': imageOptimize,
        },
        heroTitle: '选择一个工具，开始处理文件',
        heroText: '覆盖常用 Word、PDF 与图片处理场景，原文件始终保留。',
        heroPoints: ['真实文件处理', '独立任务目录', '成果随时打开'],
        heroBackground: fileHero,
      }}
      guide={[
        {
          title: 'Word 转 PDF',
          text: '依赖本机 Word、WPS 或 LibreOffice。尽可能保持排版，最终效果以真实结果为准。',
        },
        {
          title: 'PDF 页码',
          text: '页码从 1 开始；非法、重复、倒序和越界范围会失败。',
        },
        { title: '图片转 PDF', text: '保持宽高比、不裁切；透明区域转白底。' },
        {
          title: '图片优化',
          text: 'PNG 不承诺通过质量参数有损压缩，也不保证输出一定更小。',
        },
      ]}
    />
  )
}
