const fs = require("fs");
const path = require("path");
const os = require("os");
const config = require("./config");
const { registerSourceAdapters } = require("../shared/source-adapters");

let loaded = false;
let sources = [];

function expandHome(value) {
  const text = String(value || "");
  return text.startsWith("~/") ? path.join(os.homedir(), text.slice(2)) : path.resolve(text);
}

function loadCustomSources() {
  if (loaded) return sources;
  loaded = true;
  if (!config.SOURCE_ADAPTERS_FILE) return sources;
  try {
    const payload = JSON.parse(fs.readFileSync(config.SOURCE_ADAPTERS_FILE, "utf8"));
    sources = (payload.sources || []).map((source) => ({
      ...source,
      directories: (source.directories || []).map(expandHome),
      parserKey: source.parserKey || "parseGenericLineToEvent",
    })).filter((source) => source.key && source.directories.length);
    registerSourceAdapters(sources.map((source) => ({
      ...source,
      pathMarkers: source.pathMarkers?.length ? source.pathMarkers : source.directories,
    })));
  } catch (error) {
    console.warn(`[sources] Unable to load custom adapters: ${error.message}`);
    sources = [];
  }
  return sources;
}

module.exports = { loadCustomSources };
