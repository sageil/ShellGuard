import os from "node:os";
import path from "node:path";
import { SAFE_QUESTION, GIT_QUESTION, SAFE_CASES, GIT_CASES } from "./cases.js";
import { createRoots, resolveCommand } from "./paths.js";

const home = os.homedir();
const cwd = process.cwd();

const ENDPOINT = process.env.KEV_URL ?? "http://localhost:8009/v1/systemone";
const API_KEY = process.env.KEV_API_KEY ?? "";
const MODEL = process.env.MODEL ?? "kev-latest";
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS ?? 30_000);

const roots = createRoots(cwd);

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
    const resolved = resolveCommand(command, roots);
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

const FLAG_HANDLERS = {
  "--safe": (args) => args.suites.add("safe"),
  "--git": (args) => args.suites.add("git"),
  "--command": (args, argv, i) => {
    const next = argv[i + 1];
    if (!next) throw new Error(`Missing value for --command`);
    args.commands.push(next);
    argv[i + 1] = null;
  },
  "-c": (args, argv, i) => {
    const next = argv[i + 1];
    if (!next) throw new Error(`Missing value for -c`);
    args.commands.push(next);
    argv[i + 1] = null;
  },
  "--help": (args) => { args.help = true; },
  "-h": (args) => { args.help = true; },
};

function parseArgs(argv) {
  const args = { suites: new Set(), commands: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === null) continue;
    const handler = FLAG_HANDLERS[argv[i]];
    if (!handler) throw new Error(`Unknown argument: ${argv[i]}`);
    handler(args, argv, i);
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
  KEV_URL             Kev server endpoint (default: http://localhost:8009/v1/systemone)
  KEV_API_KEY         API key for the Kev server
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
