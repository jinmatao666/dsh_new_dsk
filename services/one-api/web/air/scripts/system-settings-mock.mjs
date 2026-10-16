/** Opt-in development-only API fixture; never included in production builds. */
export default function systemSettingsMock() {
  const user = { id: 1, username: 'root', display_name: '系统管理员', role: 100, status: 1, group: 'default', email: 'admin@example.test' };
  let settings = { network: 'internet', operator: '张运维', phone: '0571-12345678' };
  return {
    name: 'system-settings-mock',
    apply: 'serve',
    transformIndexHtml(html) {
      return { html, tags: [{ tag: 'script', injectTo: 'head', children: `localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});` }] };
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (!pathname.startsWith('/api/')) return next();
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('X-Preview-Data', 'mock');
        let payload = { success: true, data: [], totalItems: 0 };
        if (pathname === '/api/user/self') payload.data = user;
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
