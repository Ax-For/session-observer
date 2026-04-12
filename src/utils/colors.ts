// Event type color classes
export const typeColors: Record<string, { bg: string; text: string }> = {
  Prompt: { bg: '#deecff', text: '#2a4b74' },
  User: { bg: '#deecff', text: '#2a4b74' },
  Agent: { bg: '#d9f2f9', text: '#164e61' },
  Tool_Call: { bg: '#d9f5ef', text: '#145b52' },
  Tool_Result: { bg: '#e6e9ff', text: '#4a4c8f' },
  Token_Usage: { bg: '#dfeeff', text: '#2e5d8a' },
  Thinking: { bg: '#f0e4ff', text: '#6b3fa0' },
  Raw: { bg: '#f8ecd5', text: '#6b4e16' },
};

// Dark mode event type colors (Sentry-inspired)
export const typeColorsDark: Record<string, { bg: string; text: string }> = {
  Prompt: { bg: 'rgba(220, 180, 100, 0.10)', text: '#e0c080' },
  User: { bg: 'rgba(220, 180, 100, 0.10)', text: '#e0c080' },
  Agent: { bg: 'rgba(100, 160, 220, 0.10)', text: '#8bb4e0' },
  Tool_Call: { bg: 'rgba(139, 124, 200, 0.10)', text: '#b5a8d4' },
  Tool_Result: { bg: 'rgba(130, 130, 200, 0.10)', text: '#b0a8d8' },
  Token_Usage: { bg: 'rgba(100, 180, 140, 0.10)', text: '#8fd4a8' },
  Thinking: { bg: 'rgba(180, 140, 220, 0.10)', text: '#c0a0e0' },
  Raw: { bg: 'rgba(200, 160, 100, 0.10)', text: '#d0a870' },
};

// Platform colors
export const platformColors = {
  codex: { bg: '#d9f5e6', text: '#1a5c3a', label: 'CX', name: 'Codex' },
  claude: { bg: '#ede5ff', text: '#7c3aed', label: 'CC', name: 'Claude Code' },
};

export const platformColorsDark = {
  codex: { bg: 'rgba(100, 200, 150, 0.10)', text: '#8fd4a8', label: 'CX', name: 'Codex' },
  claude: { bg: 'rgba(180, 140, 220, 0.10)', text: '#c0a0e0', label: 'CC', name: 'Claude Code' },
};
