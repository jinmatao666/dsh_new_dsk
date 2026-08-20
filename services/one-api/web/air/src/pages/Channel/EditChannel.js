import React, {useEffect, useRef, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {API, isMobile, showError, showInfo, showSuccess, verifyJSON} from '../../helpers';
import {CHANNEL_OPTIONS} from '../../constants';
import Title from "@douyinfe/semi-ui/lib/es/typography/title";
import {SideSheet, Space, Spin, Button, Input, Typography, Select, TextArea, Checkbox, Banner, Tag} from "@douyinfe/semi-ui";

const MODEL_MAPPING_EXAMPLE = {
    'gpt-3.5-turbo-0301': 'gpt-3.5-turbo',
    'gpt-4-0314': 'gpt-4',
    'gpt-4-32k-0314': 'gpt-4-32k'
};

function type2secretPrompt(type) {
    // inputs.type === 15 ? '按照如下格式输入：APIKey|SecretKey' : (inputs.type === 18 ? '按照如下格式输入：APPID|APISecret|APIKey' : '请输入渠道对应的鉴权密钥')
    switch (type) {
        case 15:
            return '按照如下格式输入：APIKey|SecretKey';
        case 18:
            return '按照如下格式输入：APPID|APISecret|APIKey';
        case 22:
            return '按照如下格式输入：APIKey-AppId，例如：fastgpt-0sp2gtvfdgyi4k30jwlgwf1i-64f335d84283f05518e9e041';
        case 23:
            return '按照如下格式输入：AppId|SecretId|SecretKey';
        default:
            return '请输入渠道对应的鉴权密钥';
    }
}

const EditChannel = (props) => {
    const navigate = useNavigate();
    // 把明文密钥脱敏成「前3…后3」展示串。短于6位时只保留首尾各1位,避免还原出全部内容。
    const maskKey = (val) => {
        const s = (val || '').trim();
        if (s === '') return '';
        if (s.length <= 6) {
            return s.length <= 2 ? '*'.repeat(s.length) : s[0] + '*'.repeat(s.length - 2) + s[s.length - 1];
        }
        return s.slice(0, 3) + '****' + s.slice(-3);
    };
    const channelId = props.editingChannel.id;
    const isEdit = channelId !== undefined;
    const [loading, setLoading] = useState(isEdit);
    // 取消:丢弃本次未提交的所有改动,恢复到编辑前的内容。
    // 由于本组件常驻挂载(仅切换 visible),loadChannel 只在 editingChannel.id 变化时重跑,
    // 若不在此显式恢复,取消后再次打开同一渠道会残留上次未提交的草稿(自动获取的模型、改过的密钥等)。
    // 编辑态:重新从库里拉取覆盖;新建态:回到空白初始值。两种情况都清掉探查结果。
    const handleCancel = () => {
        setProbeResult(null);
        setKeyFocused(false);
        if (isEdit) {
            loadChannel();
        } else {
            setInputs(originInputs);
            setMappingRows([]);
            setKeyMasked('');
        }
        props.handleClose()
    };
    const originInputs = {
        name: '',
        type: 1,
        key: '',
        openai_organization: '',
        base_url: '',
        other: '',
        model_mapping: '',
        system_prompt: '',
        models: [],
        auto_ban: 1,
        groups: ['default']
    };
    const [batch, setBatch] = useState(false);
    const [autoBan, setAutoBan] = useState(true);
    // const [autoBan, setAutoBan] = useState(true);
    const [inputs, setInputs] = useState(originInputs);
    const [originModelOptions, setOriginModelOptions] = useState([]);
    const [modelOptions, setModelOptions] = useState([]);
    const [groupOptions, setGroupOptions] = useState([]);
    const [basicModels, setBasicModels] = useState([]);
    const [fullModels, setFullModels] = useState([]);
    const [customModel, setCustomModel] = useState('');
    const [fetchingModels, setFetchingModels] = useState(false);
    const [probingModels, setProbingModels] = useState(false);
    const [probeResult, setProbeResult] = useState(null); // {results:[{model,ok,error}], available:[], total, ok_count}
    const [keyMasked, setKeyMasked] = useState(''); // 已存密钥脱敏串(前后各3位),仅编辑态展示
    const [keyFocused, setKeyFocused] = useState(false); // 密钥输入框是否聚焦:聚焦显示明文,失焦/回车显示脱敏
    const [mappingRows, setMappingRows] = useState([]); // 模型映射行 [{backend, channel}]
    const handleInputChange = (name, value) => {
        setInputs((inputs) => ({...inputs, [name]: value}));
        if (name === 'type' && inputs.models.length === 0) {
            let localModels = [];
            switch (value) {
                case 14:
                    localModels = ["claude-instant-1.2", "claude-2", "claude-2.0", "claude-2.1", "claude-3-opus-20240229", "claude-3-sonnet-20240229", "claude-3-haiku-20240307", "claude-3-5-haiku-20241022", "claude-3-5-sonnet-20240620", "claude-3-5-sonnet-20241022"];
                    break;
                case 11:
                    localModels = ['PaLM-2'];
                    break;
                case 15:
                    localModels = ['ERNIE-Bot', 'ERNIE-Bot-turbo', 'ERNIE-Bot-4', 'Embedding-V1'];
                    break;
                case 17:
                    localModels = ["qwen-turbo", "qwen-plus", "qwen-max", "qwen-max-longcontext", 'text-embedding-v1'];
                    break;
                case 16:
                    localModels = ['chatglm_pro', 'chatglm_std', 'chatglm_lite'];
                    break;
                case 18:
                    localModels = ['SparkDesk', 'SparkDesk-v1.1', 'SparkDesk-v2.1', 'SparkDesk-v3.1', 'SparkDesk-v3.1-128K', 'SparkDesk-v3.5', 'SparkDesk-v3.5-32K', 'SparkDesk-v4.0'];
                    break;
                case 19:
                    localModels = ['360GPT_S2_V9', 'embedding-bert-512-v1', 'embedding_s1_v1', 'semantic_similarity_s1_v1'];
                    break;
                case 23:
                    localModels = ['hunyuan'];
                    break;
                case 24:
                    localModels = ['gemini-pro', 'gemini-pro-vision'];
                    break;
                case 25:
                    localModels = ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'];
                    break;
                case 26:
                    localModels = ['glm-4', 'glm-4v', 'glm-3-turbo'];
                    break;
                case 2:
                    localModels = ['mj_imagine', 'mj_variation', 'mj_reroll', 'mj_blend', 'mj_upscale', 'mj_describe'];
                    break;
                case 5:
                    localModels = [
                        'swap_face',
                        'mj_imagine',
                        'mj_variation',
                        'mj_reroll',
                        'mj_blend',
                        'mj_upscale',
                        'mj_describe',
                        'mj_zoom',
                        'mj_shorten',
                        'mj_modal',
                        'mj_inpaint',
                        'mj_custom_zoom',
                        'mj_high_variation',
                        'mj_low_variation',
                        'mj_pan',
                    ];
                    break;
            }
            setInputs((inputs) => ({...inputs, models: localModels}));
        }
        //setAutoBan
    };


    const loadChannel = async () => {
        setLoading(true)
        let res = await API.get(`/api/channel/${channelId}`);
        const {success, message, data, key_masked} = res.data;
        if (success) {
            setKeyMasked(key_masked || '');
            if (data.models === '') {
                data.models = [];
            } else {
                data.models = data.models.split(',');
            }
            if (data.group === '') {
                data.groups = [];
            } else {
                data.groups = data.group.split(',');
            }
            if (data.model_mapping !== '') {
                data.model_mapping = JSON.stringify(JSON.parse(data.model_mapping), null, 2);
            }
            // 初始化模型映射行式编辑数据(key=后台id, value=渠道id)
            try {
                const mp = data.model_mapping ? JSON.parse(data.model_mapping) : {};
                setMappingRows(Object.keys(mp).map((k) => ({ backend: k, channel: mp[k] })));
            } catch (e) {
                setMappingRows([]);
            }
            setInputs(data);
            if (data.auto_ban === 0) {
                setAutoBan(false);
            } else {
                setAutoBan(true);
            }
            // console.log(data);
        } else {
            showError(message);
        }
        setLoading(false);
    };

    const fetchModels = async () => {
        try {
            let res = await API.get(`/api/channel/models`);
            let localModelOptions = res.data.data.map((model) => ({
                label: model.id,
                value: model.id
            }));
            setOriginModelOptions(localModelOptions);
            setFullModels(res.data.data.map((model) => model.id));
            setBasicModels(res.data.data.filter((model) => {
                return model.id.startsWith('gpt-3') || model.id.startsWith('text-');
            }).map((model) => model.id));
        } catch (error) {
            showError(error.message);
        }
    };

    const fetchGroups = async () => {
        try {
            let res = await API.get(`/api/group/`);
            setGroupOptions(res.data.data.map((group) => ({
                label: group,
                value: group
            })));
        } catch (error) {
            showError(error.message);
        }
    };

    useEffect(() => {
        let localModelOptions = [...originModelOptions];
        inputs.models.forEach((model) => {
            if (!localModelOptions.find((option) => option.key === model)) {
                localModelOptions.push({
                    label: model,
                    value: model
                });
            }
        });
        setModelOptions(localModelOptions);
    }, [originModelOptions, inputs.models]);

    useEffect(() => {
        fetchModels().then();
        fetchGroups().then();
        if (isEdit) {
            loadChannel().then(
                () => {

                }
            );
        } else {
            setInputs(originInputs)
        }
    }, [props.editingChannel.id]);


    const submit = async () => {
        if (!isEdit && (inputs.name === '' || inputs.key === '')) {
            showInfo('请填写渠道名称和渠道密钥！');
            return;
        }
        // T3.1 渠道不再在此选择模型(迁往模型配置页),移除「至少选一个模型」校验。
        if (inputs.model_mapping !== '' && !verifyJSON(inputs.model_mapping)) {
            showInfo('模型映射必须是合法的 JSON 格式！');
            return;
        }
        let localInputs = {...inputs};
        if (localInputs.base_url && localInputs.base_url.endsWith('/')) {
            localInputs.base_url = localInputs.base_url.slice(0, localInputs.base_url.length - 1);
        }
        if (localInputs.type === 3 && localInputs.other === '') {
            localInputs.other = '2024-03-01-preview';
        }
        if (localInputs.type === 18 && localInputs.other === '') {
            localInputs.other = 'v2.1';
        }
        let res;
        if (!Array.isArray(localInputs.models)) {
            showError('提交失败，请勿重复提交！');
            handleCancel();
            return;
        }
        localInputs.auto_ban = autoBan ? 1 : 0;
        localInputs.models = localInputs.models.join(',');
        localInputs.group = localInputs.groups.join(',');
        if (isEdit) {
            res = await API.put(`/api/channel/`, {...localInputs, id: parseInt(channelId)});
        } else {
            res = await API.post(`/api/channel/`, localInputs);
        }
        const {success, message} = res.data;
        if (success) {
            if (isEdit) {
                showSuccess('渠道更新成功！');
            } else {
                showSuccess('渠道创建成功！');
                setInputs(originInputs);
            }
            props.refresh();
            props.handleClose();
        } else {
            showError(message);
        }
    };

    const addCustomModel = () => {
        if (customModel.trim() === '') return;
        if (inputs.models.includes(customModel)) return showError("该模型已存在！");
        let localModels = [...inputs.models];
        localModels.push(customModel);
        let localModelOptions = [];
        localModelOptions.push({
            key: customModel,
            text: customModel,
            value: customModel
        });
        setModelOptions(modelOptions => {
            return [...modelOptions, ...localModelOptions];
        });
        setCustomModel('');
        handleInputChange('models', localModels);
    };

    // 自动获取上游可用模型列表，无需先提交渠道即可生效：
    // - 表单里填了新密钥（inputs.key 非空）：走 POST /fetch_models，用当前表单的 type/key/base_url，
    //   这样改了密钥但还没提交也能立刻按新密钥拉取。
    // - 编辑态且未改密钥（密钥仅脱敏展示，inputs.key 为空）：走 GET /:id/fetch_models，用库里的 key/baseURL。
    // 拉回默认全部填入。
    const fetchUpstreamModels = async () => {
        setFetchingModels(true);
        try {
            let res;
            if (isEdit && channelId !== undefined && inputs.key === '') {
                res = await API.get(`/api/channel/${channelId}/fetch_models`);
            } else {
                res = await API.post('/api/channel/fetch_models', {
                    type: inputs.type,
                    key: inputs.key,
                    base_url: inputs.base_url,
                });
            }
            const { success, message, data } = res.data;
            if (!success) {
                showError(message || '获取模型列表失败');
                return;
            }
            if (!Array.isArray(data) || data.length === 0) {
                showError('上游未返回可用模型');
                return;
            }
            // 默认全部填入；modelOptions 由 inputs.models 的副作用自动补齐。
            handleInputChange('models', data);
            showSuccess(`已获取 ${data.length} 个模型并全部填入`);
        } catch (error) {
            showError('获取模型列表失败：' + (error.message || '请求异常'));
        } finally {
            setFetchingModels(false);
        }
    };

    // 逐模型连通性探查（手动触发）：对已填模型逐个跑真实测试请求，剔除调不通的。
    // /v1/models 返回平台全集、不按 key 过滤（百炼尤其明显），此功能帮用户筛出真正可用的。
    // 耗时且消耗 quota，故仅手动触发；只支持已保存渠道（需服务端用库里的 key 测试）。
    const probeModels = async () => {
        if (!isEdit || channelId === undefined) {
            showError('请先保存渠道后再验证模型可用性');
            return;
        }
        if (!Array.isArray(inputs.models) || inputs.models.length === 0) {
            showError('没有可验证的模型');
            return;
        }
        setProbingModels(true);
        setProbeResult(null);
        try {
            const res = await API.post(`/api/channel/${channelId}/probe_models`, {
                models: inputs.models,
            });
            const { success, message, data } = res.data;
            if (!success) {
                showError(message || '验证失败');
                return;
            }
            setProbeResult(data);
            showSuccess(`验证完成：${data.ok_count}/${data.total} 个可用`);
        } catch (error) {
            showError('验证失败：' + (error.message || '请求异常'));
        } finally {
            setProbingModels(false);
        }
    };

    // 只保留探查结果里可用的模型
    const keepAvailableModels = () => {
        if (!probeResult || !Array.isArray(probeResult.available)) return;
        handleInputChange('models', probeResult.available);
        setProbeResult(null);
        showSuccess(`已保留 ${probeResult.available.length} 个可用模型`);
    };

    // 模型映射(model_mapping)行式编辑：key=后台模型 id(app 请求名)，value=渠道模型 id(上游真实名)。
    // 底层仍存为 JSON 字符串 {后台id: 渠道id}，与后端路由方向一致(用后台id查渠道id)。
    // mappingRows 为编辑期的真相(允许空行)，每次变更同步回 inputs.model_mapping。
    const syncMappingRows = (rows) => {
        setMappingRows(rows);
        const obj = {};
        rows.forEach((r) => {
            const b = (r.backend || '').trim();
            if (b !== '') obj[b] = (r.channel || '').trim();
        });
        handleInputChange('model_mapping', Object.keys(obj).length === 0 ? '' : JSON.stringify(obj));
    };
    const updateMappingRow = (idx, field, value) => {
        const rows = mappingRows.map((r, i) => (i === idx ? { ...r, [field]: value } : r));
        syncMappingRows(rows);
    };
    const addMappingRow = () => {
        setMappingRows([...mappingRows, { backend: '', channel: '' }]);
    };
    const removeMappingRow = (idx) => {
        syncMappingRows(mappingRows.filter((_, i) => i !== idx));
    };

    return (
        <>
            <SideSheet
                maskClosable={false}
                placement={isEdit ? 'right' : 'left'}
                title={<Title level={3}>{isEdit ? '更新渠道信息' : '创建新的渠道'}</Title>}
                headerStyle={{borderBottom: '1px solid var(--semi-color-border)'}}
                bodyStyle={{borderBottom: '1px solid var(--semi-color-border)'}}
                visible={props.visible}
                footer={
                    <div style={{display: 'flex', justifyContent: 'flex-end'}}>
                        <Space>
                            <Button theme='solid' size={'large'} onClick={submit}>提交</Button>
                            <Button theme='solid' size={'large'} type={'tertiary'} onClick={handleCancel}>取消</Button>
                        </Space>
                    </div>
                }
                closeIcon={null}
                onCancel={() => handleCancel()}
                width={isMobile() ? '100%' : 600}
            >
                <Spin spinning={loading}>
                    <div style={{ marginTop: 10 }}>
                        <Typography.Text strong>类型：</Typography.Text>
                    </div>
                    <Select
                      name='type'
                      required
                      optionList={CHANNEL_OPTIONS}
                      value={inputs.type}
                      onChange={value => handleInputChange('type', value)}
                      style={{ width: '50%' }}
                    />
                    {
                      inputs.type === 3 && (
                        <>
                            <div style={{ marginTop: 10 }}>
                                <Banner type={"warning"} description={
                                    <>
                                        注意，<strong>模型部署名称必须和模型名称保持一致</strong>，因为 One API 会把请求体中的
                                        model
                                        参数替换为你的部署名称（模型名称中的点会被剔除），<a target='_blank'
                                                                                          href='https://github.com/songquanpeng/one-api/issues/133?notification_referrer_id=NT_kwDOAmJSYrM2NjIwMzI3NDgyOjM5OTk4MDUw#issuecomment-1571602271'>图片演示</a>。
                                    </>
                                }>
                                </Banner>
                            </div>
                            <div style={{ marginTop: 10 }}>
                                <Typography.Text strong>AZURE_OPENAI_ENDPOINT：</Typography.Text>
                            </div>
                            <Input
                              label='AZURE_OPENAI_ENDPOINT'
                              name='azure_base_url'
                              placeholder={'请输入 AZURE_OPENAI_ENDPOINT，例如：https://docs-test-001.openai.azure.com'}
                              onChange={value => {
                                  handleInputChange('base_url', value)
                              }}
                              value={inputs.base_url}
                              autoComplete='new-password'
                            />
                            <div style={{ marginTop: 10 }}>
                                <Typography.Text strong>默认 API 版本：</Typography.Text>
                            </div>
                            <Input
                              label='默认 API 版本'
                              name='azure_other'
                              placeholder={'请输入默认 API 版本，例如：2024-03-01-preview，该配置可以被实际的请求查询参数所覆盖'}
                              onChange={value => {
                                  handleInputChange('other', value)
                              }}
                              value={inputs.other}
                              autoComplete='new-password'
                            />
                        </>
                      )
                    }
                    {
                      inputs.type === 8 && (
                        <>
                            <div style={{ marginTop: 10 }}>
                                <Typography.Text strong>Base URL：</Typography.Text>
                            </div>
                            <Input
                              name='base_url'
                              placeholder={'请输入自定义渠道的 Base URL'}
                              onChange={value => {
                                  handleInputChange('base_url', value)
                              }}
                              value={inputs.base_url}
                              autoComplete='new-password'
                            />
                        </>
                      )
                    }
                    <div style={{ marginTop: 10 }}>
                        <Typography.Text strong>名称：</Typography.Text>
                    </div>
                    <Input
                      required
                      name='name'
                      placeholder={'请为渠道命名'}
                      onChange={value => {
                          handleInputChange('name', value)
                      }}
                      value={inputs.name}
                      autoComplete='new-password'
                    />
                    {/* T3.1 暂不需要:分组(默认 default)。注释隐藏,保留字段。 */}
                    {false && (
                    <>
                    <div style={{ marginTop: 10 }}>
                        <Typography.Text strong>分组：</Typography.Text>
                    </div>
                    <Select
                      placeholder={'请选择可以使用该渠道的分组'}
                      name='groups'
                      multiple
                      selection
                      allowAdditions
                      additionLabel={'请在系统设置页面编辑分组倍率以添加新的分组：'}
                      onChange={value => {
                          handleInputChange('groups', value)
                      }}
                      value={inputs.groups}
                      autoComplete='new-password'
                      optionList={groupOptions}
                    />
                    </>
                    )}
                    {
                      inputs.type === 18 && (
                        <>
                            <div style={{ marginTop: 10 }}>
                                <Typography.Text strong>模型版本：</Typography.Text>
                            </div>
                            <Input
                              name='other'
                              placeholder={'请输入星火大模型版本，注意是接口地址中的版本号，例如：v2.1'}
                              onChange={value => {
                                  handleInputChange('other', value)
                              }}
                              value={inputs.other}
                              autoComplete='new-password'
                            />
                        </>
                      )
                    }
                    {
                      inputs.type === 21 && (
                        <>
                            <div style={{ marginTop: 10 }}>
                                <Typography.Text strong>知识库 ID：</Typography.Text>
                            </div>
                            <Input
                              label='知识库 ID'
                              name='other'
                              placeholder={'请输入知识库 ID，例如：123456'}
                              onChange={value => {
                                  handleInputChange('other', value)
                              }}
                              value={inputs.other}
                              autoComplete='new-password'
                            />
                        </>
                      )
                    }
                    {/* T3.1 渠道页不再编辑「支持的模型」与「模型重定向」,迁往模型配置页。
                        保留代码与字段(兼容历史数据/回滚),用 false 暂时隐藏。 */}
                    {false && (
                    <>
                    <div style={{ marginTop: 10 }}>
                        <Typography.Text strong>模型：</Typography.Text>
                    </div>
                    <Select
                      placeholder={'请选择该渠道所支持的模型'}
                      name='models'
                      multiple
                      selection
                      onChange={value => {
                          handleInputChange('models', value)
                      }}
                      value={inputs.models}
                      autoComplete='new-password'
                      optionList={modelOptions}
                    />
                    <div style={{ lineHeight: '40px', marginBottom: '12px' }}>
                        <Space>
                            <Button type='primary' onClick={() => {
                                handleInputChange('models', basicModels);
                            }}>填入基础模型</Button>
                            <Button type='secondary' onClick={() => {
                                handleInputChange('models', fullModels);
                            }}>填入所有模型</Button>
                            <Button type='warning' onClick={() => {
                                handleInputChange('models', []);
                            }}>清除所有模型</Button>
                        </Space>
                        <Input
                          addonAfter={
                              <Button type='primary' onClick={addCustomModel}>填入</Button>
                          }
                          placeholder='输入自定义模型名称'
                          value={customModel}
                          onChange={(value) => {
                              setCustomModel(value.trim());
                          }}
                        />
                    </div>
                    <div style={{ marginTop: 10 }}>
                        <Typography.Text strong>模型重定向：</Typography.Text>
                    </div>
                    <TextArea
                      placeholder={`此项可选，用于修改请求体中的模型名称，为一个 JSON 字符串，键为请求中模型名称，值为要替换的模型名称，例如：\n${JSON.stringify(MODEL_MAPPING_EXAMPLE, null, 2)}`}
                      name='model_mapping'
                      onChange={value => {
                          handleInputChange('model_mapping', value)
                      }}
                      autosize
                      value={inputs.model_mapping}
                      autoComplete='new-password'
                    />
                    <Typography.Text style={{
                        color: 'rgba(var(--semi-blue-5), 1)',
                        userSelect: 'none',
                        cursor: 'pointer'
                    }} onClick={
                        () => {
                            handleInputChange('model_mapping', JSON.stringify(MODEL_MAPPING_EXAMPLE, null, 2))
                        }
                    }>
                        填入模板
                    </Typography.Text>
                    </>
                    )}
                    {/* 渠道可提供的模型：自动从上游 /v1/models 获取，默认全部填入。
                        此处维护「这条渠道能提供什么」(channel.models)；对外开放哪些由模型配置页选择添加。 */}
                    <div style={{ marginTop: 10 }}>
                        <Typography.Text strong>模型：</Typography.Text>
                    </div>
                    <Select
                      placeholder={'点击下方「自动获取模型」从上游拉取，或手动填写'}
                      name='models'
                      multiple
                      selection
                      onChange={value => {
                          handleInputChange('models', value)
                      }}
                      value={inputs.models}
                      autoComplete='new-password'
                      optionList={modelOptions}
                    />
                    <div style={{ lineHeight: '40px', marginBottom: '12px' }}>
                        <Space>
                            <Button
                              type='primary'
                              loading={fetchingModels}
                              onClick={fetchUpstreamModels}
                            >自动获取模型</Button>
                            <Button
                              type='secondary'
                              loading={probingModels}
                              disabled={!isEdit}
                              onClick={probeModels}
                            >逐个验证可用性</Button>
                            <Button type='warning' onClick={() => {
                                handleInputChange('models', []);
                                setProbeResult(null);
                            }}>清除所有模型</Button>
                        </Space>
                        <div style={{ marginTop: 8 }}>
                            <Input
                              addonAfter={
                                  <Button type='primary' onClick={addCustomModel}>填入</Button>
                              }
                              placeholder='输入自定义模型名称'
                              value={customModel}
                              onChange={(value) => {
                                  setCustomModel(value.trim());
                              }}
                            />
                        </div>
                        <Typography.Text type='tertiary' style={{ fontSize: 12 }}>
                            仅 OpenAI 兼容类型支持自动获取；拉回后默认全部填入，可手动增删。对外开放哪些模型，请在「模型配置」中选择添加。
                        </Typography.Text>
                        <Typography.Text type='tertiary' style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
                            「逐个验证可用性」会对每个模型发一次真实测试请求（耗时、消耗少量额度），用于筛掉密钥实际调不通的模型；需先保存渠道。
                        </Typography.Text>
                        {probeResult && (
                            <div style={{
                                marginTop: 10,
                                padding: '10px 12px',
                                border: '1px solid var(--semi-color-border)',
                                borderRadius: 8,
                                background: 'var(--semi-color-fill-0)',
                            }}>
                                <Space>
                                    <Typography.Text strong>
                                        验证结果：{probeResult.ok_count}/{probeResult.total} 可用
                                    </Typography.Text>
                                    {probeResult.ok_count < probeResult.total && (
                                        <Button size='small' type='primary' onClick={keepAvailableModels}>
                                            只保留可用的 {probeResult.ok_count} 个
                                        </Button>
                                    )}
                                </Space>
                                {Array.isArray(probeResult.results) &&
                                  probeResult.results.some((r) => !r.ok) && (
                                    <div style={{ marginTop: 8 }}>
                                        <Typography.Text type='tertiary' style={{ fontSize: 12 }}>
                                            不可用模型：
                                        </Typography.Text>
                                        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                            {probeResult.results.filter((r) => !r.ok).map((r) => (
                                                <Tag key={r.model} color='red' type='light'>{r.model}</Tag>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    {/* 模型映射：同一个后台模型在不同渠道上游名称不同时，把「后台模型 id」翻译成
                        「该渠道的模型 id」。后端按 后台id→渠道id 方向路由(key=后台id, value=渠道id)。 */}
                    <div style={{ marginTop: 10 }}>
                        <Typography.Text strong>模型映射：</Typography.Text>
                    </div>
                    <Typography.Text type='tertiary' style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                        当某模型在本渠道上游的名称与后台模型 id 不一致时填写。app 用后台 id 请求，系统转成渠道 id 发往上游。
                    </Typography.Text>
                    {mappingRows.map((row, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                            <Input
                              style={{ flex: 1 }}
                              placeholder='后台模型 id（模型配置里填的）'
                              value={row.backend}
                              onChange={(v) => updateMappingRow(idx, 'backend', v)}
                            />
                            <Typography.Text type='tertiary'>→</Typography.Text>
                            <Input
                              style={{ flex: 1 }}
                              placeholder='渠道模型 id（上游真实名称）'
                              value={row.channel}
                              onChange={(v) => updateMappingRow(idx, 'channel', v)}
                            />
                            <Button type='danger' theme='borderless' onClick={() => removeMappingRow(idx)}>删除</Button>
                        </div>
                    ))}
                    <Button type='primary' theme='light' onClick={addMappingRow} style={{ marginTop: 2 }}>
                        添加
                    </Button>
                    {/* T3.1 暂不需要:系统提示词。注释隐藏,保留字段。 */}
                    {false && (
                    <>
                    <div style={{ marginTop: 10 }}>
                        <Typography.Text strong>系统提示词：</Typography.Text>
                    </div>
                    <TextArea
                      placeholder={`此项可选，用于强制设置给定的系统提示词，请配合自定义模型 & 模型重定向使用，首先创建一个唯一的自定义模型名称并在上面填入，之后将该自定义模型重定向映射到该渠道一个原生支持的模型`}
                      name='system_prompt'
                      onChange={value => {
                          handleInputChange('system_prompt', value)
                      }}
                      autosize
                      value={inputs.system_prompt}
                      autoComplete='new-password'
                    />
                    </>
                    )}
                    <div style={{ marginTop: 10 }}>
                        <Typography.Text strong>密钥：</Typography.Text>
                    </div>
                    {isEdit && keyMasked && (
                        <Typography.Text type='tertiary' style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                            当前密钥：<Typography.Text code>{keyMasked}</Typography.Text>
                            　留空则不修改，需更换时直接输入新密钥。输入新密钥后点「自动获取模型」即按新密钥拉取，无需先保存。
                        </Typography.Text>
                    )}
                    {
                        batch ?
                          <TextArea
                            label='密钥'
                            name='key'
                            required
                            placeholder={'请输入密钥，一行一个'}
                            onChange={value => {
                                handleInputChange('key', value)
                            }}
                            value={inputs.key}
                            style={{ minHeight: 150, fontFamily: 'JetBrains Mono, Consolas' }}
                            autoComplete='new-password'
                          />
                          :
                          <Input
                            label='密钥'
                            name='key'
                            required
                            placeholder={type2secretPrompt(inputs.type)}
                            onChange={value => {
                                handleInputChange('key', value)
                            }}
                            // 失焦/回车后显示脱敏串(前3…后3),聚焦时还原明文以便继续编辑。
                            // value 始终是 inputs.key 真值,提交不受影响。
                            value={keyFocused ? inputs.key : (inputs.key === '' ? '' : maskKey(inputs.key))}
                            onFocus={() => setKeyFocused(true)}
                            onBlur={() => setKeyFocused(false)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    setKeyFocused(false);
                                    e.target.blur();
                                }
                            }}
                            autoComplete='new-password'
                          />
                    }
                    {/* T3.1 暂不需要:组织、是否自动禁用。注释隐藏,保留字段。 */}
                    {false && (
                    <>
                    <div style={{ marginTop: 10 }}>
                        <Typography.Text strong>组织：</Typography.Text>
                    </div>
                    <Input
                      label='组织，可选，不填则为默认组织'
                      name='openai_organization'
                      placeholder='请输入组织org-xxx'
                      onChange={value => {
                          handleInputChange('openai_organization', value)
                      }}
                      value={inputs.openai_organization}
                    />
                    <div style={{ marginTop: 10, display: 'flex' }}>
                        <Space>
                            <Checkbox
                              name='auto_ban'
                              checked={autoBan}
                              onChange={
                                  () => {
                                      setAutoBan(!autoBan);
                                  }
                              }
                              // onChange={handleInputChange}
                            />
                            <Typography.Text
                              strong>是否自动禁用（仅当自动禁用开启时有效），关闭后不会自动禁用该渠道：</Typography.Text>
                        </Space>
                    </div>
                    </>
                    )}

                    {
                      !isEdit && (
                        <div style={{ marginTop: 10, display: 'flex' }}>
                            <Space>
                                <Checkbox
                                  checked={batch}
                                  label='批量创建'
                                  name='batch'
                                  onChange={() => setBatch(!batch)}
                                />
                                <Typography.Text strong>批量创建</Typography.Text>
                            </Space>
                        </div>
                      )
                    }
                    {
                      inputs.type !== 3 && inputs.type !== 8 && inputs.type !== 22 && (
                        <>
                            <div style={{ marginTop: 10 }}>
                                <Typography.Text strong>代理：</Typography.Text>
                            </div>
                            <Input
                              label='代理'
                              name='base_url'
                              placeholder={'此项可选，用于通过代理站来进行 API 调用'}
                              onChange={value => {
                                  handleInputChange('base_url', value)
                              }}
                              value={inputs.base_url}
                              autoComplete='new-password'
                            />
                        </>
                      )
                    }
                    {
                      inputs.type === 22 && (
                        <>
                            <div style={{ marginTop: 10 }}>
                                <Typography.Text strong>私有部署地址：</Typography.Text>
                            </div>
                            <Input
                              name='base_url'
                              placeholder={'请输入私有部署地址，格式为：https://fastgpt.run/api/openapi'}
                              onChange={value => {
                                  handleInputChange('base_url', value)
                              }}
                              value={inputs.base_url}
                              autoComplete='new-password'
                            />
                        </>
                      )
                    }

                </Spin>
            </SideSheet>
        </>
    );
};

export default EditChannel;
