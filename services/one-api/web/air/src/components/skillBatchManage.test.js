import { manageSkillBatch } from './skillBatchManage';

const row = (id, extra = {}) => ({ id, name: `skill-${id}`, _rowKey: `published-${id}`, status: 0, ...extra });
const ok = data => ({ data: { success: true, data } });

test('publishes through version validation APIs and continues after individual failures', async () => {
  const api = {
    get: jest.fn(async url => url.includes('/2/') ? ok([]) : ok([{ id: 11, state: 'unpublished' }])),
    post: jest.fn(async () => ok()),
  };
  const results = await manageSkillBatch([row(1), row(2), row(3), row(4, { status: 1 }), row(5, { record_type: 'private' })], 'publish', api, jest.fn());
  expect(results.map(result => result.state)).toEqual(['success', 'failed', 'success', 'skipped', 'skipped']);
  expect(api.post.mock.calls.map(call => call[0])).toEqual(['/api/skill/1/releases/11/publish', '/api/skill/3/releases/11/publish']);
  expect(results[1].message).toBe('未找到可上架的技能版本');
});

test('uses distinct public/private delete endpoints and treats HTTP 200 business errors as failures', async () => {
  const api = { delete: jest.fn(async url => url.includes('personal-skill') ? ok() : { data: { success: false, message: '禁止删除' } }) };
  const results = await manageSkillBatch([row(1), row(1, { _rowKey: 'private-1', record_type: 'private' })], 'delete', api, jest.fn());
  expect(api.delete.mock.calls.map(call => call[0])).toEqual(['/api/skill/1', '/api/personal-skill/admin/1']);
  expect(results.map(result => [result.key, result.state])).toEqual([['published-1', 'failed'], ['private-1', 'success']]);
});

test('unpublishes only published public skills, reports progress and does not retry failures', async () => {
  const api = { post: jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(ok()) };
  const progress = jest.fn();
  const results = await manageSkillBatch([row(1, { status: 1 }), row(2, { status: 1 }), row(3)], 'unpublish', api, progress);
  expect(results.map(result => result.state)).toEqual(['failed', 'success', 'skipped']);
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(progress).toHaveBeenLastCalledWith({ completed: 3, total: 3, current: '' });
});
