/** Run administrator skill actions through the existing permission-checked single-skill APIs. */
export const SKILL_BATCH_LABELS = { publish: '上架', unpublish: '下架', delete: '删除' };

const checked = response => {
  if (response.data?.success !== true) throw new Error(response.data?.message || '服务端未确认操作成功');
  return response.data.data;
};

/**
 * Executes sequentially without rollback or automatic retry; item failures do not stop later items.
 * @param {Array} records Selected rows with source-prefixed keys, IDs and publication status.
 * @param {string} action publish, unpublish or delete.
 * @param {object} api Permission-checked HTTP client.
 * @param {Function} onProgress Receives completed/total counts and the current name.
 * @returns {Promise<Array>} Per-row success, failed or skipped results.
 */
export async function manageSkillBatch(records, action, api, onProgress) {
  if (!Object.prototype.hasOwnProperty.call(SKILL_BATCH_LABELS, action)) throw new Error('不支持的批量操作');
  const results = [];
  for (const record of records) {
    const result = { key: record._rowKey, name: record.display_name || record.name, state: 'success', message: '' };
    onProgress({ completed: results.length, total: records.length, current: result.name });
    try {
      if (action !== 'delete' && record.record_type === 'private') {
        result.state = 'skipped'; result.message = '私人技能不支持上下架';
      } else if (action === 'publish' && record.status === 1) {
        result.state = 'skipped'; result.message = '已上架，无需重复操作';
      } else if (action === 'unpublish' && record.status !== 1) {
        result.state = 'skipped'; result.message = '未上架，无需重复操作';
      } else if (action === 'delete') {
        checked(await api.delete(`/api/${record.record_type === 'private' ? 'personal-skill/admin' : 'skill'}/${record.id}`));
      } else if (action === 'unpublish') {
        checked(await api.post(`/api/skill/${record.id}/unpublish`));
      } else {
        const releases = checked(await api.get(`/api/skill/${record.id}/releases`));
        const target = (Array.isArray(releases) ? releases : []).find(release => ['unpublished', 'draft', 'published'].includes(release.state));
        if (!target) throw new Error('未找到可上架的技能版本');
        checked(await api.post(`/api/skill/${record.id}/releases/${target.id}/publish`));
      }
    } catch (error) {
      result.state = 'failed'; result.message = error.response?.data?.message || error.message || '操作失败';
    }
    results.push(result);
  }
  onProgress({ completed: results.length, total: records.length, current: '' });
  return results;
}
