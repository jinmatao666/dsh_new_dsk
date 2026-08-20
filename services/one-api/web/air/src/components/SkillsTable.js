import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react';
import { Button, Form, Modal, Space, Table, Tag } from '@douyinfe/semi-ui';
import { API, showError, showSuccess, timestamp2string } from '../helpers';
import SkillEditor from './SkillEditor';
import BatchImportModal from './BatchImportModal';
import {
  categorySelectOptions,
  renderCategorySelectOption,
  renderCategorySelectedItem,
  renderSkillCategoryTags
} from './skillCategoryUtils';
import { downloadSkillZip } from './skillDownload';

const BATCH_ACTIONS = {
  soft_delete: '批量软删',
  restore: '批量恢复',
  append_categories: '批量追加分类'
};

const apiSortOrder = (direction) =>
  direction === 'ascend' ? 'asc' : direction === 'descend' ? 'desc' : '';

const SkillsTable = forwardRef(({ keyword: keywordProp = '' }, ref) => {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState(keywordProp);
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState({ visible: false, mode: 'view', id: null });

  const [category, setCategory] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [skillCategories, setSkillCategories] = useState([]);
  const [deletedFilter, setDeletedFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [batchCatModal, setBatchCatModal] = useState({ visible: false, categoryIds: [] });
  const [batchImportVisible, setBatchImportVisible] = useState(false);
  const [sorter, setSorter] = useState({ field: '', direction: '' });
  const [downloadingId, setDownloadingId] = useState(null);

  const debounceRef = useRef(null);

  const load = useCallback(async (kw, pg, cat, deleted, ps, catId = '', sort = {}) => {
    setLoading(true);
    try {
      const res = await API.get('/api/skill/admin/list', {
        params: {
          keyword: kw,
          page: pg,
          perPage: ps,
          category: cat || '',
          category_id: catId || '',
          deleted: deleted || 'normal',
          sort_field: sort.field || '',
          sort_order: apiSortOrder(sort.direction)
        }
      });
      const data = res.data || {};
      setItems(data.items || []);
      setTotal(data.totalItems || 0);
    } catch (err) {
      showError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const categoryRes = await API.get('/api/skill-category/', {
        params: { includeDisabled: 1 }
      });
      if (categoryRes.data?.success !== false) {
        setSkillCategories(categoryRes.data?.data || []);
      }
    } catch (err) {
      // ignore
    }
  }, []);

  useEffect(() => {
    load(keyword, page, category, deletedFilter, pageSize, categoryId, sorter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, category, categoryId, deletedFilter, sorter, load]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const onKeywordChange = useCallback(
    (v) => {
      setKeyword(v);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setPage(1);
        load(v, 1, category, deletedFilter, pageSize, categoryId, sorter);
      }, 250);
    },
    [load, category, deletedFilter, pageSize, categoryId, sorter]
  );

  useImperativeHandle(ref, () => ({
    onKeywordChange,
    openCreate: () => setEditor({ visible: true, mode: 'create', id: null }),
    openBatchImport: () => setBatchImportVisible(true)
  }));

  const handleSoftDelete = (row) => {
    Modal.confirm({
      title: `软删除 skill: ${row.name}?`,
      content: '软删后不会在默认列表显示，可通过状态筛选恢复。',
      onOk: async () => {
        try {
          const res = await API.delete(`/api/skill/${row.id}`);
          if (res.data?.success === false) {
            showError(res.data.message || '删除失败');
            return;
          }
          showSuccess('已软删');
          load(keyword, page, category, deletedFilter, pageSize, categoryId, sorter);
        } catch (err) {
          showError(err.message || '删除失败');
        }
      }
    });
  };

  const handleHardDelete = (row) => {
    Modal.confirm({
      title: `彻底删除 skill: ${row.name}?`,
      content: '此操作不可恢复，将从数据库物理删除。',
      okType: 'danger',
      onOk: async () => {
        try {
          const res = await API.delete(`/api/skill/${row.id}?force=1`);
          if (res.data?.success === false) {
            showError(res.data.message || '删除失败');
            return;
          }
          showSuccess('已彻底删除');
          load(keyword, page, category, deletedFilter, pageSize, categoryId, sorter);
          loadCategories();
        } catch (err) {
          showError(err.message || '删除失败');
        }
      }
    });
  };

  const handleRestore = async (row) => {
    try {
      const res = await API.post(`/api/skill/${row.id}/restore`);
      if (res.data?.success === false) {
        showError(res.data.message || '恢复失败');
        return;
      }
      showSuccess('已恢复');
      load(keyword, page, category, deletedFilter, pageSize, categoryId, sorter);
    } catch (err) {
      showError(err.message || '恢复失败');
    }
  };

  const handleDownload = async (row) => {
    setDownloadingId(row.id);
    try {
      await downloadSkillZip('public', row.id);
      showSuccess('已开始下载');
    } catch (err) {
      showError(err.message || '下载失败');
    } finally {
      setDownloadingId(null);
    }
  };

  const runBatch = async (action, value) => {
    try {
      const res =
        action === 'append_categories'
          ? await API.post('/api/skill/admin/batch-categories', {
              skill_ids: selectedIds,
              action: 'append',
              category_ids: value || []
            })
          : await API.post('/api/skill/admin/batch', {
              ids: selectedIds,
              action,
              value: value || ''
            });
      if (res.data?.success === false) {
        showError(res.data.message || '批量操作失败');
        return;
      }
      const affected = res.data?.data?.affected;
      showSuccess(affected == null ? '批量操作完成' : `已处理 ${affected} 条`);
      setSelectedIds([]);
      load(keyword, page, category, deletedFilter, pageSize, categoryId, sorter);
      loadCategories();
    } catch (err) {
      showError(err.message || '批量操作失败');
    }
  };

  const handleBatch = (action) => {
    if (selectedIds.length === 0) {
      showError('请先选择至少一行');
      return;
    }
    if (action === 'append_categories') {
      setBatchCatModal({ visible: true, categoryIds: [] });
      return;
    }
    Modal.confirm({
      title: `${BATCH_ACTIONS[action]}（共 ${selectedIds.length} 项)?`,
      onOk: () => runBatch(action, '')
    });
  };

  const handleBatchCatSubmit = () => {
    const ids = batchCatModal.categoryIds || [];
    if (!ids.length) {
      showError('请选择分类');
      return;
    }
    runBatch('append_categories', ids);
    setBatchCatModal({ visible: false, categoryIds: [] });
  };

  const categoryFilterOptions = skillCategories.map((c) => ({
    text: `${c.type_name || c.type_code} / ${c.name || c.code}`,
    value: String(c.id)
  }));

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 80,
      sorter: true
    },
    {
      title: 'Name',
      dataIndex: 'name',
      width: 200,
      sorter: true
    },
    {
      title: '中文名称',
      dataIndex: 'display_name',
      width: 180,
      sorter: true,
      render: (v) => v || '-'
    },
    {
      title: '分类',
      dataIndex: 'categories',
      width: 240,
      filters: categoryFilterOptions,
      filterMultiple: false,
      render: (_, record) => renderSkillCategoryTags(record.categories || [])
    },
    {
      title: '描述',
      dataIndex: 'description',
      width: 160,
      render: (v) => {
        const text = v || '';
        const short = text.length > 10 ? text.slice(0, 10) + '...' : text;
        return (
          <span title={text} style={{ whiteSpace: 'nowrap' }}>
            {short || '-'}
          </span>
        );
      }
    },
    {
      title: '状态',
      dataIndex: 'is_deleted',
      width: 110,
      filters: [
        { text: '正常', value: 'normal' },
        { text: '已删除', value: 'deleted' }
      ],
      filterMultiple: false,
      render: (v) =>
        v ? <Tag color='red'>已删除</Tag> : <Tag color='green'>正常</Tag>
    },
    {
      title: '下载',
      dataIndex: 'downloads',
      width: 90,
      sorter: true
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 180,
      sorter: true,
      render: (v) => (
        <span style={{ whiteSpace: 'nowrap' }}>
          {v ? timestamp2string(v) : '-'}
        </span>
      )
    },
    {
      title: '操作',
      width: 320,
      fixed: 'right',
      render: (_, record) =>
        record.is_deleted ? (
          <Space>
            <Button
              size='small'
              onClick={() => setEditor({ visible: true, mode: 'view', id: record.id })}
            >
              查看
            </Button>
            <Button
              size='small'
              theme='light'
              loading={downloadingId === record.id}
              onClick={() => handleDownload(record)}
            >
              下载
            </Button>
            <Button
              size='small'
              theme='light'
              type='primary'
              onClick={() => handleRestore(record)}
            >
              恢复
            </Button>
            <Button
              size='small'
              theme='light'
              type='danger'
              onClick={() => handleHardDelete(record)}
            >
              彻底删除
            </Button>
          </Space>
        ) : (
          <Space>
            <Button
              size='small'
              onClick={() => setEditor({ visible: true, mode: 'view', id: record.id })}
            >
              查看
            </Button>
            <Button
              size='small'
              theme='light'
              loading={downloadingId === record.id}
              onClick={() => handleDownload(record)}
            >
              下载
            </Button>
            <Button
              size='small'
              theme='light'
              type='primary'
              onClick={() => setEditor({ visible: true, mode: 'edit', id: record.id })}
            >
              编辑
            </Button>
            <Button
              size='small'
              theme='light'
              type='danger'
              onClick={() => handleSoftDelete(record)}
            >
              删除
            </Button>
          </Space>
        )
    }
  ];

  const onTableChange = ({ filters: newFilters, sorter: newSorter }) => {
    if (newFilters) {
      const catFilter = newFilters.find((f) => f.dataIndex === 'category');
      const categoryRelFilter = newFilters.find((f) => f.dataIndex === 'categories');
      const stateFilter = newFilters.find((f) => f.dataIndex === 'is_deleted');
      const newCat = catFilter?.filteredValue?.[0] || '';
      const newCategoryId = categoryRelFilter?.filteredValue?.[0] || '';
      const stateVal = stateFilter?.filteredValue?.[0] || '';
      if (newCat !== category) {
        setCategory(newCat);
        setPage(1);
      }
      if (newCategoryId !== categoryId) {
        setCategoryId(newCategoryId);
        setCategory('');
        setPage(1);
      }
      const newDeletedFilter = stateVal === 'deleted' ? 'deleted' : '';
      if (newDeletedFilter !== deletedFilter) {
        setDeletedFilter(newDeletedFilter);
        setPage(1);
      }
    }
    if (newSorter) {
      const nextSorter = {
        field: newSorter.dataIndex || '',
        direction: newSorter.sortOrder || ''
      };
      if (nextSorter.field !== sorter.field || nextSorter.direction !== sorter.direction) {
        setPage(1);
        setSorter(nextSorter);
      }
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {selectedIds.length > 0 && (
        <Space style={{ marginBottom: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: '#666' }}>已选 {selectedIds.length} 项</span>
          <Button size='small' type='danger' onClick={() => handleBatch('soft_delete')}>
            批量软删
          </Button>
          <Button size='small' type='primary' onClick={() => handleBatch('restore')}>
            批量恢复
          </Button>
          <Button size='small' onClick={() => handleBatch('append_categories')}>
            批量追加分类
          </Button>
          <Button size='small' onClick={() => setSelectedIds([])}>
            取消选择
          </Button>
        </Space>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Table
          columns={columns}
          dataSource={items}
          rowKey='id'
          loading={loading}
          scroll={{ y: 'calc(100vh - 245px)', x: 'max-content' }}
          sticky={{ top: 0 }}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys)
          }}
          onChange={onTableChange}
          pagination={{
            currentPage: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOpts: [20, 50, 100],
            formatPageText: (p) => `第 ${p.currentStart} - ${p.currentEnd} 条，共 ${total} 条`,
            onPageSizeChange: (size) => {
              setPageSize(size);
              setPage(1);
            },
            onPageChange: setPage
          }}
        />
      </div>

      <SkillEditor
        visible={editor.visible}
        kind='public'
        mode={editor.mode}
        id={editor.id}
        onClose={() => setEditor({ ...editor, visible: false })}
        onSaved={() => {
          load(keyword, page, category, deletedFilter, pageSize, categoryId, sorter);
          loadCategories();
        }}
        skillCategories={skillCategories}
      />

      <Modal
        title='批量追加分类'
        visible={batchCatModal.visible}
        onOk={handleBatchCatSubmit}
        onCancel={() => setBatchCatModal({ visible: false, categoryIds: [] })}
        okText='确定'
        cancelText='取消'
      >
        <Form>
          <Form.Select
            field='category_ids'
            label='分类'
            placeholder='选择要追加的分类'
            multiple
            optionList={categorySelectOptions(skillCategories)}
            renderOptionItem={renderCategorySelectOption}
            renderSelectedItem={renderCategorySelectedItem}
            initValue={batchCatModal.categoryIds}
            onChange={(v) => setBatchCatModal((s) => ({ ...s, categoryIds: v || [] }))}
          />
        </Form>
      </Modal>

      <BatchImportModal
        visible={batchImportVisible}
        onClose={() => setBatchImportVisible(false)}
        onDone={() => {
          setPage(1);
          load(keyword, 1, category, deletedFilter, pageSize, categoryId, sorter);
          loadCategories();
        }}
        skillCategories={skillCategories}
      />
    </div>
  );
});

SkillsTable.displayName = 'SkillsTable';

export default SkillsTable;
