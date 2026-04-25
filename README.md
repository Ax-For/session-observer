# Session Observer

本地优先的 Codex / Claude Code 会话观测工作台。应用读取本机日志，不上传数据，用于查看事件流、会话对话、Token 消耗、会话标题和批量管理。

- Codex: `~/.codex/sessions/**/*.jsonl`
- Claude Code: `~/.claude/projects/**/*.jsonl`

## 技术栈

- 后端: Node.js `http` server，入口为 `server.js`
- 前端: React 19 + Vite + Mantine，入口为 `src/main.jsx`
- 共享解析: `shared/observer-core.js` 和 `shared/observer-data.js`
- 测试: Vitest + Node `node:test`

## 环境要求

- Node.js: 建议使用当前 LTS 或更新版本
- npm
- `sqlite3` CLI: Codex 会话标题读取依赖
- 现代浏览器

## 快速开始

```bash
npm install
./manage.sh start
./manage.sh open
```

默认地址是 `http://127.0.0.1:8787`。

`manage.sh` 会在 `dist/` 缺失或前端源码更新时自动执行 `npm run build`。开发 UI 时也可以直接运行:

```bash
npm run dev
```

## 常用命令

```bash
./manage.sh start      # 后台启动本地服务
./manage.sh status     # 查看运行状态
./manage.sh logs -f    # 跟随服务日志
./manage.sh stop       # 停止服务
./manage.sh run        # 前台运行，便于调试
npm test               # 运行前端 Vitest 测试
npm run test:core      # 运行共享解析与聚合测试
npm run build          # 构建前端产物
npm run check          # 测试核心逻辑并构建
```

## 项目结构

```text
server.js              Node API、静态资源服务、会话管理接口
manage.sh              本地服务生命周期脚本
shared/                Codex / Claude Code 解析、去重、聚合逻辑
src/app.jsx            React 工作台壳和页面编排
src/components/        事件流、会话页、详情抽屉、对话抽屉
src/hooks/             数据加载和 URL 状态同步 hooks
src/lib/               视图模型、格式化、分页、URL 编码
src/styles/app.css     产品 UI 样式和设计变量
tests/                 Node 侧解析和聚合测试
```

## 功能概览

- 跨平台事件流: Codex 与 Claude Code 合并观测
- 会话分组: 按 session 聚合，支持单会话聚焦和取消聚焦
- 会话对话: 将原始事件还原为用户/助手/工具/思考流
- 会话管理: 搜索、重命名、删除、批量删除、批量导出
- Token 统计: 总量、缓存、推理、今日/本周消耗，按平台拆分
- URL 状态: tab、筛选条件、模式和选中 session 会同步到 URL
- 本地导入: 支持手动导入 JSONL 文件在浏览器内查看

## 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOST` | `127.0.0.1` | HTTP 监听地址 |
| `PORT` | `8787` | HTTP 端口 |
| `CODEX_SESSIONS_DIR` | `~/.codex/sessions` | Codex 会话目录 |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude Code 项目目录 |
| `CODEX_STATE_DB` | `~/.codex/state_5.sqlite` | Codex 标题元数据 SQLite |

## 安全说明

会话日志可能包含 prompt、工具输出、本地路径、代码片段和其他敏感信息。不要提交原始 JSONL、导出的会话文件或 `.runtime/` 内容。默认服务只监听 `127.0.0.1`，如需绑定其他地址，请确认本机数据暴露风险。
