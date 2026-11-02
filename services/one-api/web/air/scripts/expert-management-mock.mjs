/** Explicit local preview only. State is in memory and never reaches a real backend. */
export default function expertManagementMock() {
  const categories = ['政策法规', '规划审查', '空间分析', '材料编制'];
  let experts = [
    ['law-matching', '法律依据智能匹配专家', '政策法规', true, '法'],
    ['forest-analysis', '林耕冲突分析专家', '空间分析', true, '林'],
    ['land-review', '建设用地报批审查专家', '规划审查', true, '审'],
    ['planning-document', '规划文本编制专家', '材料编制', false, '文'],
    ['planning-review', '规划传导审查专家', '规划审查', true, '规'],
    ['spatial-inspection', '国土空间合规检查专家', '规划审查', false, '检'],
    ['meeting-minutes', '会议纪要整理专家', '材料编制', true, '记'],
    ['gis-analysis', '空间数据分析专家', '空间分析', false, '图'],
    ['document-assistant', '综合材料辅助专家', '', false, '助'],
  ].map(([key, name, category, published, glyph], index) => ({
    key, name, category, published, provider: 'wanwei', tags: '[]',
    summary: `${name}的演示资料`, subtitle: '专业辅助与成果检查',
    workbench_url: `https://expert.example.test/${key}`, sort_order: 100 - index,
    preview_glyph: glyph,
  }));
  // SVG is rendered by the browser for mock icons, using the same data-image path as uploaded icons.
  experts = experts.map(item => ({ ...item, icon: `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="14" fill="#e9f1ff"/><text x="32" y="43" text-anchor="middle" fill="#377bff" font-family="sans-serif" font-size="32">${item.preview_glyph}</text></svg>`).toString('base64')}` }));
  return {
    name: 'expert-management-mock', apply: 'serve',
    transformIndexHtml(html) {
      return { html, tags: [{ tag: 'script', injectTo: 'head-prepend', children: 'var __webpack_public_path__ = "/";' }] };
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = new URL(request.url, 'http://localhost').pathname;
        if (!path.startsWith('/api/expert-web/admin/') && path !== '/api/expert/admin/categories') return next();
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('X-Preview-Data', 'mock');
        const send = data => response.end(JSON.stringify(data));
        if (path === '/api/expert/admin/categories') return send({ success: true, data: categories.map((name, index) => ({ id: index + 1, name, enabled: true })) });
        if (path === '/api/expert-web/admin/list') return send({ success: true, data: experts });
        let body = '';
        for await (const chunk of request) body += chunk;
        const input = body ? JSON.parse(body) : {};
        const match = path.match(/^\/api\/expert-web\/admin\/([^/]+)(?:\/(publish|credential))?$/);
        const key = match ? decodeURIComponent(match[1]) : input.key;
        const item = experts.find(candidate => candidate.key === key);
        if (request.method === 'POST' && !match) {
          experts = [...experts, { ...input, published: false }];
        } else if (!item) {
          return send({ success: false, message: '专家不存在' });
        } else if (request.method === 'DELETE') {
          experts = experts.filter(candidate => candidate.key !== key);
        } else if (request.method === 'PUT') {
          Object.assign(item, match[2] === 'publish' ? { published: input.published } : input);
        } else if (match[2] === 'credential') {
          return send({ success: true, provider_credential: 'mock-preview-credential-not-for-production' });
        }
        return send({ success: true });
      });
    },
  };
}
