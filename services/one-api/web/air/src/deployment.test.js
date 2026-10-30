describe.each([
  ['', ''], ['/dsh-admin', '/dsh-api'], ['/unit/control', '/unit/service'],
])('runtime deployment %s and %s', (adminPrefix, apiPrefix) => {
  let paths;
  beforeEach(() => {
    jest.resetModules();
    window.__DSH_DEPLOYMENT__ = { adminPrefix, apiPrefix };
    paths = require('./deployment');
  });
  afterEach(() => { delete window.__DSH_DEPLOYMENT__; });
  test('routes, built-in icons and API resources use their own prefixes', () => {
    expect(paths.adminURL('/login')).toBe(adminPrefix + '/login');
    expect(paths.adminURL('/skill/reviews/42/test')).toBe(adminPrefix + '/skill/reviews/42/test');
    expect(paths.resourceURL('/brand-mark.svg')).toBe(adminPrefix + '/brand-mark.svg');
    expect(paths.resourceURL('/skill-icons/assistant.png')).toBe(adminPrefix + '/skill-icons/assistant.png');
    expect(paths.resourceURL('/api/skill/42')).toBe(apiPrefix + '/api/skill/42');
    expect(paths.resourceURL('/v1beta/models')).toBe(apiPrefix + '/v1beta/models');
    expect(paths.resourceURL('/downloads/installers/id')).toBe(apiPrefix + '/downloads/installers/id');
    expect(paths.adminURL(adminPrefix + '/login')).toBe(adminPrefix + '/login');
    expect(paths.apiURL(apiPrefix + '/api/status')).toBe(apiPrefix + '/api/status');
  });
  test('external URLs, data images, fragments and relative filenames remain intact', () => {
    for (const url of ['https://third.example/path', '//cdn.example/file', 'data:image/png;base64,abc', '#section', 'files/a.png']) {
      expect(paths.resourceURL(url)).toBe(url);
    }
  });
  test('axios and shared navigation use runtime settings', () => {
    const { API } = require('./helpers/api');
    expect(API.getUri({ url: '/api/user/login' })).toBe(apiPrefix + '/api/user/login');
    const history = require('./history').default;
    history.push('/login');
    expect(window.location.pathname).toBe(adminPrefix + '/login');
    history.replace({ pathname: adminPrefix + '/skill/reviews/42/test', search: '?x=1' });
    expect(window.location.pathname).toBe(adminPrefix + '/skill/reviews/42/test');
    expect(window.location.search).toBe('?x=1');
  });
});
