# 右键菜单管理器

一个使用 Electron 开发的 Windows 右键菜单管理工具，用来查看、搜索和删除不想要的右键菜单项。界面采用类似 VS Code 的深色布局。

## 使用

1. 运行 `npm start`（开发模式），或双击 `dist` 目录中构建好的可执行文件。
2. 左侧选择右键位置，例如“桌面空白处”“文件夹”“图片（常见格式）”“所有对象（*）”，也可以输入扩展名（如 `.zip`）后点右侧箭头。
3. 顶部可以搜索菜单名称，并切换“仅显示可见项”。
4. 勾选要删除的项目，点“删除选中”。删除前会自动把对应注册表项导出到程序目录下的 `backups` 文件夹。
5. 左侧活动栏的“备份”页面可以查看、恢复备份或打开备份目录。

## 开发与构建

需要 Node.js 和 npm。

```powershell
npm install
npm start
```

打包为 Windows 可执行文件：

```powershell
.\build.ps1
```

构建产物输出到 `dist` 目录。打包配置中已设置 `requireAdministrator`，启动时会请求管理员权限。

## 功能

- 扫描经典注册表右键菜单：`shell` 命令项和 `shellex\ContextMenuHandlers` 扩展项。
- 识别 Windows 11 新版菜单中的应用包扩展（例如 QQ 发送、图片转换、WinRAR、OneDrive 等）。
- 支持桌面空白处、文件夹背景、文件夹、驱动器、库、所有对象，以及常见图片、文档、压缩包扩展名。
- 同时读取当前用户和所有用户的注册表位置。
- 相同菜单在多个位置注册时自动合并显示，删除时一起处理。
- 每次删除前自动备份，备份文件可以随时恢复。
- 切换右键位置或刷新时，列表区域会显示加载动画。

## 文件结构

```text
main.js                 Electron 主进程入口
preload.js              渲染进程安全桥接
src/main/scanner.js     注册表扫描、解析、去重逻辑
src/main/friendly.js    CLSID、默认命令和应用包菜单的友好名称映射
src/main/backups.js     删除、备份、恢复逻辑
src/main/powershell.js  PowerShell 辅助进程封装
src/win/helpers.ps1     注册表读取和 Windows API 辅助脚本
src/App.ico             应用图标
renderer/               界面（HTML / CSS / JS）
scripts/                图标生成、测试脚本
build.ps1               Windows 打包脚本
```

## 注意

- 删除操作只移除生成菜单项的注册表项，不会卸载应用或删除程序文件。
- 删除注册表菜单项需要管理员权限，因此打包后的程序启动时会弹出 UAC 提示。
- 系统菜单项在列表中标为“系统”，删除后可能影响 Windows 功能，请谨慎操作。
- 标为“应用扩展”的菜单由应用包提供，无法用本工具直接删除，请在对应应用内关闭或卸载应用包。
- 应用包扩展的二级子菜单由程序动态生成，不支持单独删除。
