import os from "node:os";
import path from "node:path";
import { QUESTIONS, SCOPED_CASES, PERM_CHANGE_CASES, PRIV_ESC_CASES, GIT_CASES } from "./cases.js";
import { createRoots, resolveCommand } from "./paths.js";

const home = os.homedir();
const cwd = process.cwd();

const ENDPOINT = process.env.KEV_URL ?? "http://localhost:8009/v1/systemone";
const API_KEY = process.env.KEV_API_KEY ?? "";
const MODEL = process.env.MODEL ?? "kev-latest";
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS ?? 30_000);

const roots = createRoots(cwd);

const ALLOWED_PATHS = [
  roots.workspaceRoot,
  roots.globalAgentRoot,
  roots.userConfigRoot,
  roots.userDataRoot,
  roots.conversationHistoryRoot,
  roots.largeToolResultsRoot,
  roots.scratchRoot,
  roots.builtinSkillsRoot,
].filter((p) => typeof p === "string" && p !== "");



async function call(state, questions) {
  const body = { model: MODEL, state, questions };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text}`);
  return JSON.parse(text);
}


async function runSuite(title, questions, cases) {
  const rows = [];
  for (const [label, command] of cases) {
    const resolved = resolveCommand(command, roots);
    const state = {
      command: resolved,
      allowed_roots: ALLOWED_PATHS,
      execution_path: cwd,
    };
    try {
      const body = await call(state, questions);
      const results = Object.entries(body.answers).map(([key, answer]) => {
        if (!answer || answer.type !== "choice") return `${key}: n/a`;
        const label = questions[key]?.label ?? key;
        const { true: t, false: f } = answer.probabilities;
        return `${label}: ${t.toFixed(2)}/${f.toFixed(2)}`;
      });
      rows.push([label.padEnd(18), resolved.replace(/\s+/g, " ").slice(0, 46).padEnd(46), results.join("  ")]);
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
  "--scoped": (args) => args.suites.add("scoped"),
  "--perm-change": (args) => args.suites.add("perm_change"),
  "--priv-esc": (args) => args.suites.add("priv_esc"),
  "--git-mut": (args) => args.suites.add("git_mut"),
  "--all": (args) => {
    for (const q of QUESTIONS) args.suites.add(q.key);
  },
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
    args.suites.add("constrained");
    args.suites.add("git");
  }
  return args;
}

function printHelp() {
  console.log(`
Usage: node src/index.js [options]

Options:
  --scoped        Run only the scoped question
  --perm-change   Run only the permission-change question
  --priv-esc      Run only the privilege-escalation question
  --git-mut       Run only the git mutation question
  --all           Run all questions
  -c, --command   Evaluate a custom command (can be repeated)
  -h, --help      Show this help message

Environment variables:
  KEV_URL             Kev server endpoint (default: http://localhost:8009/v1/systemone)
  KEV_API_KEY         API key (if server requires auth) | _(none)_ |
  MODEL               Model name | kev-latest |
  FETCH_TIMEOUT_MS    Request timeout in milliseconds | 30000 |
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

const formatQuestions = (questions) =>
  Object.fromEntries(questions.map((q) => [q.key, { label: q.label, type: q.type, instructions: q.instructions, criteria: q.criteria }]));

const CASES_BY_KEY = {
  scoped: SCOPED_CASES,
  perm_change: PERM_CHANGE_CASES,
  priv_esc: PRIV_ESC_CASES,
  git_mut: GIT_CASES,
};

const selectedQuestions = args.suites.size > 0
  ? QUESTIONS.filter((q) => args.suites.has(q.key))
  : QUESTIONS;

if (args.commands.length > 0) {
  for (const q of selectedQuestions) {
    await runSuite(`${q.label} t/f`, formatQuestions([q]), args.commands.map((c) => ["custom", c]));
  }
} else {
  for (const q of selectedQuestions) {
    await runSuite(`${q.label} t/f`, formatQuestions([q]), CASES_BY_KEY[q.key]);
  }
}
