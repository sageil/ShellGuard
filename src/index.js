import { mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SAFE_QUESTION, GIT_QUESTION, SAFE_CASES, GIT_CASES } from "./cases.js";

const home = os.homedir();
const cwd = process.cwd();

const resolvePath = (target) => {
  const absolute = path.resolve(target);
  const pending = [];
  let current = absolute;
  for (;;) {
    try {
      return path.join(realpathSync(current), ...pending.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      pending.push(path.basename(current));
      current = parent;
    }
  }
};

const ENDPOINT = process.env.KEV_URL ?? "http://localhost:8009/v1/systemone";
const API_KEY = process.env.KEV_API_KEY ?? "";
const MODEL = process.env.MODEL ?? "kev-latest";
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS ?? 30_000);

const configRoot = path.join(home, ".config", "myapp");
const dataRoot = path.join(home, ".local", "share", "myapp");
const contextRoot = path.join(dataRoot, "context");

const roots = {
  workspaceRoot: resolvePath(cwd),
  globalAgentRoot: resolvePath(path.join(home, ".agents")),
  userConfigRoot: resolvePath(configRoot),
  userDataRoot: resolvePath(dataRoot),
  conversationHistoryRoot: resolvePath(
    path.join(contextRoot, "conversation-history"),
  ),
  largeToolResultsRoot: resolvePath(path.join(contextRoot, "large-tool-results")),
  scratchRoot: mkdtempSync(path.join(os.tmpdir(), "myapp-scratch-")),
  builtinSkillsRoot: resolvePath(path.join(cwd, ".agents", "skills")),
};

const SAFE_PATHS = [
  roots.workspaceRoot,
  roots.globalAgentRoot,
  roots.userConfigRoot,
  roots.userDataRoot,
  roots.conversationHistoryRoot,
  roots.largeToolResultsRoot,
  roots.scratchRoot,
  roots.builtinSkillsRoot,
].filter((p) => typeof p === "string" && p !== "");

const VIRTUAL_ROUTES = [
  [/^\/large_tool_results(?:\/|$)/, roots.largeToolResultsRoot],
  [/^\/conversation-history(?:\/|$)/, roots.conversationHistoryRoot],
];

const resolveToken = (token) => {
  if (!token) return undefined;
  const virtual = VIRTUAL_ROUTES.find(([pattern]) => pattern.test(token));
  if (virtual) return resolvePath(path.join(virtual[1], token.replace(virtual[0], "")));
  if (!/\$\{?MYAPP_(SCRATCH_DIR|WORKSPACE_ROOT)\}?/g.test(token)) return undefined;
  return resolvePath(
    token
      .replace(/\$\{?MYAPP_SCRATCH_DIR\}?/g, roots.scratchRoot)
      .replace(/\$\{?MYAPP_WORKSPACE_ROOT\}?/g, roots.workspaceRoot),
  );
};

const isPathLike = (word) => /[/~$]/.test(word);

const extractTokens = (command) => {
  const stripped = command.replace(/\s-[^\s]+/g, " ");
  const unquote = (tokens) =>
    tokens.map((t) => t.replace(/^["']|["']$/g, "")).filter(isPathLike);
  const quoted = unquote(stripped.match(/"([^"]*)"|'([^']*)'/g) ?? []);
  const bare = stripped
    .replace(/"[^"]*"|'[^']*'/g, " ")
    .split(/\s+/)
    .filter(isPathLike);
  return [...new Set([...quoted, ...bare])];
};

const resolveCommand = (command) => {
  const tokens = extractTokens(command).sort((a, b) => b.length - a.length);
  let resolved = command;
  for (const token of tokens) {
    const target = resolveToken(token);
    if (target) resolved = resolved.split(token).join(target);
  }
  return resolved;
};



async function call(state, question) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify({ model: MODEL, state, questions: { q: question } }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text}`);
  return JSON.parse(text);
}

const render = (answer) => {
  if (!answer || answer.type !== "choice") return "n/a";
  const { true: t, false: f } = answer.probabilities;
  return `${t.toFixed(2)}/${f.toFixed(2)}`;
};

async function runSuite(title, question, cases) {
  const rows = [];
  for (const [label, command] of cases) {
    const resolved = resolveCommand(command);
    const state = {
      command: resolved,
      allowed_roots: SAFE_PATHS,
      execution_path: cwd,
    };
    try {
      const body = await call(state, question);
      rows.push([label.padEnd(18), resolved.replace(/\s+/g, " ").slice(0, 46).padEnd(46), render(body.answers.q)]);
    } catch (error) {
      rows.push([label.padEnd(18), resolved.replace(/\s+/g, " ").slice(0, 46).padEnd(46), `ERROR: ${error.message}`]);
    }
  }
  const header = ["label".padEnd(18), "command".padEnd(46), title].join("  ");
  console.log(`\n=== ${title} ===`);
  console.log(header);
  console.log("-".repeat(header.length));
  for (const row of rows) console.log(row.join("  "));
}

function parseArgs(argv) {
  const args = { suites: new Set(), commands: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--safe") args.suites.add("safe");
    else if (arg === "--git") args.suites.add("git");
    else if (arg === "--command" || arg === "-c") {
      const next = argv[++i];
      if (!next) throw new Error(`Missing value for ${arg}`);
      args.commands.push(next);
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.suites.size === 0 && args.commands.length === 0) {
    args.suites.add("safe");
    args.suites.add("git");
  }
  return args;
}

function printHelp() {
  console.log(`
Usage: node src/index.js [options]

Options:
  --safe          Run the safe command evaluation suite
  --git           Run the git mutation evaluation suite
  -c, --command   Evaluate a custom command (can be repeated)
  -h, --help      Show this help message

Environment variables:
  VON_URL             Kev server endpoint (default: http://localhost:8009/v1/systemone)
  LOCALJEV_API_KEY    API key for the Kev server
  MODEL               Model name (default: kev-latest)
  FETCH_TIMEOUT_MS    Request timeout in ms (default: 30000)
`);
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.commands.length > 0) {
  await runSuite("safe t/f", SAFE_QUESTION, args.commands.map((c) => ["custom", c]));
}

if (args.suites.has("safe")) {
  await runSuite("safe t/f", SAFE_QUESTION, SAFE_CASES);
}

if (args.suites.has("git")) {
  await runSuite("git_mut t/f", GIT_QUESTION, GIT_CASES);
}
