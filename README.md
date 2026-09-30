# shellguard

Evaluate shell command safety using [Kev](https://github.com/jaredpalmer/kev), a small decision model you can run locally.

## What it does

Sends commands to a Kev server and asks whether they are safe to execute. Commands are evaluated across four focused questions:

- **scoped** — Are all filesystem operations within `allowed_roots`?
- **perm change** — Does the command change file permissions or ownership?
- **priv esc** — Does the command elevate privileges?
- **git mut** — Does the command mutate source control?


## Prerequisites

- [Node.js](https://nodejs.org/) 20.9+
- A running [Kev](https://github.com/jaredpalmer/kev) server

## Setting up Kev

Clone and run Kev locally (requires Python 3.12+ and [uv](https://docs.astral.sh/uv/)):

```bash
git clone https://github.com/jaredpalmer/kev.git
cd kev
uv sync --extra serve
uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8009
```

This starts Kev-4B on `http://localhost:8009`. The first run downloads the model weights.

For other model sizes and deployment options (Modal, Hugging Face Spaces), see the [Kev README](https://github.com/jaredpalmer/kev#quick-start).

## Running the evaluation

```bash
node src/index.js
```

This runs all evaluation suites (path-within, perm-change, priv-esc, and git-mut) and prints results to stdout.

### Options

```bash
node src/index.js [options]

Options:
  --scoped        Run only the scoped question
  --perm-change   Run only the permission-change question
  --priv-esc      Run only the privilege-escalation question
  --git-mut       Run only the git mutation question
  --all           Run all evaluation suites
  -c, --command   Evaluate a custom command (can be repeated)
  -h, --help      Show help
```

Examples:

```bash
# Run only the scoped question
node src/index.js --scoped

# Run all suites
node src/index.js --all

# Evaluate a custom command
node src/index.js -c "rm -rf node_modules"

# Evaluate multiple custom commands
node src/index.js -c "cat /etc/passwd" -c "git reset --hard HEAD"
```

### Environment variables

| Variable | Description | Default |
|---|---|---|
| `KEV_URL` | Kev server endpoint | `http://localhost:8009/v1/systemone` |
| `KEV_API_KEY` | API key (if server requires auth) | _(none)_ |
| `MODEL` | Model name | `kev-latest` |
| `FETCH_TIMEOUT_MS` | Request timeout in milliseconds | `30000` |

## How it works

1. **Path resolution** — Each command is scanned for path-like tokens. Virtual routes and environment variables are resolved to absolute paths on disk.
2. **API call** — The resolved command, a list of allowed roots, and the execution path are sent to Kev as the `state`. A `choice` question with `true`/`false` criteria asks the model to classify the command.
3. **Results** — The model's probabilities for each answer are printed in a table.

