// @vitest-environment jsdom
import { afterEach,describe,expect,it,vi } from 'vitest'
import { cleanup,fireEvent,render,screen } from '@testing-library/react'
import { FileConversionWorkbench } from '../src/client/FileConversionWorkbench.tsx'
import { DocumentIntelligenceWorkbench } from '../src/client/DocumentIntelligenceWorkbench.tsx'
afterEach(cleanup)
it('scrolls to tool choices without choosing a tool',()=>{const scroll=vi.fn();Element.prototype.scrollIntoView=scroll;render(<FileConversionWorkbench/>);fireEvent.click(screen.getByRole('button',{ name:/开始新任务/ }));expect(scroll).toHaveBeenCalledWith({ behavior:'smooth',block:'start' });expect(screen.getByText('选择处理工具')).toBeTruthy();expect(screen.queryByText('核对处理信息')).toBeNull()})
describe('office expert workbenches',()=>{it('shows all five real conversion tools and validates input',()=>{render(<FileConversionWorkbench/>);for(const name of ['Word 转 PDF','PDF 转图片','PDF 合并拆分','图片转 PDF','图片压缩与格式转换'])expect(screen.getByRole('button',{ name:new RegExp(name) })).toBeTruthy();fireEvent.click(screen.getByRole('button',{ name:/PDF 转图片/ }));fireEvent.click(screen.getByRole('button',{ name:'核对处理信息' }));expect(screen.getByRole('alert').textContent).toContain('请选择输入文件')});it('validates page ranges and supports removing an input file',()=>{render(<FileConversionWorkbench/>);fireEvent.click(screen.getByRole('button',{ name:/PDF 转图片/ }));const fileInput=document.querySelector('input[type=file]') as HTMLInputElement;fireEvent.change(fileInput,{ target:{ files:[new File(['pdf'],'pages.pdf',{ type:'application/pdf' })] } });fireEvent.change(screen.getByLabelText(/页码范围/),{ target:{ value:'1,3-2' } });fireEvent.click(screen.getByRole('button',{ name:'核对处理信息' }));expect(screen.getByRole('alert').textContent).toContain('不能重复、倒序');fireEvent.click(screen.getByRole('button',{ name:'删除 pages.pdf' }));expect(screen.queryByText('pages.pdf')).toBeNull()});it('keeps summary and comparison separate without unsupported claims',()=>{render(<DocumentIntelligenceWorkbench/>);expect(screen.getByRole('button',{ name:/文档摘要与要点提取/ })).toBeTruthy();expect(screen.getByRole('button',{ name:/文档对比助手/ })).toBeTruthy();fireEvent.click(screen.getByRole('button',{ name:/文档对比助手/ }));expect(document.body.textContent).not.toContain('PPT')})})

it('shows readable review settings and a PDF deliverable for images to PDF',()=>{
  render(<FileConversionWorkbench/>)
  fireEvent.click(screen.getByRole('button',{ name:/图片转 PDF/ }))
  fireEvent.change(document.querySelector('input[type=file]') as HTMLInputElement,{ target:{ files:[new File(['image'],'封面.png',{ type:'image/png' })] } })
  fireEvent.click(screen.getByRole('button',{ name:'核对处理信息' }))
  expect(screen.getByText(/页边距：10 毫米/)).toBeTruthy()
  expect(screen.getByText('1 个 PDF 文件')).toBeTruthy()
  expect(document.body.textContent).not.toContain('pageSize=')
  expect(document.body.textContent).not.toContain('\\.pdf$')
})

it('describes document comparison outputs without regular expressions',()=>{
  render(<DocumentIntelligenceWorkbench/>)
  fireEvent.click(screen.getByRole('button',{ name:/文档对比助手/ }))
  fireEvent.change(document.querySelector('input[type=file]') as HTMLInputElement,{ target:{ files:[new File(['old'],'旧版.txt'),new File(['new'],'新版.txt')] } })
  fireEvent.click(screen.getByRole('button',{ name:'核对处理信息' }))
  expect(screen.getByText('Markdown、HTML、JSON 和文本差异文件')).toBeTruthy()
  expect(document.body.textContent).not.toContain('scope=')
})
