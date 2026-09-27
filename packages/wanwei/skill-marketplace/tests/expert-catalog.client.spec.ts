import { describe, expect, it } from 'vitest'
import { parseExpertDetailSections, projectPublishedExperts } from '../src/client/expert-catalog.ts'

const templates = [{
  id: 'geology-analysis', name: '地质条件分析专家', role: '地质分析', category: '地质',
  summary: '模板摘要', icon: 'gis', tags: ['旧标签'], examples: [], accent: '#2563eb',
}]

describe('Wanwei published expert projection', () => {
  it('uses the live published roster and administrator-configured detail panels', () => {
    const entries = [{
      key: 'geology-analysis', name: '地质条件研判', subtitle: '专业分析', category: '自然资源',
      summary: '后台摘要', tags: '["地质","选址"]', scenario: '项目选址', materials: '地块范围',
      workbench_url: 'https://geology.example.com/',
      detail_sections: JSON.stringify(Array.from({ length: 4 }, (_, index) => ({ title: `部分${index}`, subtitle: '说明', content: '内容' }))),
    }, { key: 'unknown-expert', name: '新增专家', workbench_url: 'https://new.example.com/' }]
    expect(projectPublishedExperts(entries, templates)).toEqual([expect.objectContaining({
      id: 'geology-analysis', name: '地质条件研判', role: '专业分析', tags: ['地质', '选址'],
      scenario: '项目选址', materials: '地块范围',
      detailSections: Array.from({ length: 4 }, (_, index) => ({ title: `部分${index}`, subtitle: '说明', content: '内容' })),
    }), expect.objectContaining({ id: 'unknown-expert', name: '新增专家', workbenchUrl: 'https://new.example.com/' })])
  })

  it('does not manufacture experts when the server publishes none', () => {
    expect(projectPublishedExperts([], templates)).toEqual([])
  })

  it.each(['', 'ab', 'Uppercase', '../expert', 'expert_name', `a${'b'.repeat(80)}`])(
    'omits expert id %j rejected by the launch interface', (key) => {
      expect(projectPublishedExperts([{ key, name: '专家', workbench_url: 'https://expert.example.com/' }], [])).toEqual([])
    },
  )

  it('accepts the shortest and longest launchable expert ids without a built-in template', () => {
    const keys = ['abc', `a${'b'.repeat(79)}`]
    expect(projectPublishedExperts(keys.map(key => ({ key, name: '专家', workbench_url: 'https://expert.example.com/' })), [])
      .map(entry => entry.id)).toEqual(keys)
  })

  it('supports independent experts with one to eight real detail panels', () => {
    const one = JSON.stringify([{ title: '能力', subtitle: '说明', content: '实际能力' }])
    expect(parseExpertDetailSections(one)).toEqual([{ title: '能力', subtitle: '说明', content: '实际能力' }])
    expect(parseExpertDetailSections(JSON.stringify(Array.from({ length: 9 }, () => ({ title: 't', subtitle: 's', content: 'c' }))))).toBeUndefined()
    expect(parseExpertDetailSections('[{"title":"缺字段"}]')).toBeUndefined()
  })
})
