export const keyHint = (value) => !value ? "" : String(value).length > 4 ? `•••• ${String(value).slice(-4)}` : "••••";
