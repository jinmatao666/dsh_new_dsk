/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots need explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import RegistrationSettings from './RegistrationSettings';
import { fetchManagedRoles } from '../../helpers/roles';
jest.mock('../../helpers/roles', () => ({ fetchManagedRoles: jest.fn() }));
import { API } from '../../helpers';
jest.mock('../../helpers', () => ({ API: { get: jest.fn(), put: jest.fn() } }));
let container, root;
beforeEach(() => { fetchManagedRoles.mockResolvedValue([{role:3,name:"注册用户",status:1},{role:100,name:"超级管理员",status:1}]); global.IS_REACT_ACT_ENVIRONMENT = true; container=document.createElement('div');document.body.append(container);root=createRoot(container);API.get.mockResolvedValue({data:{success:true,data:[{key:'SMSEnabled',value:'false'},{key:'SMSAccessKeySecret',value:'never-show-this'}]}}); });
afterEach(() => { act(()=>root.unmount());container.remove();jest.clearAllMocks(); });
test('leaves credentials blank and saves only changed options', async () => {
 await act(async()=>root.render(<RegistrationSettings/>));
 const secret=container.querySelector('input[type=password]');expect(secret.value).toBe('');
 const input=container.querySelector('input[type=checkbox]');act(()=>input.click());
 API.put.mockResolvedValue({data:{success:true}});
 await act(async()=>container.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(API.put.mock.calls).toEqual([['/api/option/',{key:'SMSEnabled',value:'true'}]]);
 expect(container.textContent).toContain('登录与注册设置已保存');
 expect(container.textContent).not.toContain('never-show-this');
});
test('shows business errors and keeps unsaved changes for retry', async () => {
 await act(async()=>root.render(<RegistrationSettings/>));act(()=>container.querySelector('input[type=checkbox]').click());
 API.put.mockResolvedValue({data:{success:false,message:'短信参数未配置'}});
 await act(async()=>container.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(container.textContent).toContain('短信参数未配置');expect(container.querySelector('button[type=submit]').disabled).toBe(false);
});

test('configures the default registration role in the unified registration form', async () => {
 await act(async()=>root.render(<RegistrationSettings/>));
 const select=container.querySelector('[aria-label="新注册用户默认角色"]');
 expect([...select.options].some(option=>option.value==='100')).toBe(false);
 act(()=>{select.value='3';select.dispatchEvent(new Event('change',{bubbles:true}));});
 API.put.mockResolvedValue({data:{success:true}});
 await act(async()=>container.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(API.put).toHaveBeenCalledWith('/api/option/',{key:'RegistrationDefaultRole',value:'3'});
});
