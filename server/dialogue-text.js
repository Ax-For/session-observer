const { readCompactJsonRecord } = require("./compact-json-record");

function dialoguePaths(obj) {
  const paths = [];
  function contentPaths(content, prefix) {
    if (typeof content === "string") paths.push(prefix);
    else if (Array.isArray(content)) content.forEach((block, index) => {
      if (["text", "input_text", "output_text"].includes(block?.type) && typeof block.text === "string") paths.push([...prefix, index, "text"]);
    });
  }
  if (obj.type === "response_item" && obj.payload?.type === "message" && ["user", "assistant"].includes(obj.payload.role)) {
    contentPaths(obj.payload.content, ["payload", "content"]);
  } else if (obj.type === "event_msg" && ["user_message", "agent_message"].includes(obj.payload?.type)) {
    contentPaths(obj.payload.message, ["payload", "message"]);
  } else if (["user", "assistant"].includes(obj.type) && !obj.isMeta && !obj.toolUseResult) {
    if (Array.isArray(obj.message?.parts)) {
      obj.message.parts.forEach((part, index) => {
        if (!part?.thought && typeof part?.text === "string") paths.push(["message", "parts", index, "text"]);
      });
    } else contentPaths(obj.message?.content, ["message", "content"]);
  } else if (!["response_item", "event_msg"].includes(obj.type)) {
    const nested = obj.message && typeof obj.message === "object";
    const candidates = nested ? [["message", "content"], ["message", "text"], ["content"], ["text"], ["output"]] : [["content"], ["text"], ["output"]];
    for (const parts of candidates) {
      const value = parts.reduce((entry, key) => entry?.[key], obj);
      if (value != null) { contentPaths(value, parts); break; }
    }
  }
  return paths;
}

// Re-read only dialogue strings after bounded metadata parsing. Images and tool
// results never enter retained text or the disk cache.
function streamDialogueText(file, locator, obj, fallback, emit) {
  const paths = dialoguePaths(obj);
  if (!paths.length) { emit(String(fallback || "")); return; }
  if (!locator.truncated) {
    paths.forEach((parts, index) => {
      if (index) emit("\n");
      emit(parts.reduce((value, key) => value?.[key], obj) || "");
    });
    return;
  }
  const selected = new Set(paths.map((parts) => JSON.stringify(parts)));
  let active = false;
  let count = 0;
  readCompactJsonRecord(file, locator.byteOffset, locator.byteLength, {
    stringLimit: 256,
    onString(parts, text, phase) {
      if (phase === "start") {
        active = selected.has(JSON.stringify(parts));
        if (active && count++) emit("\n");
      } else if (active && phase === "chunk") emit(text);
      else if (phase === "end") active = false;
    },
  });
}
module.exports = { dialoguePaths, streamDialogueText };
