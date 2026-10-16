import { useEffect, useRef } from 'react';
import { Modal } from '@douyinfe/semi-ui';
import history from '../history';

// 站内跳转拦截:当 when 为 true 时，拦截 <Link> / navigate 触发的路由跳转，
// 弹窗让用户选择「保存修改」或「取消」。
//
// - onSave: 返回 Promise<boolean>，true 表示保存成功、允许跳转
// - onDiscard: 用户选择"取消"(放弃修改)时调用，用于恢复原始内容
//
// 实现说明:基于 history v5 的 block()。block 回调里调用 tx.retry() 会
// 重新发起被拦截的那次跳转;重试前必须先 unblock，否则会再次被拦截死循环。
export default function useNavigationBlocker({ when, onSave, onDiscard }) {
  // 用 ref 持有最新的回调与状态，避免频繁重建 block 订阅
  const whenRef = useRef(when);
  const onSaveRef = useRef(onSave);
  const onDiscardRef = useRef(onDiscard);
  const confirmingRef = useRef(false);
  useEffect(() => { whenRef.current = when; }, [when]);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { onDiscardRef.current = onDiscard; }, [onDiscard]);

  useEffect(() => {
    const unblock = history.block((tx) => {
      if (!whenRef.current) {
        unblock();
        tx.retry();
        return;
      }
      // 已有弹窗在处理中，忽略重复触发
      if (confirmingRef.current) return;
      confirmingRef.current = true;

      Modal.confirm({
        title: '有未保存的修改',
        content: '当前页面的修改尚未保存，是否保存后再离开？',
        okText: '保存并离开',
        cancelText: '放弃修改',
        onOk: async () => {
          const ok = await Promise.resolve(onSaveRef.current?.());
          confirmingRef.current = false;
          if (ok) {
            unblock();
            tx.retry();
          }
          // 保存失败:保持在当前页，校验错误已由 onSave 内部提示
        },
        onCancel: () => {
          confirmingRef.current = false;
          onDiscardRef.current?.();
          unblock();
          tx.retry();
        }
      });
    });
    return unblock;
  }, []);
}
