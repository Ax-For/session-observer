const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-e2e-"));
const codex = path.join(root, ".codex", "sessions");
const claude = path.join(root, ".claude", "projects");
const repo = path.join(root, "demo-project");
fs.mkdirSync(codex, { recursive: true });
fs.mkdirSync(claude, { recursive: true });
fs.mkdirSync(repo);
const liveManifest = path.join(os.tmpdir(), `observer-e2e-live-${process.env.PORT || "8878"}.json`);
fs.writeFileSync(liveManifest, JSON.stringify({ codex, claude }));
process.on("exit", () => fs.rmSync(liveManifest, { force: true }));
const now = Date.now();
execFileSync("git", ["init", "-q"], { cwd: repo });
execFileSync("git", ["-c", "user.name=Demo", "-c", "user.email=demo@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-qm", "Demo outcome"], { cwd: repo });
const rows = [{ type: "session_meta", timestamp: new Date(now - 120000).toISOString(), payload: { id: "demo-session", title: "演示工作会话", cwd: repo } }];
rows.push({ type: "response_item", timestamp: new Date(now - 300000).toISOString(), payload: { type: "message", role: "user", content: [{ type: "input_text", text: "查找历史问答" }] } });
rows.push({ type: "response_item", timestamp: new Date(now - 299000).toISOString(), payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "历史正文。".repeat(18000) + "封存关键词，位于长正文尾部。" + "后文。".repeat(3000) }] } });
for (let i = 0; i < 480; i++) rows.push({ type: "event_msg", timestamp: new Date(now - 280000 + i * 100).toISOString(), payload: { type: "agent_reasoning", text: "后台运行记录" } });
for (let i = 0; i < 4; i++) {
  const time = (offset) => new Date(now - 100000 + i * 25000 + offset).toISOString();
  rows.push({ type: "turn_context", timestamp: time(0), payload: { thread_id: "demo-session", model: "gpt-5.5", cwd: repo } });
  rows.push({ type: "response_item", timestamp: time(1), payload: { type: "message", role: "user", content: [{ type: "input_text", text: `检查演示功能 ${i + 1}` }] } });
  rows.push({ type: "response_item", timestamp: time(2000), payload: { type: "function_call", call_id: `call-${i}`, name: "exec_command", arguments: '{"cmd":"npm test"}' } });
  rows.push({ type: "response_item", timestamp: time(4000), payload: { type: "function_call_output", call_id: `call-${i}`, output: "All tests passed", exit_code: 0 } });
  rows.push({ type: "event_msg", timestamp: time(5000), payload: { type: "agent_message", message: `第 ${i + 1} 轮检查完成，测试通过。` } });
  rows.push({ type: "event_msg", timestamp: time(6000), payload: { type: "token_count", info: { last_token_usage: { input_tokens: 12000, cached_input_tokens: 8000, output_tokens: 600, total_tokens: 12600 } } } });
}
fs.writeFileSync(path.join(codex, "demo-session.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
const childId = "aaaaaaaa-1111-4111-8111-111111111111";
fs.writeFileSync(path.join(codex, `rollout-${childId}.jsonl`), [
  { type: "session_meta", timestamp: new Date(now - 90000).toISOString(), payload: { id: childId, title: "检索子 Agent", cwd: repo, source: { subagent: { thread_spawn: { parent_thread_id: "demo-session" } } } } },
  { type: "turn_context", timestamp: new Date(now - 89000).toISOString(), payload: { thread_id: "demo-session", model: "gpt-5.5", cwd: repo } },
  { type: "event_msg", timestamp: new Date(now - 88000).toISOString(), payload: { type: "user_message", message: "检查子任务" } },
  { type: "event_msg", timestamp: new Date(now - 87000).toISOString(), payload: { type: "agent_message", message: "子任务唯一关键词，仅存在于子 Agent 对话。" } },
].map((row) => JSON.stringify(row)).join("\n") + "\n");
const childDir = path.join(claude, "demo-session", "subagents");
fs.mkdirSync(childDir, { recursive: true });
fs.writeFileSync(path.join(childDir, "agent-helper.jsonl"), JSON.stringify({ type: "assistant", timestamp: new Date(now - 30000).toISOString(), sessionId: "demo-session", cwd: repo,
  message: { id: "helper-1", model: "claude-sonnet-4-5", content: [{ type: "text", text: "子 Agent 检查完成" }], usage: { input_tokens: 200, output_tokens: 100 } } }) + "\n");
Object.assign(process.env, { HOST: "127.0.0.1", PORT: process.env.PORT || "8878", CODEX_SESSIONS_DIR: codex, CLAUDE_PROJECTS_DIR: claude,
  CODEX_STATE_DB: path.join(root, "missing.sqlite"), CODEX_SESSION_INDEX: path.join(root, "missing-index.jsonl"),
  OBSERVER_RUNTIME_DIR: path.join(root, "runtime"), OBSERVER_SESSION_ANNOTATIONS_FILE: path.join(root, "annotations.json"),
  OBSERVER_DATA_DIR: path.join(root, "data"), OBSERVER_DIALOGUE_SEARCH: "sqlite" });
process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
require("../../server.js");
