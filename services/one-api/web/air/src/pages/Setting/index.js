import React from 'react';
import SystemSetting from '../../components/SystemSetting';
import {isRoot} from '../../helpers';
import PersonalSetting from '../../components/PersonalSetting';
import LogCleanupSetting from '../../components/LogCleanupSetting';
import { ConfigPageTabPane, ConfigPageTabs } from '../../components/ConfigPageLayout';

const Setting = () => {
    let panes = [
        {
            tab: '个人设置',
            content: <PersonalSetting/>,
            itemKey: '1'
        }
    ];

    if (isRoot()) {
        panes.push({
            tab: '系统设置',
            content: <SystemSetting/>,
            itemKey: '2'
        });
        panes.push({
            tab: '日志清理',
            content: <LogCleanupSetting/>,
            itemKey: '3'
        });
    }

    return (
        <ConfigPageTabs defaultActiveKey="1">
            {panes.map(pane => (
                <ConfigPageTabPane itemKey={pane.itemKey} tab={pane.tab} key={pane.itemKey}>
                    {pane.content}
                </ConfigPageTabPane>
            ))}
        </ConfigPageTabs>
    );
};

export default Setting;
