# Session Observer

本地前端页面，用于观测 AI Coding Assistant（Codex 和 Claude Code）会话日志。

- Codex: `~/.codex/sessions/**/*.jsonl`
- Claude Code: `~/.claude/projects/**/*.jsonl`

## 环境要求

- **Node.js ≥ 16**（使用了 `fs.rmSync`、`replaceAll` 等 API）
- **sqlite3 CLI**（Codex 会话标题读取依赖，Mac 通常自带，Ubuntu/Debian: `sudo apt install sqlite3`）
- 现代浏览器（Chrome 85+ / Firefox 77+ / Safari 13.1+）
- 前端 Markdown 渲染依赖 [marked.js](https://marked.js.org/)（通过 jsDelivr CDN 加载，需网络可用）

## 功能

### 核心功能

- 双平台支持：同时导入和浏览 Codex 与 Claude Code 会话
- 事件类型：Prompt / User / Agent / Tool_Call / Tool_Result / Token_Usage / Thinking
- 平台筛选：按 Codex 或 Claude Code 过滤
- 左侧 Session 分组浏览（按最近活跃排序，支持一键查看单个会话）
- 按模型、类型、平台、时间范围筛选
- 关键词搜索（全文，含 sessionId / turnId / callId / toolName）
- 点击行查看完整详情（含原始 raw 事件）
- 自动刷新模式（每 5 秒轮询服务器）
- 虚拟滚动（支持大规模事件流）
- 主题切换（白天/夜间）和密度切换（舒展/紧凑）

### 统计仪表盘

- Token 使用汇总：输入/输出/总计/缓存/推理
- 事件类型分布：可视化条形图
- 模型分布：各模型使用次数
- 平台分布：Codex vs Claude Code
- 数量统计：总事件/匹配事件/会话数/已加载
- 所有指标含 tooltip 说明

### 会话管理

- 会话列表搜索（名称/cwd/sessionId）
- 平台筛选、仅显示已命名筛选
- 重命名会话标题
- 删除单个会话
- 批量选择和批量删除
- 批量导出 JSONL

### 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `f` 或 `/` | 聚焦搜索框 |
| `r` | 手动刷新 |
| `a` | 切换自动刷新 |
| `t` | 切换主题 |
| `m` | 切换观测/原始模式 |
| `j` / `↓` | 下一条事件 |
| `k` / `↑` | 上一条事件 |
| `Enter` | 打开事件详情 |
| `Esc` | 关闭弹窗 |

### URL 状态共享

当前视图状态（过滤器、选中会话、Tab、模式等）自动编码到 URL 搜索参数中。复制 URL 发送给他人，打开即可看到相同的视图。

示例：`http://localhost:8787/?q=error&platform=codex&mode=raw&sort=asc`

外观偏好（主题、密度、面板宽度）存储在 `localStorage` 中，不编码到 URL。

## 使用

### 管理脚本（推荐）

```bash
cd session-observer
./manage.sh start
./manage.sh status
./manage.sh open
./manage.sh logs -f
./manage.sh stop
```

可用命令：`start | stop | restart | status | logs | open | run`

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `8787` | HTTP 端口 |
| `CODEX_SESSIONS_DIR` | `~/.codex/sessions` | Codex 会话目录 |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude Code 项目目录 |

### 实时模式

1. `./manage.sh start`
2. 浏览器打开：`http://localhost:8787`
3. 点击"自动刷新"，页面每 5 秒自动刷新

### 手动导入模式

- 点击"导入 JSONL"手动加载文件（支持 Codex 和 Claude Code 格式）

## 事件类型映射

### Codex

| 类型 | 来源 |
|------|------|
| `Prompt` | `response_item.message` 且 `role=user` |
| `Agent` | `event_msg.agent_message` 或 `response_item.message` 且 `role=assistant` |
| `Tool_Call` | `response_item.function_call` |
| `Tool_Result` | `response_item.function_call_output` |
| `Token_Usage` | `event_msg.token_count` |

### Claude Code

| 类型 | 来源 |
|------|------|
| `User` | `type=user` 且非 meta、非 tool result |
| `Agent` | `type=assistant` 且含 text 内容 |
| `Tool_Call` | `type=assistant` 且含 `tool_use` 内容块 |
| `Tool_Result` | `type=user` 且含 `toolUseResult` |
| `Token_Usage` | `type=assistant` 且含 `message.usage` 字段 |
| `Thinking` | `type=assistant` 且仅含 `thinking` 内容块（默认隐藏） |

## 技术架构

- **零依赖**：纯 HTML/CSS/JS + Node.js HTTP server
- **无构建步骤**：直接编辑文件，刷新浏览器
- **双解析器**：Codex 和 Claude Code 分别有独立的事件解析逻辑
- **虚拟滚动**：事件流和会话列表均支持大规模数据
- **URL 状态同步**：视图状态编码到 URL，支持分享和书签
