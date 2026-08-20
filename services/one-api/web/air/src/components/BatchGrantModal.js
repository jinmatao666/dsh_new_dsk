import React, { useState, useEffect } from 'react';
import { Modal, Radio, RadioGroup, InputNumber, Select, Typography, TextArea } from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../helpers';

const { Text } = Typography;

const getQuotaPerUnit = () => {
  const v = parseFloat(localStorage.getItem('quota_per_unit'));
  return isNaN(v) || v <= 0 ? 500 : v;
};
const pointsToQuota = (points) => Math.round((Number(points) || 0) * getQuotaPerUnit());

const BatchGrantModal = ({ visible, onCancel, onSuccess, rules, totalUsers }) => {
  const [grantType, setGrantType] = useState('quota');
  const [benefitSubtype, setBenefitSubtype] = useState('points');
  const [couponSubtype, setCouponSubtype] = useState('discount');
  const [quotaPoints, setQuotaPoints] = useState(0);
  const [memberDays, setMemberDays] = useState(30);
  const [identityId, setIdentityId] = useState(null);
  const [couponValue, setCouponValue] = useState(0);
  const [expiresInDays, setExpiresInDays] = useState(0);
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [identities, setIdentities] = useState([]);

  useEffect(() => {
    if (visible) {
      API.get('/api/member-identity/').then(res => {
        if (res.data.success) setIdentities(res.data.data || []);
      }).catch(() => {});
    }
  }, [visible]);

  const reset = () => {
    setGrantType('quota');
    setBenefitSubtype('points');
    setCouponSubtype('discount');
    setQuotaPoints(0);
    setMemberDays(30);
    setIdentityId(null);
    setCouponValue(0);
    setExpiresInDays(0);
    setRemark('');
  };

  const handleCancel = () => {
    reset();
    onCancel();
  };

  const handleOk = async () => {
    if (grantType === 'quota' && benefitSubtype === 'points' && (!quotaPoints || quotaPoints <= 0)) {
      showError('请输入积分数');
      return;
    }
    if (grantType === 'quota' && benefitSubtype === 'membership') {
      if (!identityId) { showError('请选择会员身份'); return; }
      if (!memberDays || memberDays <= 0) { showError('请输入会员时长天数'); return; }
    }
    if (grantType === 'coupon' && (!couponValue || couponValue <= 0)) {
      showError('请输入优惠券数值');
      return;
    }
    if (grantType === 'coupon' && couponSubtype === 'discount' && couponValue > 1) {
      showError('折扣系数不能超过 1');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        rules,
        remark,
        expires_in_days: expiresInDays || 0,
      };
      if (grantType === 'quota' && benefitSubtype === 'points') {
        payload.grant_type = 'quota';
        payload.quota_amount = pointsToQuota(quotaPoints);
      } else if (grantType === 'quota' && benefitSubtype === 'membership') {
        payload.grant_type = 'membership';
        payload.membership_days = memberDays;
        payload.identity_id = identityId;
      } else {
        payload.grant_type = 'coupon';
        payload.coupon_subtype = couponSubtype;
        payload.coupon_value = couponValue;
      }

      const res = await API.post('/api/user-crowd/batch-grant', payload);
      if (res.data.success) {
        showSuccess(`批量发放成功，共发放 ${res.data.data?.matched ?? totalUsers} 人`);
        reset();
        onSuccess?.();
      } else {
        showError(res.data.message || '发放失败');
      }
    } catch (e) {
      showError(e.message || '发放失败');
    } finally {
      setLoading(false);
    }
  };

  const labelStyle = { fontWeight: 500, fontSize: 13, marginBottom: 6, display: 'block' };
  const rowStyle = { marginBottom: 16 };

  return (
    <Modal
      title="批量发放"
      visible={visible}
      onCancel={handleCancel}
      onOk={handleOk}
      confirmLoading={loading}
      okText="确认发放"
      cancelText="取消"
      width={480}
    >
      <div style={{ paddingTop: 4 }}>
        {/* 发放类型 */}
        <div style={rowStyle}>
          <label style={labelStyle}>发放类型</label>
          <RadioGroup
            value={grantType}
            onChange={(e) => setGrantType(e.target.value)}
            type="button"
          >
            <Radio value="quota">权益发放</Radio>
            <Radio value="coupon">优惠券</Radio>
          </RadioGroup>
        </div>

        {/* 权益发放：积分 / 会员时长 */}
        {grantType === 'quota' && (
          <>
            <div style={rowStyle}>
              <label style={labelStyle}>权益类型</label>
              <RadioGroup
                value={benefitSubtype}
                onChange={(e) => setBenefitSubtype(e.target.value)}
                type="button"
              >
                <Radio value="points">积分</Radio>
                <Radio value="membership">会员时长</Radio>
              </RadioGroup>
            </div>

            {benefitSubtype === 'points' ? (
              <div style={rowStyle}>
                <label style={labelStyle}>积分数</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <InputNumber
                    value={quotaPoints}
                    onChange={setQuotaPoints}
                    min={1}
                    style={{ width: 200 }}
                    placeholder="输入积分数"
                  />
                  <Text type="tertiary">分</Text>
                </div>
              </div>
            ) : (
              <>
                <div style={rowStyle}>
                  <label style={labelStyle}>会员身份</label>
                  <Select
                    value={identityId}
                    onChange={setIdentityId}
                    style={{ width: 240 }}
                    placeholder="请选择会员身份"
                    optionList={identities.filter(i => i.enabled).map(i => ({ value: i.id, label: i.name }))}
                  />
                </div>
                <div style={rowStyle}>
                  <label style={labelStyle}>会员时长（天）</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <InputNumber
                      value={memberDays}
                      onChange={setMemberDays}
                      min={1}
                      style={{ width: 200 }}
                      placeholder="输入天数"
                    />
                    <Text type="tertiary">天</Text>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* 优惠券 */}
        {grantType === 'coupon' && (
          <>
            <div style={rowStyle}>
              <label style={labelStyle}>优惠券类型</label>
              <RadioGroup
                value={couponSubtype}
                onChange={(e) => { setCouponSubtype(e.target.value); setCouponValue(0); }}
                type="button"
              >
                <Radio value="discount">折扣</Radio>
                <Radio value="deduction">抵扣</Radio>
              </RadioGroup>
            </div>
            <div style={rowStyle}>
              <label style={labelStyle}>
                {couponSubtype === 'discount' ? '折扣系数（0-1）' : '抵扣金额（元）'}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <InputNumber
                  value={couponValue}
                  onChange={setCouponValue}
                  min={0}
                  max={couponSubtype === 'discount' ? 1 : undefined}
                  step={couponSubtype === 'discount' ? 0.01 : 1}
                  precision={couponSubtype === 'discount' ? 2 : 2}
                  style={{ width: 200 }}
                  placeholder={couponSubtype === 'discount' ? '如 0.8 表示八折' : '输入金额'}
                />
                <Text type="tertiary">{couponSubtype === 'discount' ? '' : '元'}</Text>
              </div>
            </div>
          </>
        )}

        {/* 公共：有效期（仅积分和优惠券） */}
        {(grantType === 'quota' && benefitSubtype === 'points') || grantType === 'coupon' ? (
          <div style={rowStyle}>
            <label style={labelStyle}>有效期（天，0 表示永久）</label>
            <InputNumber
              value={expiresInDays}
              onChange={setExpiresInDays}
              min={0}
              style={{ width: 200 }}
              placeholder="0 表示永久"
            />
          </div>
        ) : null}

        {/* 备注 */}
        <div style={rowStyle}>
          <label style={labelStyle}>备注（可选）</label>
          <TextArea
            placeholder="备注信息"
            value={remark}
            onChange={(v) => setRemark(v)}
            rows={2}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ padding: '8px 12px', background: 'var(--semi-color-fill-0)', borderRadius: 6, border: '1px solid var(--semi-color-border)' }}>
          <Text type="tertiary" style={{ fontSize: 13 }}>
            将发放给 <Text strong>{totalUsers}</Text> 名命中用户
          </Text>
        </div>
      </div>
    </Modal>
  );
};

export default BatchGrantModal;
