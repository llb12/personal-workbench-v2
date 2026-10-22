# 独立离线试用

使用交付目录中的 `Start-Isolated-Pilot.cmd`。启动器检查程序 SHA-256、受保护目录权限与专用 profile 标记，再启动 Portable。不要直接双击安装包替换正式程序。

试用包采用独立应用标识 `com.personal.workbench.isolated.pilot`，必须显式指定已登记的隔离用户目录；缺少标记时拒绝启动。所有工作内容保存在隔离副本。正式 `%APPDATA%\personal-workbench-optimized` 路径由试用主进程拦截；联网、地理定位、外部窗口与包含业务内容的系统通知关闭。AI 配置及密钥没有复制，试用包不启用在线 AI；源码的离线 AI 验收使用虚构数据与本机模拟服务。

这属于应用级隔离和文件权限保护，不是 Windows 虚拟机。NSIS 只生成测试文件；没有可信独立 Windows 环境时，安装、卸载均标记 NOT_RUN。

关闭试用程序即可回到原工作台，原程序及正式数据没有替换。恢复演练只针对独立副本：关闭对应试用实例，在新的受保护 profile 中从带哈希的备份恢复 `data.json`，创建准确的 profile 标记，再指定该 profile 启动。不得覆盖正式数据或正在运行的 profile。

构建：`pwsh -NoProfile -File scripts/build-pilot.ps1`。此配置只打包白名单程序文件，禁用发布、签名身份发现、桌面/开始菜单快捷方式与构建后自动启动。打包后的版本为 `1.0.4-pilot.1`。
