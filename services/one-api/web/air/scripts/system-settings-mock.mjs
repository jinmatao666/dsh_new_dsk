/** Opt-in development-only API fixture; never included in production builds. */
export default function systemSettingsMock() {
  const user = { id: 1, username: 'root', display_name: '系统管理员', role: 100, status: 1, group: 'default', email: 'admin@example.test' };
  let settings = { network: 'internet', operator: '张运维', phone: '0571-12345678' };
  const colleague = { ...user, id: 7, username: 'caixuebo', display_name: '蔡雪波', role: 10 };
  const inquiries = [
    { id: 1, username: '林晓', context: 'lin@example.com', phone: '13800000000', content: '计划在纯内网部署，约 80 人使用，希望接入现有知识库和本地模型。', read: false },
    { id: 2, username: '陈宇', context: 'chen@example.com', content: '为设计团队搭建试点环境，想了解部署周期和服务器配置。', read: true },
    { id: 3, username: '许宁', context: 'xu@example.com', content: '需要离线安装，希望对接现有统一身份认证。', read: false },
  ].map((row, index) => ({ ...row, feedback_type: 'deployment_inquiry', created_at: Math.floor(Date.now() / 1000) - index * 86400 }));
  const nodes = [
    { id: 1, parent_id: 0, name: '浙江万维空间信息技术有限公司' },
    { id: 2, parent_id: 1, name: '技术中心' },
    { id: 3, parent_id: 2, name: '研发部' },
    { id: 4, parent_id: 3, name: '智能体研发组' },
    { id: 5, parent_id: 2, name: 'GIS研发部' },
    { id: 6, parent_id: 1, name: '项目中心' },
    { id: 7, parent_id: 6, name: '数字规划专班' },
    { id: 8, parent_id: 1, name: '综合管理部' },
    { id: 9, parent_id: 0, name: '杭州分公司' },
    { id: 10, parent_id: 9, name: '实施交付部' },
  ];
  return {
    name: 'system-settings-mock',
    apply: 'serve',
    transformIndexHtml(html) {
      return { html, tags: [{ tag: 'script', injectTo: 'head', children: `localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});` }] };
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const { pathname, searchParams } = new URL(request.url, 'http://localhost');
        if (!pathname.startsWith('/api/')) return next();
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('X-Preview-Data', 'mock');
        let payload = { success: true, data: [], totalItems: 0 };
        if (pathname === '/api/feedback/list') {
          const read = searchParams.get('read');
          const items = inquiries.filter(row => read === null || String(row.read) === read);
          payload.data = { items, total: items.length };
        }
        const inquiryMatch = pathname.match(/^\/api\/website-deployment-inquiries\/(\d+)\/read$/);
        if (inquiryMatch && request.method === 'PUT') {
          let body = '';
          for await (const chunk of request) body += chunk;
          const row = inquiries.find(item => item.id === Number(inquiryMatch[1]));
          try {
            const { read } = JSON.parse(body);
            if (!row || typeof read !== 'boolean') throw new Error('无效的咨询状态');
            row.read = read;
          } catch {
            response.statusCode = 400;
            payload = { success: false };
          }
        }
        if (pathname === '/api/user/self') payload.data = user;
        if (pathname === '/api/desktop-updates') payload.data = { items: [], channels: [], signing_configured: true };
        if (pathname === '/api/admin/website-installers') {
          if (request.method !== 'GET') { response.statusCode = 409; payload = { success: false, message: '本地样式预览不保存文件，请连接实际后台测试上传与发布。' }; }
          else payload.data = { items: [], channels: [], max_bytes: 2147483648 };
        }
        if (pathname === '/api/user/') { payload.data = [colleague, user]; payload.total = 2; }
        if (pathname === '/api/user/7') payload.data = colleague;
        if (pathname === '/api/user/1') payload.data = user;
        if (pathname.startsWith('/api/role')) payload.data = [
          { role: 10, name: '点石员工', status: 1 }, { role: 100, name: '超级管理员', status: 1 },
        ];
        if (pathname === '/api/government-organization/') payload.data = nodes;
        if (pathname === '/api/government-organization/memberships') payload.data = {
          users: [colleague, user], memberships: [{ user_id: 7, node_id: 4 }, { user_id: 7, node_id: 7 }],
        };
        if (pathname === '/api/desktop-config') payload.data = settings;
        if (pathname === '/api/status') payload.data = { system_name: '万维Buddy', logo: '/brand-mark.svg', register_enabled: false };
        if (pathname === '/api/option/') {
          if (request.method === 'PUT') {
            try {
              let body = '';
              for await (const chunk of request) body += chunk;
              const option = JSON.parse(body);
              if (option.key !== 'SystemDeploymentSettings') throw new Error('预览只允许修改系统设置');
              const value = JSON.parse(option.value);
              if (!['internet', 'intranet'].includes(value.network)) throw new Error('网络类型无效');
              if (!['government', 'operations'].includes(value.edition)) throw new Error('版本类型无效');
              settings = value;
            } catch (error) { payload = { success: false, message: error.message }; }
          } else payload.data = [{ key: 'SystemDeploymentSettings', value: JSON.stringify(settings) }];
        }
        response.end(JSON.stringify(payload));
      });
    },
  };
}
