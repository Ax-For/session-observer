import { message } from 'antd';
import type { Event } from '../types';

// Detect platform from file path
function detectPlatform(filePath: string): 'codex' | 'claude' {
  if (filePath.includes('/.claude/')) return 'claude';
  if (filePath.includes('/.codex/')) return 'codex';
  return 'claude'; // default
}

// Parse a single Codex JSONL line
function parseCodexLine(line: string, sessionId: string, sourceFile: string): Event[] {
  try {
    const obj = JSON.parse(line);
    const ts = obj.timestamp || '';
    const events: Event[] = [];

    if (obj.type === 'token_count' && obj.payload) {
      const usage = obj.payload;
      events.push({
        time: ts, sessionId, model: 'unknown',
        turnId: '', callId: '', toolName: '', cwd: '',
        sessionTitle: '', extra: 'token_count',
        sourceFile, sourceType: 'codex',
        callType: 'Token_Usage',
        rawType: obj.type, rawSubType: '',
        content: `Token usage · In ${usage.input_tokens ?? 0} · Out ${usage.output_tokens ?? 0} · Total ${usage.total_tokens ?? 0}`,
        summary: `Token usage · Total ${usage.total_tokens ?? 0}`,
        tokenUsage: {
          input: usage.input_tokens ?? null,
          output: usage.output_tokens ?? null,
          total: usage.total_tokens ?? null,
          cachedInput: usage.cached_input_tokens ?? null,
          reasoningOutput: null,
        },
        raw: obj,
      });
    } else if (obj.type === 'function_call' && obj.payload) {
      const name = obj.payload.name || '';
      const args = JSON.stringify(obj.payload.arguments || {}).slice(0, 200);
      events.push({
        time: ts, sessionId, model: 'unknown',
        turnId: '', callId: obj.payload.id || '', toolName: name, cwd: '',
        sessionTitle: '', extra: 'function_call',
        sourceFile, sourceType: 'codex',
        callType: 'Tool_Call',
        rawType: obj.type, rawSubType: '',
        content: `tool=${name}\nargs=${args}`,
        summary: `tool=${name}`,
        raw: obj,
      });
    } else if (obj.type === 'function_call_output' && obj.payload) {
      const output = (obj.payload.output || '').slice(0, 300);
      events.push({
        time: ts, sessionId, model: 'unknown',
        turnId: '', callId: '', toolName: '', cwd: '',
        sessionTitle: '', extra: 'function_call_output',
        sourceFile, sourceType: 'codex',
        callType: 'Tool_Result',
        rawType: obj.type, rawSubType: '',
        content: output,
        summary: output.slice(0, 100),
        raw: obj,
      });
    } else if (obj.type === 'agent_message' || obj.type === 'message') {
      const role = obj.payload?.role || obj.role;
      const content = typeof obj.payload?.content === 'string' ? obj.payload.content : '';
      if (role === 'user') {
        events.push({
          time: ts, sessionId, model: 'unknown',
          turnId: '', callId: '', toolName: '', cwd: '',
          sessionTitle: '', extra: 'user',
          sourceFile, sourceType: 'codex',
          callType: 'Prompt',
          rawType: obj.type, rawSubType: '',
          content: content.slice(0, 300),
          summary: content.slice(0, 100),
          raw: obj,
        });
      } else if (role === 'assistant') {
        events.push({
          time: ts, sessionId, model: 'unknown',
          turnId: '', callId: '', toolName: '', cwd: '',
          sessionTitle: '', extra: 'assistant',
          sourceFile, sourceType: 'codex',
          callType: 'Agent',
          rawType: obj.type, rawSubType: '',
          content: content.slice(0, 300),
          summary: content.slice(0, 100),
          raw: obj,
        });
      }
    } else {
      events.push({
        time: ts, sessionId, model: 'unknown',
        turnId: '', callId: '', toolName: '', cwd: '',
        sessionTitle: '', extra: `type=${obj.type || 'unknown'}`,
        sourceFile, sourceType: 'codex',
        callType: 'Raw',
        rawType: obj.type || '', rawSubType: '',
        content: JSON.stringify(obj).slice(0, 300),
        summary: JSON.stringify(obj).slice(0, 100),
        raw: obj,
      });
    }
    return events;
  } catch {
    return [];
  }
}

// Parse a single Claude Code JSONL line (simplified)
function parseClaudeCodeLine(line: string, sessionId: string, sourceFile: string): Event[] {
  try {
    const obj = JSON.parse(line);
    const ts = obj.timestamp || '';
    const events: Event[] = [];

    if (obj.type === 'assistant' && obj.message) {
      const content = Array.isArray(obj.message.content)
        ? obj.message.content.filter((i: any) => i?.type === 'text').map((i: any) => i.text).join('\n')
        : '';
      events.push({
        time: ts, sessionId, model: obj.message.model || 'unknown',
        turnId: obj.uuid || '', callId: '', toolName: '', cwd: obj.cwd || '',
        sessionTitle: '', extra: 'assistant',
        sourceFile, sourceType: 'claude',
        callType: 'Agent',
        rawType: obj.type, rawSubType: '',
        content: content.slice(0, 300),
        summary: content.slice(0, 100),
        raw: obj,
      });
    } else if (obj.type === 'user') {
      const content = typeof obj.message?.content === 'string' ? obj.message.content : '';
      events.push({
        time: ts, sessionId, model: 'unknown',
        turnId: obj.uuid || '', callId: '', toolName: '', cwd: obj.cwd || '',
        sessionTitle: '', extra: 'user',
        sourceFile, sourceType: 'claude',
        callType: 'User',
        rawType: obj.type, rawSubType: '',
        content: content.slice(0, 300),
        summary: content.slice(0, 100),
        raw: obj,
      });
    } else {
      events.push({
        time: ts, sessionId, model: 'unknown',
        turnId: obj.uuid || '', callId: '', toolName: '', cwd: obj.cwd || '',
        sessionTitle: '', extra: `type=${obj.type || 'unknown'}`,
        sourceFile, sourceType: 'claude',
        callType: 'Raw',
        rawType: obj.type || '', rawSubType: '',
        content: JSON.stringify(obj).slice(0, 300),
        summary: JSON.stringify(obj).slice(0, 100),
        raw: obj,
      });
    }
    return events;
  } catch {
    return [];
  }
}

// Parse JSONL file content
export function parseJsonlFile(file: File): Promise<Event[]> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\n').filter(Boolean);
      const platform = detectPlatform(file.name);
      const sessionId = file.name.replace(/\.(jsonl|log|txt)$/, '');
      const sourceFile = file.name;
      const events: Event[] = [];

      for (const line of lines) {
        if (platform === 'codex') {
          events.push(...parseCodexLine(line, sessionId, sourceFile));
        } else {
          events.push(...parseClaudeCodeLine(line, sessionId, sourceFile));
        }
      }
      resolve(events);
    };
    reader.readAsText(file);
  });
}

// Export events to JSONL string
export function eventsToJsonl(events: Event[]): string {
  return events
    .filter((e) => e.raw)
    .map((e) => JSON.stringify(e.raw))
    .join('\n');
}

// Download JSONL file
export function downloadJsonl(content: string, filename: string) {
  const blob = new Blob([content], { type: 'application/x-jsonlines' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Export filtered events
export function exportFilteredEvents(events: Event[]) {
  const jsonl = eventsToJsonl(events);
  const timestamp = new Date().toISOString().slice(0, 10);
  downloadJsonl(jsonl, `session-export-${timestamp}.jsonl`);
  message.success(`已导出 ${events.length} 条事件`);
}
