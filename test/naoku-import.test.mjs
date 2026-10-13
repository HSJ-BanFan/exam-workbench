import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { importVault } from "../src/naoku.mjs";

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function isolateGitEnvironment(root) {
  const original = new Map();
  for (const key of Object.keys(process.env)) {
    if (key.toUpperCase().startsWith("GIT_")) {
      original.set(key, process.env[key]);
      delete process.env[key];
    }
  }

  const config = path.join(root, "gitconfig");
  fs.writeFileSync(config, "[commit]\n  gpgSign = false\n", "utf8");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_CONFIG_GLOBAL = config;
  process.env.GIT_TERMINAL_PROMPT = "0";
  process.env.GIT_ALLOW_PROTOCOL = "file";

  return () => {
    for (const key of Object.keys(process.env)) {
      if (key.toUpperCase().startsWith("GIT_")) delete process.env[key];
    }
    for (const [key, value] of original) process.env[key] = value;
  };
}

function createRemote(root) {
  const upstream = path.join(root, "upstream.git");
  const seed = path.join(root, "seed");
  fs.mkdirSync(seed);
  git(["init", "--bare", "--initial-branch=main", upstream]);
  git(["init", "--initial-branch=main", seed]);
  git(["config", "user.name", "Synthetic Test"], seed);
  git(["config", "user.email", "synthetic@example.invalid"], seed);
  const note = path.join(seed, "20-考点", "Synthetic.md");
  fs.mkdirSync(path.dirname(note));
  fs.writeFileSync(note, "# Synthetic upstream v1\n", "utf8");
  git(["add", "."], seed);
  git(["commit", "-m", "initial synthetic vault"], seed);
  git(["remote", "add", "origin", pathToFileURL(upstream).href], seed);
  git(["push", "--set-upstream", "origin", "main"], seed);
  return { upstream, seed, note };
}

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exam-workbench-naoku-import-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("dirty vault refresh rejects before replacing local edits", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream } = createRemote(root);
    const vault = path.join(root, "vault");
    git(["clone", pathToFileURL(upstream).href, vault]);
    const note = path.join(vault, "20-考点", "Synthetic.md");
    const headBefore = git(["rev-parse", "HEAD"], vault);
    const localContent = "# Synthetic local edit\n";
    fs.writeFileSync(note, localContent, "utf8");

    let failure;
    try {
      await importVault({ dir: vault, repo: pathToFileURL(upstream).href });
    } catch (error) {
      failure = error;
    }

    assert.equal(fs.readFileSync(note, "utf8"), localContent, "refresh must preserve the local note");
    assert.equal(git(["rev-parse", "HEAD"], vault), headBefore);
    assert.notEqual(git(["status", "--porcelain"], vault), "");
    assert.equal(git(["remote", "get-url", "origin"], vault), pathToFileURL(upstream).href);
    assert.match(String(failure?.message ?? ""), /未提交的本地改动/);

  } finally {
    restoreEnvironment();
  }
});

test("staged vault refresh rejects without clearing the index", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream } = createRemote(root);
    const vault = path.join(root, "vault");
    git(["clone", pathToFileURL(upstream).href, vault]);
    const note = path.join(vault, "20-考点", "Synthetic.md");
    const stagedContent = "# Synthetic staged edit\n";
    fs.writeFileSync(note, stagedContent, "utf8");
    git(["add", "20-考点/Synthetic.md"], vault);
    const headBefore = git(["rev-parse", "HEAD"], vault);

    let failure;
    try {
      await importVault({ dir: vault, repo: pathToFileURL(upstream).href });
    } catch (error) {
      failure = error;
    }

    assert.equal(fs.readFileSync(note, "utf8"), stagedContent);
    assert.equal(git(["show", ":20-考点/Synthetic.md"], vault), stagedContent.trim());
    assert.equal(git(["rev-parse", "HEAD"], vault), headBefore);
    assert.match(git(["status", "--porcelain"], vault), /^M /);
    assert.match(String(failure?.message ?? ""), /未提交的本地改动/);
  } finally {
    restoreEnvironment();
  }
});

test("vault refresh rejects local commits that differ from the tracked upstream", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream, seed } = createRemote(root);
    const vault = path.join(root, "vault");
    git(["clone", pathToFileURL(upstream).href, vault]);
    git(["config", "user.name", "Synthetic Test"], vault);
    git(["config", "user.email", "synthetic@example.invalid"], vault);
    const note = path.join(vault, "20-考点", "Synthetic.md");
    const trackedHeadBefore = git(["rev-parse", "@{upstream}"], vault);
    const localContent = "# Synthetic committed local edit\n";
    fs.writeFileSync(note, localContent, "utf8");
    git(["add", "20-考点/Synthetic.md"], vault);
    git(["commit", "-m", "synthetic local edit"], vault);
    const localHead = git(["rev-parse", "HEAD"], vault);

    fs.writeFileSync(path.join(seed, "20-考点", "Synthetic.md"), "# Synthetic upstream v2\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "update synthetic vault"], seed);
    git(["push", "origin", "main"], seed);

    let failure;
    try {
      await importVault({ dir: vault, repo: pathToFileURL(upstream).href });
    } catch (error) {
      failure = error;
    }

    assert.equal(fs.readFileSync(note, "utf8"), localContent);
    assert.equal(git(["rev-parse", "HEAD"], vault), localHead);
    assert.equal(git(["rev-parse", "@{upstream}"], vault), trackedHeadBefore);
    assert.match(String(failure?.message ?? ""), /当前版本与跟踪的远端版本不一致/);
  } finally {
    restoreEnvironment();
  }
});

test("clean vault refresh still advances to the upstream commit", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream, seed } = createRemote(root);
    const vault = path.join(root, "vault");
    git(["clone", pathToFileURL(upstream).href, vault]);

    fs.writeFileSync(path.join(seed, "20-考点", "Synthetic.md"), "# Synthetic upstream v2\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "update synthetic vault"], seed);
    git(["push", "origin", "main"], seed);
    const expectedHead = git(["rev-parse", "HEAD"], seed);

    const result = await importVault({ dir: vault, repo: pathToFileURL(upstream).href });

    assert.equal(result.ok, true);
    assert.equal(result.commit, expectedHead);
    assert.equal(fs.readFileSync(path.join(vault, "20-考点", "Synthetic.md"), "utf8"), "# Synthetic upstream v2\n");
  } finally {
    restoreEnvironment();
  }
});
