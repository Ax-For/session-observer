# Session Observer

**面向 Codex 与 Claude Code 的本地优先会话观测工作台。** 将散落在本机的 JSONL 会话记录整理成语义事件流、可搜索的会话库、Token 与成本账本，以及运行健康面板，全程不需要上传 prompt、工具输出或源码路径。

[![CI](https://github.com/Ax-For/session-observer/actions/workflows/ci.yml/badge.svg)](https://github.com/Ax-For/session-observer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-LTS%20or%20newer-339933.svg)](package.json)
[![React](https://img.shields.io/badge/react-19-149eca.svg)](package.json)
[![Local first](https://img.shields.io/badge/data-local--first-16a085.svg)](#隐私模型)

[English](README.md)

![Session Observer overview](docs/screenshots/overview.png)

Session Observer 面向同时使用多个本地编码 Agent 的开发者，重点解决这些实际问题：

- 当前有哪些会话仍在写入，最近发生了什么？
- 用户问了什么、Agent 如何回答，中间执行了哪些工具？
- 输入、缓存读取、缓存写入、输出、推理 Token 和估算成本分别来自哪里？
- 哪些模型、工作区、文件和命令占用了主要资源？
- 面对数百 MB 的会话文件，能否不创建庞大的全量事件索引？

## 30 秒启动

```bash
npm install
./manage.sh start
./manage.sh open
```

默认地址为 [http://127.0.0.1:8787](http://127.0.0.1:8787)，不需要注册账号或部署外部数据库。

`manage.sh` 会按需构建 Vite 前端，并使用受约束的 Node 堆参数启动服务。仅调试前端时可以运行 `npm run dev`。

## 核心工作面

| 页面 | 主要用途 |
| --- | --- |
| **运行总览** | 服务与数据源健康、RSS 与 Heap、今日会话和对话、24 小时事件与 Token 负载、正在写入的会话、使用节奏和工作区集中度 |
| **Token 账本** | 非缓存输入、缓存命中、缓存写入、输出、推理输出、估算成本、效率指标、趋势与预测、模型归因、工作区归因和高成本会话 |
| **事件流** | 按用户回合归组的语义活动、问答/工具/用量/原始视图、按钮触发搜索、筛选、高亮、实时跟随/暂停，以及跳转到会话详情 |
| **会话管理** | 活跃会话、工作区分组、目录树、完整会话统计、开始与最近时间、可折叠对话、活动、用量、文件/工具、命令、错误、上下文压缩和原始诊断 |

## 设计重点

### 默认看语义活动，而不是底层日志噪声

事件流会把一个用户回合、Agent 回复、工具调用、Token 快照、模型、耗时和错误归并成一个可展开活动。原始视图仍用于排查，但正常使用时不再被内部记录淹没。

搜索通过按钮显式触发，只匹配用户与 Agent 的问答内容，不会因为内部元数据、路径或 Token 记录产生大量无效结果。

### 一个统一的会话工作台

从事件流或活跃会话跳转时，都会进入同一个详情工作台。完整事件数和 Token 总量来自稳定摘要，对话内容则从有界的最近窗口读取。默认先加载最新 400 条原始事件，对话按回合折叠，更早内容只在用户请求时继续读取。

### 更细的 Token 与成本归因

Token 统计明确拆分为：

- 非缓存输入；
- 缓存读取；
- 缓存写入；
- 模型输出；
- 推理输出。

页面可以按时间窗口、模型、平台、工作区和会话查看消耗。金额根据已识别模型的价格表估算，并不等同于供应商最终账单。

### 面向大型本地会话历史

Session Observer 不会把完整会话库长期保留在内存中：

- 最近事件直接从源文件反向扫描；
- 已完成且未变化的归档文件复用摘要；
- 正在增长的当前文件只解析追加部分；
- 持久化摘要只保留有界的目标、结果、工具、文件、错误、上下文压缩和模型切换信息，不保存原始事件数组；
- 前端对大型列表使用虚拟化或分批渲染，并直接展示 RSS、Heap、External 和缓存状态。

因此，即使单个 JSONL 文件达到数百 MB，常规浏览也不需要构建常驻内存的全量事件索引。实际内存仍会受到会话结构、筛选条件和用户主动加载页数的影响。

## 页面截图

截图使用脱敏示例数据，不包含真实 prompt、本机用户名路径、工具输出、凭据或原始 JSONL 内容。

| 运行总览 | 事件流 |
| --- | --- |
| ![Overview dashboard](docs/screenshots/overview.png) | ![Event stream](docs/screenshots/stream.png) |

| Token 账本 | 会话工作台 |
| --- | --- |
| ![Token dashboard](docs/screenshots/tokens.png) | ![Session detail](docs/screenshots/sessions.png) |

## 数据来源

| 来源 | 默认路径 | 使用的数据 |
| --- | --- | --- |
| Codex 会话 | `~/.codex/sessions/**/*.jsonl` | Prompt、Agent 消息、工具调用、Token、模型、时间和工作目录 |
| Claude Code 项目 | `~/.claude/projects/**/*.jsonl` | 项目会话、消息、工具活动、模型和用量 |
| Codex state DB | `~/.codex/state_5.sqlite` | 会话标题元数据，通过 `sqlite3` CLI 读取 |

服务通过文件系统通知感知源文件变化，并将变化推送给浏览器。事件分页和搜索仍按需读取，不会转化成永久驻留内存的全局索引。

## 环境要求

- Node.js LTS 或更新版本
- npm
- `sqlite3` CLI，用于读取 Codex 标题元数据
- 现代桌面浏览器

## 常用命令

```bash
./manage.sh start      # 后台启动服务
./manage.sh status     # 查看 PID 和本地地址
./manage.sh logs -f    # 跟随运行日志
./manage.sh stop       # 停止服务
./manage.sh run        # 前台运行

npm test               # 前端 Vitest 测试
npm run test:core      # 解析、聚合、缓存和路由测试
npm run build          # 构建生产前端
npm run check          # lint、全部测试和生产构建
```

## 项目结构

```text
server.js              本地 HTTP API 与前端静态资源服务
manage.sh              服务生命周期和内存约束参数
server/                按需扫描、源文件监听、摘要缓存和路由
shared/                Codex / Claude Code 解析、去重、Token、Trace 和聚合逻辑
src/app.jsx            React 外壳、URL 状态和工作区编排
src/components/        总览、Token、事件流、会话库和详情工作面
src/hooks/             数据加载、源文件变化、分页和会话操作
src/lib/               活动模型、视图模型、格式化、分页和 URL 工具
tests/                 Node 侧解析、缓存、内存、路由和 Trace 测试
```

后端保持为一个本地 Node 进程。React 界面由 Vite 构建，再由同一个进程提供。共享解析层确保服务端摘要和前端视图使用一致的事件语义。

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP 监听地址 |
| `PORT` | `8787` | HTTP 端口 |
| `CODEX_SESSIONS_DIR` | `~/.codex/sessions` | Codex 会话目录 |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude Code 项目目录 |
| `CODEX_STATE_DB` | `~/.codex/state_5.sqlite` | Codex 标题元数据数据库 |

```bash
PORT=8790 CODEX_SESSIONS_DIR=/path/to/codex/sessions ./manage.sh start
```

## 隐私模型

会话记录可能包含 prompt、源码、工具输出、文件路径和凭据。Session Observer 按本地检查场景设计：

- 默认服务只监听 `127.0.0.1`；
- 会话 JSONL 和 `.runtime/` 运行产物不会进入版本控制；
- 搜索和统计都直接针对本机文件执行；
- 不要求遥测、托管存储或第三方账号。

只有在明确理解暴露风险时才绑定非本机地址：

```bash
HOST=0.0.0.0 ./manage.sh start
```

## 项目资源

- [参与贡献](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [MIT License](LICENSE)
- [社交预览图](docs/social-preview.png)

## Roadmap

- 支持更多本地编码 Agent。
- 会话对比和时间线 Diff。
- 更灵活的模型价格别名与保留策略。
- 更深入的长期文件监听与缓存复用诊断。
