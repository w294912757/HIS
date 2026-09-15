# 诊所病历系统

Windows 单机病历管理系统，使用 Vue 3、TypeScript、Element Plus、Electron 和 SQLite。

## 运行方式

安装依赖：

```powershell
npm install --registry=https://registry.npmjs.org --electron_mirror=https://npmmirror.com/mirrors/electron/
```

浏览器开发模式：

```powershell
npm run dev
```

打开 `http://127.0.0.1:5173`。Vite 进程同时提供仅绑定本机的开发 API，页面通过该 API 使用真实 SQLite。

Electron 开发模式：

```powershell
npm run dev:desktop
```

两种模式默认共用：

```text
%LOCALAPPDATA%\ClinicRecords\data\clinic-records.db
```

不要同时运行浏览器开发服务和 Electron 开发模式执行写操作，尤其不要同时导入或恢复备份。

## 测试

```powershell
npm test
npm run test:e2e
npm run test:e2e:desktop
npm run test:performance
```

- `npm test`：数据校验、SQLite、迁移、历史快照和备份测试。
- `npm run test:e2e`：默认使用无头 Chromium，覆盖主要业务流程和多分辨率布局。
- `npm run test:e2e:desktop`：Electron IPC 和浏览器/Electron 同库验证。
- `npm run test:performance`：生成 10 万条临时病历并验证查询 P95。

测试使用独立临时数据库，不会修改正式数据。

## 构建

```powershell
npm run build
npm run package:portable
```

项目已为 electron-builder 配置 Electron 国内镜像，执行 portable 打包时无需额外设置环境变量。

便携版生成到：

```text
dist\clinic-records-0.1.0-x64.exe
```

## 数据安全

- 数据默认不联网、不上传。
- SQLite 使用 WAL 和版本化迁移。
- 导入、删除和恢复前自动备份。
- 自动备份保留最近 20 份。
- 恢复前执行数据库完整性与业务表检查。
- 新增、编辑、删除和导入均记录操作快照；界面不提供撤销、重做按钮或快捷键。

完整设计和验收依据见 [病历系统开发测试验证文档.md](./病历系统开发测试验证文档.md)。
