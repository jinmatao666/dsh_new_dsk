import { createBrowserHistory } from 'history';

// 全局共享的 history 实例。
// 之所以自建而不用 BrowserRouter 内部的 history，是因为 react-router v6 的
// useBlocker / usePrompt 仅在 data router 下可用，本项目用的是普通路由。
// 通过 unstable_HistoryRouter 注入这个实例后，就能用 history.block() 拦截
// 站内 <Link> 跳转，实现"未保存提示"。
const history = createBrowserHistory();

export default history;
