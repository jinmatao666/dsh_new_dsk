import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react';
import { Button, Modal, Space, Table } from '@douyinfe/semi-ui';
import { API, showError, showSuccess, timestamp2string } from '../helpers';
import SkillEditor from './SkillEditor';
import { downloadSkillZip } from './skillDownload';

const apiSortOrder = (direction) =>
  direction === 'ascend' ? 'asc' : direction === 'descend' ? 'desc' : '';

const PersonalSkillsTable = forwardRef(({ keyword: keywordProp = '' }, ref) => {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState(keywordProp);
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState({ visible: false, mode: 'view', id: null });
  const [sorter, setSorter] = useState({ field: '', direction: '' });
  const [ownerFilter, setOwnerFilter] = useState('');
  const [downloadingId, setDownloadingId] = useState(null);
  const debounceRef = useRef(null);

  const load = useCallback(async (kw, pg, ps, owner = '', sort = {}) => {
    setLoading(true);
    try {
      const res = await API.get('/api/personal-skill/admin/', {
        params: {
          keyword: kw,
          page: pg,
          perPage: ps,
          owner,
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

  useEffect(() => {
    load(keyword, page, pageSize, ownerFilter, sorter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, ownerFilter, sorter, load]);

  const onKeywordChange = useCallback(
    (v) => {
      setKeyword(v);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setPage(1);
        load(v, 1, pageSize, ownerFilter, sorter);
      }, 250);
    },
    [load, pageSize, ownerFilter, sorter]
  );

  useImperativeHandle(ref, () => ({
    onKeywordChange,
    openCreate: () => setEditor({ visible: true, mode: 'create', id: null })
  }));

  const handleDelete = (row) => {
    Modal.confirm({
      title: `确认删除 ${row.owner} 的 skill: ${row.name}?`,
      content: '该操作不可恢复。',
      onOk: async () => {
        try {
          const res = await API.delete(`/api/personal-skill/admin/${row.id}`);
          if (res.data?.success === false) {
            showError(res.data.message || '删除失败');
            return;
          }
          showSuccess('已删除');
          load(keyword, page, pageSize, ownerFilter, sorter);
        } catch (err) {
          showError(err.message || '删除失败');
        }
      }
    });
  };

  const handleDownload = async (row) => {
    setDownloadingId(row.id);
    try {
      await downloadSkillZip('personal', row.id);
      showSuccess('已开始下载');
    } catch (err) {
      showError(err.message || '下载失败');
    } finally {
      setDownloadingId(null);
    }
  };

  const ownerOptions = useMemo(() => {
    const set = new Set();
    items.forEach((it) => {
      if (it.owner) set.add(it.owner);
    });
    return Array.from(set).map((o) => ({ text: o, value: o }));
  }, [items]);

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 80, sorter: true },
    { title: 'Name', dataIndex: 'name', width: 220, sorter: true },
    {
      title: 'Owner',
      dataIndex: 'owner',
      width: 160,
      filters: ownerOptions,
      filterMultiple: false
    },
    { title: '描述', dataIndex: 'description', ellipsis: { showTitle: true } },
    {
      title: 'Forked From',
      dataIndex: 'forked_from',
      width: 160,
      render: (v) => v || '-'
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 170,
      sorter: true,
      render: (v) => (v ? timestamp2string(v) : '-')
    },
    {
      title: '操作',
      width: 270,
      render: (_, record) => (
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
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  const onTableChange = ({ filters: newFilters, sorter: newSorter }) => {
    if (newFilters) {
      const ownerF = newFilters.find((f) => f.dataIndex === 'owner');
      const v = ownerF?.filteredValue?.[0] || '';
      if (v !== ownerFilter) {
        setOwnerFilter(v);
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
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Table
          columns={columns}
          dataSource={items}
          rowKey='id'
          loading={loading}
          scroll={{ y: 'calc(100vh - 245px)' }}
          sticky={{ top: 0 }}
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
        kind='personal'
        mode={editor.mode}
        id={editor.id}
        onClose={() => setEditor({ ...editor, visible: false })}
        onSaved={() => load(keyword, page, pageSize, ownerFilter, sorter)}
      />
    </div>
  );
});

PersonalSkillsTable.displayName = 'PersonalSkillsTable';

export default PersonalSkillsTable;
