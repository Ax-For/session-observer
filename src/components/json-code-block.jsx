import { Fragment } from "react";

const JSON_TOKEN_PATTERN = /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\]:,]/g;

export function JsonCodeBlock({ value, className = "" }) {
  const text = stringifyJson(value);
  const classes = ["json-code-block", className].filter(Boolean).join(" ");
  const lines = text.split("\n");

  return (
    <pre className={classes}>
      {lines.map((line, index) => (
        <Fragment key={`${index}-${line.length}`}>
          {renderJsonLine(line)}
          {index < lines.length - 1 ? "\n" : null}
        </Fragment>
      ))}
    </pre>
  );
}

function stringifyJson(value) {
  if (typeof value === "string") return value || "-";
  try {
    return JSON.stringify(value, null, 2) || "-";
  } catch {
    return String(value || "-");
  }
}

function renderJsonLine(line) {
  const matches = Array.from(line.matchAll(JSON_TOKEN_PATTERN));
  if (!matches.length) return line;

  const nodes = [];
  let lastIndex = 0;

  matches.forEach((match, index) => {
    const [token] = match;
    const start = match.index ?? 0;
    if (start > lastIndex) nodes.push(line.slice(lastIndex, start));

    nodes.push(
      <span key={`${start}-${index}`} className={tokenClassName(token, match)}>
        {token}
      </span>,
    );
    lastIndex = start + token.length;
  });

  if (lastIndex < line.length) nodes.push(line.slice(lastIndex));
  return nodes;
}

function tokenClassName(token, match) {
  if (match[1]) return "json-token json-token--key";
  if (match[2]) return "json-token json-token--string";
  if (token === "true" || token === "false") return "json-token json-token--boolean";
  if (token === "null") return "json-token json-token--null";
  if (/^-?\d/.test(token)) return "json-token json-token--number";
  return "json-token json-token--punct";
}
