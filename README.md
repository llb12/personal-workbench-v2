# 个人工作台 (Personal Workbench) v2

本地优先的 Electron 桌面工作台，集成待办、日程、看板、便签与桌面通知。

## 功能
- 待办清单（优先级 / 延期 / 逾期提醒）
- 月度日程（工资发放日、个税扣缴申报截止、社保公积金缴纳等「薪酬节点」一键导入）
- 看板（Todo / Doing / Done）
- 便签 & 主题切换
- 启动桌面通知（逾期任务、今日日程）

## 运行
```bash
npm install electron --save-dev   # 需先安装 Electron
npm start
```
> 启动脚本 `启动工作台-优化版.bat` 默认调用同级 `personal-workbench\node_modules\electron` 下的 `electron.exe`，可按本地环境调整路径。

## 数据存储
用户数据保存在 `%APPDATA%/personal-workbench-optimized/data.json`，不随仓库分发。
