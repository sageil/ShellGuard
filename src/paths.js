import { mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();

export const resolvePath = (target) => {
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

export const createRoots = (cwd) => {
  const configRoot = path.join(home, ".config", "myapp");
  const dataRoot = path.join(home, ".local", "share", "myapp");
  const contextRoot = path.join(dataRoot, "context");

  return {
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
};

export const VIRTUAL_ROUTES = [
  [/^\/large_tool_results(?:\/|$)/, "largeToolResultsRoot"],
  [/^\/conversation-history(?:\/|$)/, "conversationHistoryRoot"],
];

export const resolveToken = (token, roots) => {
  if (!token) return undefined;
  const virtual = VIRTUAL_ROUTES.find(([pattern]) => pattern.test(token));
  if (virtual) return resolvePath(path.join(roots[virtual[1]], token.replace(virtual[0], "")));
  if (!/\$\{?MYAPP_(SCRATCH_DIR|WORKSPACE_ROOT)\}?/g.test(token)) return undefined;
  return resolvePath(
    token
      .replace(/\$\{?MYAPP_SCRATCH_DIR\}?/g, roots.scratchRoot)
      .replace(/\$\{?MYAPP_WORKSPACE_ROOT\}?/g, roots.workspaceRoot),
  );
};

export const isPathLike = (word) => /[/~$]/.test(word);

export const extractTokens = (command) => {
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

export const resolveCommand = (command, roots) => {
  const tokens = extractTokens(command).sort((a, b) => b.length - a.length);
  let resolved = command;
  for (const token of tokens) {
    const target = resolveToken(token, roots);
    if (target) resolved = resolved.split(token).join(target);
  }
  return resolved;
};
