const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const reset = "\x1b[0m";
const ansi = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const footerMarker = "\u0000DEVFLOW_FOOTER\u0000";

function style(code: string, value: string): string {
  return enabled ? `\x1b[${code}m${value}${reset}` : value;
}

export const color = {
  cyan: (value: string) => style("38;5;51", value),
  magenta: (value: string) => style("38;5;201", value),
  green: (value: string) => style("38;5;84", value),
  yellow: (value: string) => style("38;5;220", value),
  red: (value: string) => style("38;5;203", value),
  blue: (value: string) => style("38;5;75", value),
  muted: (value: string) => style("38;5;245", value),
  bold: (value: string) => style("1", value),
  selected: (value: string) => style("1;38;5;51", value),
  panel: (value: string) => panel(value),
  footer: (value: string) => `${footerMarker}${panel(value)}`,
  screen: (value: string) => screen(value),
};

function panel(value: string): string {
  return surface("48;5;232", value);
}

function screen(value: string): string {
  if (!enabled) return value;
  const source = value.split("\n");
  const footer = source.filter((line) => line.includes(footerMarker)).map((line) => line.replace(footerMarker, ""));
  const lines = source.filter((line) => !line.includes(footerMarker));
  const rows = process.stdout.rows || 24;
  while (lines.length + footer.length < rows) lines.push("");
  return [...lines, ...footer].map((line) => line.includes("\x1b[48;5;232m") ? line : surface("48;5;236", line)).join("\n");
}

function surface(background: string, value: string): string {
  if (!enabled) return value;
  const backgroundCode = `\x1b[${background}m`;
  const width = process.stdout.columns || 100;
  const visibleLength = value.replace(ansi, "").length;
  const padded = `${value.replaceAll(reset, `${reset}${backgroundCode}`)}${" ".repeat(Math.max(0, width - visibleLength))}`;
  return `${backgroundCode}${padded}${reset}`;
}
