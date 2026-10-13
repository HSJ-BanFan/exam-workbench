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
  const image = path.join(seed, "90-图片", "Synthetic.md");
  fs.mkdirSync(path.dirname(image));
  fs.writeFileSync(image, "synthetic excluded image fixture\n", "utf8");
  git(["add", "."], seed);
  git(["commit", "-m", "initial synthetic vault"], seed);
  git(["remote", "add", "origin", pathToFileURL(upstream).href], seed);
  git(["push", "--set-upstream", "origin", "main"], seed);
  return { upstream, seed, note };
}

function cloneVault(upstream, vault) {
  git(["clone", "--depth", "1", "--filter=blob:none", "--sparse", pathToFileURL(upstream).href, vault]);
  git(["sparse-checkout", "set", "--no-cone", "/*", "!/90-图片/"], vault);
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
    const { upstream, seed } = createRemote(root);
    const vault = path.join(root, "vault");
    cloneVault(upstream, vault);
    const note = path.join(vault, "20-考点", "Synthetic.md");
    const headBefore = git(["rev-parse", "HEAD"], vault);
    const upstreamBefore = git(["rev-parse", "@{upstream}"], vault);
    const localContent = "# Synthetic local edit\n";
    fs.writeFileSync(note, localContent, "utf8");
    fs.writeFileSync(path.join(seed, "20-考点", "Synthetic.md"), "# Synthetic upstream v2\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "advance synthetic upstream"], seed);
    git(["push", "origin", "main"], seed);

    let failure;
    try {
      await importVault({ dir: vault, repo: pathToFileURL(upstream).href });
    } catch (error) {
      failure = error;
    }

    assert.equal(fs.readFileSync(note, "utf8"), localContent, "refresh must preserve the local note");
    assert.equal(git(["rev-parse", "HEAD"], vault), headBefore);
    assert.equal(git(["rev-parse", "@{upstream}"], vault), upstreamBefore, "dirty refresh must not fetch first");
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
    cloneVault(upstream, vault);
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

test("vault refresh refuses modified files marked assume-unchanged", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream, seed } = createRemote(root);
    const vault = path.join(root, "vault");
    cloneVault(upstream, vault);
    const note = path.join(vault, "20-考点", "Synthetic.md");
    const headBefore = git(["rev-parse", "HEAD"], vault);
    const upstreamBefore = git(["rev-parse", "@{upstream}"], vault);
    const localContent = "# Synthetic assume-unchanged edit\n";
    fs.writeFileSync(note, localContent, "utf8");
    git(["update-index", "--assume-unchanged", "20-考点/Synthetic.md"], vault);
    assert.equal(git(["status", "--porcelain", "--untracked-files=all"], vault), "");

    fs.writeFileSync(path.join(seed, "20-考点", "Synthetic.md"), "# Synthetic upstream v2\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "advance synthetic upstream"], seed);
    git(["push", "origin", "main"], seed);

    let failure;
    try {
      await importVault({ dir: vault, repo: pathToFileURL(upstream).href });
    } catch (error) {
      failure = error;
    }

    assert.match(String(failure?.message ?? ""), /索引标记/);
    assert.equal(fs.readFileSync(note, "utf8"), localContent);
    assert.equal(git(["rev-parse", "HEAD"], vault), headBefore);
    assert.equal(git(["rev-parse", "@{upstream}"], vault), upstreamBefore);
  } finally {
    restoreEnvironment();
  }
});

test("vault refresh refuses assume-unchanged edits under the sparse image directory", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream, seed } = createRemote(root);
    const vault = path.join(root, "vault");
    cloneVault(upstream, vault);
    const relPath = "90-图片/Synthetic.md";
    const image = path.join(vault, relPath);
    const headBefore = git(["rev-parse", "HEAD"], vault);
    const upstreamBefore = git(["rev-parse", "@{upstream}"], vault);
    const localContent = "# Synthetic local image edit\n";
    fs.mkdirSync(path.dirname(image), { recursive: true });
    fs.writeFileSync(image, localContent, "utf8");
    git(["update-index", "--no-skip-worktree", "--assume-unchanged", relPath], vault);
    assert.match(git(["ls-files", "-v", "--", relPath], vault), /^h /);
    assert.equal(git(["status", "--porcelain", "--untracked-files=all"], vault), "");

    fs.writeFileSync(path.join(seed, relPath), "# Synthetic upstream image edit\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "update synthetic image"], seed);
    git(["push", "origin", "main"], seed);

    let failure;
    try {
      await importVault({ dir: vault, repo: pathToFileURL(upstream).href });
    } catch (error) {
      failure = error;
    }

    assert.match(String(failure?.message ?? ""), /索引标记/);
    assert.equal(fs.readFileSync(image, "utf8"), localContent);
    assert.equal(git(["rev-parse", "HEAD"], vault), headBefore);
    assert.equal(git(["rev-parse", "@{upstream}"], vault), upstreamBefore);
  } finally {
    restoreEnvironment();
  }
});

test("vault refresh refuses modified skip-worktree files outside sparse paths", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream, seed } = createRemote(root);
    const relPath = "Synthetic-note.md";
    fs.writeFileSync(path.join(seed, relPath), "# Synthetic initial note\n", "utf8");
    git(["add", relPath], seed);
    git(["commit", "-m", "add synthetic root note"], seed);
    git(["push", "origin", "main"], seed);
    const vault = path.join(root, "vault");
    git(["clone", "--depth", "1", "--filter=blob:none", pathToFileURL(upstream).href, vault]);
    const note = path.join(vault, relPath);
    const headBefore = git(["rev-parse", "HEAD"], vault);
    const upstreamBefore = git(["rev-parse", "@{upstream}"], vault);
    const localContent = "# Synthetic hidden local edit\n";
    git(["update-index", "--skip-worktree", "--", relPath], vault);
    assert.equal(git(["ls-files", "-v", "-z", "--", relPath], vault).slice(0, 1), "S");
    fs.writeFileSync(note, localContent, "utf8");
    assert.equal(git(["status", "--porcelain", "--untracked-files=all"], vault), "");

    fs.writeFileSync(path.join(seed, relPath), "# Synthetic upstream edit\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "update synthetic hidden file"], seed);
    git(["push", "origin", "main"], seed);

    let failure;
    try {
      await importVault({ dir: vault, repo: pathToFileURL(upstream).href });
    } catch (error) {
      failure = error;
    }

    assert.match(String(failure?.message ?? ""), /索引标记/);
    assert.equal(fs.readFileSync(note, "utf8"), localContent);
    assert.equal(git(["rev-parse", "HEAD"], vault), headBefore);
    assert.equal(git(["rev-parse", "@{upstream}"], vault), upstreamBefore);
  } finally {
    restoreEnvironment();
  }
});

test("vault refresh refuses modified skip-worktree files under the sparse image directory", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream, seed } = createRemote(root);
    const vault = path.join(root, "vault");
    git(["clone", "--depth", "1", "--filter=blob:none", pathToFileURL(upstream).href, vault]);
    const relPath = "90-图片/Synthetic.md";
    const image = path.join(vault, relPath);
    const headBefore = git(["rev-parse", "HEAD"], vault);
    const upstreamBefore = git(["rev-parse", "@{upstream}"], vault);
    const localContent = "# Synthetic local sparse image edit\n";
    git(["update-index", "--skip-worktree", "--", relPath], vault);
    assert.match(git(["ls-files", "-v", "--", relPath], vault), /^S /);
    fs.mkdirSync(path.dirname(image), { recursive: true });
    fs.writeFileSync(image, localContent, "utf8");
    assert.match(git(["ls-files", "-v", "--", relPath], vault), /^S /);
    assert.equal(git(["status", "--porcelain", "--untracked-files=all"], vault), "");

    fs.writeFileSync(path.join(seed, relPath), "# Synthetic upstream image update\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "update synthetic sparse image"], seed);
    git(["push", "origin", "main"], seed);

    let failure;
    try {
      await importVault({ dir: vault, repo: pathToFileURL(upstream).href });
    } catch (error) {
      failure = error;
    }

    assert.match(String(failure?.message ?? ""), /索引标记/);
    assert.equal(fs.readFileSync(image, "utf8"), localContent);
    assert.equal(git(["rev-parse", "HEAD"], vault), headBefore);
    assert.equal(git(["rev-parse", "@{upstream}"], vault), upstreamBefore);
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
    cloneVault(upstream, vault);
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
    git(["commit", "-m", "first synthetic update"], seed);
    fs.writeFileSync(path.join(seed, "20-考点", "Synthetic.md"), "# Synthetic upstream v3\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "second synthetic update"], seed);
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
    assert.match(String(failure?.message ?? ""), /未推送的本地提交/);
  } finally {
    restoreEnvironment();
  }
});

test("clean shallow vault behind an already-fetched upstream still refreshes", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream, seed } = createRemote(root);
    const vault = path.join(root, "vault");
    cloneVault(upstream, vault);
    fs.writeFileSync(path.join(seed, "20-考点", "Synthetic.md"), "# Synthetic upstream v2\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "first synthetic update"], seed);
    fs.writeFileSync(path.join(seed, "20-考点", "Synthetic.md"), "# Synthetic upstream v3\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "second synthetic update"], seed);
    git(["push", "origin", "main"], seed);
    git(["fetch", "origin"], vault);
    const headBefore = git(["rev-parse", "HEAD"], vault);
    const trackingHead = git(["rev-parse", "@{upstream}"], vault);
    assert.notEqual(headBefore, trackingHead);

    let result;
    let failure;
    try {
      result = await importVault({ dir: vault, repo: pathToFileURL(upstream).href });
    } catch (error) {
      failure = error;
    }

    assert.equal(failure, undefined, `clean behind-upstream refresh failed: ${failure?.message ?? "unknown error"}`);
    assert.equal(result.commit, trackingHead);
    assert.equal(fs.readFileSync(path.join(vault, "20-考点", "Synthetic.md"), "utf8"), "# Synthetic upstream v3\n");
    assert.equal(git(["for-each-ref", "--format=%(refname)", "refs/exam-workbench/naoku-refresh"], vault), "");
  } finally {
    restoreEnvironment();
  }
});

test("refresh follows the configured upstream when origin has a custom fetch refspec", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream, seed } = createRemote(root);
    const vault = path.join(root, "vault");
    cloneVault(upstream, vault);
    const note = path.join(seed, "20-考点", "Synthetic.md");

    git(["checkout", "-b", "feature"], seed);
    fs.writeFileSync(note, "# Synthetic feature branch\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "advance synthetic feature"], seed);
    git(["push", "--set-upstream", "origin", "feature"], seed);
    const featureHead = git(["rev-parse", "HEAD"], seed);

    git(["checkout", "main"], seed);
    fs.writeFileSync(note, "# Synthetic main branch v2\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "advance synthetic main"], seed);
    git(["push", "origin", "main"], seed);
    const mainHead = git(["rev-parse", "HEAD"], seed);
    git(["config", "--unset-all", "remote.origin.fetch"], vault);
    git(["config", "--add", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/main"], vault);
    git(["config", "--add", "remote.origin.fetch", "+refs/heads/feature:refs/remotes/origin/feature"], vault);

    const result = await importVault({ dir: vault, repo: pathToFileURL(upstream).href });

    assert.equal(result.commit, mainHead);
    assert.notEqual(result.commit, featureHead);
    assert.equal(git(["rev-parse", "@{upstream}"], vault), mainHead);
    assert.equal(fs.readFileSync(path.join(vault, "20-考点", "Synthetic.md"), "utf8"), "# Synthetic main branch v2\n");
  } finally {
    restoreEnvironment();
  }
});

test("refresh stops when the upstream has unrelated history", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream, seed } = createRemote(root);
    const vault = path.join(root, "vault");
    cloneVault(upstream, vault);
    const headBefore = git(["rev-parse", "HEAD"], vault);
    const upstreamBefore = git(["rev-parse", "@{upstream}"], vault);
    const replacement = path.join(root, "replacement");
    fs.mkdirSync(replacement);
    git(["init", "--initial-branch=main"], replacement);
    git(["config", "user.name", "Synthetic Test"], replacement);
    git(["config", "user.email", "synthetic@example.invalid"], replacement);
    const replacementNote = path.join(replacement, "Replacement.md");
    fs.writeFileSync(replacementNote, "# Synthetic unrelated history\n", "utf8");
    git(["add", "."], replacement);
    git(["commit", "-m", "replace synthetic history"], replacement);
    git(["remote", "add", "origin", pathToFileURL(upstream).href], replacement);
    git(["push", "--force", "origin", "main"], replacement);

    let failure;
    try {
      await importVault({ dir: vault, repo: pathToFileURL(upstream).href });
    } catch (error) {
      failure = error;
    }

    assert.match(String(failure?.message ?? ""), /不是快进关系/);
    assert.equal(git(["rev-parse", "HEAD"], vault), headBefore);
    assert.equal(git(["rev-parse", "@{upstream}"], vault), upstreamBefore);
    assert.equal(git(["for-each-ref", "--format=%(refname)", "refs/exam-workbench/naoku-refresh"], vault), "");
    assert.equal(fs.readFileSync(path.join(vault, "20-考点", "Synthetic.md"), "utf8"), "# Synthetic upstream v1\n");
  } finally {
    restoreEnvironment();
  }
});

test("refresh preserves an ignored local file that upstream starts tracking", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream, seed } = createRemote(root);
    const vault = path.join(root, "vault");
    cloneVault(upstream, vault);
    const localOnly = path.join(vault, "20-考点", "Added.md");
    const excludePath = path.join(vault, ".git", "info", "exclude");
    fs.appendFileSync(excludePath, "\n20-考点/Added.md\n", "utf8");
    const localContent = "# Synthetic ignored local file\n";
    fs.writeFileSync(localOnly, localContent, "utf8");
    assert.equal(git(["status", "--porcelain", "--untracked-files=all"], vault), "");
    const headBefore = git(["rev-parse", "HEAD"], vault);

    fs.writeFileSync(path.join(seed, "20-考点", "Added.md"), "# Synthetic upstream file\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "add synthetic upstream file"], seed);
    git(["push", "origin", "main"], seed);

    let result;
    let failure;
    try {
      result = await importVault({ dir: vault, repo: pathToFileURL(upstream).href });
    } catch (error) {
      failure = error;
    }

    assert.ok(failure, "refresh must stop when an ignored local file conflicts with upstream");
    assert.equal(fs.readFileSync(localOnly, "utf8"), localContent);
    assert.equal(git(["rev-parse", "HEAD"], vault), headBefore);
    assert.equal(result, undefined);
    assert.match(String(failure?.message ?? ""), /被忽略本地文件与远端路径冲突/);
  } finally {
    restoreEnvironment();
  }
});

test("refresh detects ignored paths beginning with Unicode whitespace", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream, seed } = createRemote(root);
    const vault = path.join(root, "vault");
    cloneVault(upstream, vault);
    const relPath = "\u2003Local.md";
    const localPath = path.join(vault, relPath);
    fs.appendFileSync(path.join(vault, ".git", "info", "exclude"), `\n${relPath}\n`, "utf8");
    const localContent = "# Synthetic Unicode whitespace path\n";
    fs.writeFileSync(localPath, localContent, "utf8");
    const headBefore = git(["rev-parse", "HEAD"], vault);

    const upstreamPath = path.join(seed, relPath);
    fs.writeFileSync(upstreamPath, "# Synthetic upstream file\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "add synthetic whitespace path"], seed);
    git(["push", "origin", "main"], seed);

    let failure;
    try {
      await importVault({ dir: vault, repo: pathToFileURL(upstream).href });
    } catch (error) {
      failure = error;
    }

    assert.match(String(failure?.message ?? ""), /被忽略本地文件与远端路径冲突/);
    assert.equal(fs.readFileSync(localPath, "utf8"), localContent);
    assert.equal(git(["rev-parse", "HEAD"], vault), headBefore);
  } finally {
    restoreEnvironment();
  }
});

test("refresh preserves an unrelated ignored local file", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream, seed } = createRemote(root);
    const vault = path.join(root, "vault");
    cloneVault(upstream, vault);
    const localOnly = path.join(vault, "20-考点", "Local.md");
    fs.appendFileSync(path.join(vault, ".git", "info", "exclude"), "\n20-考点/Local.md\n", "utf8");
    const localContent = "# Synthetic unrelated local file\n";
    fs.writeFileSync(localOnly, localContent, "utf8");

    fs.writeFileSync(path.join(seed, "20-考点", "Synthetic.md"), "# Synthetic upstream v2\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "update synthetic vault"], seed);
    git(["push", "origin", "main"], seed);

    const result = await importVault({ dir: vault, repo: pathToFileURL(upstream).href });

    assert.equal(result.commit, git(["rev-parse", "HEAD"], seed));
    assert.equal(fs.readFileSync(localOnly, "utf8"), localContent);
    assert.equal(fs.readFileSync(path.join(vault, "20-考点", "Synthetic.md"), "utf8"), "# Synthetic upstream v2\n");
  } finally {
    restoreEnvironment();
  }
});

test("refresh preserves an ignored local directory that conflicts with an upstream file", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream, seed } = createRemote(root);
    const vault = path.join(root, "vault");
    cloneVault(upstream, vault);
    const localDir = path.join(vault, "20-考点", "Local");
    const localNote = path.join(localDir, "Private.md");
    fs.appendFileSync(path.join(vault, ".git", "info", "exclude"), "\n20-考点/Local/\n", "utf8");
    fs.mkdirSync(localDir);
    const localContent = "# Synthetic ignored directory file\n";
    fs.writeFileSync(localNote, localContent, "utf8");
    assert.equal(git(["status", "--porcelain", "--untracked-files=all"], vault), "");

    const upstreamNote = path.join(seed, "20-考点", "Local", "Added.md");
    fs.mkdirSync(path.dirname(upstreamNote));
    fs.writeFileSync(upstreamNote, "# Synthetic upstream nested file\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "add synthetic nested file"], seed);
    git(["push", "origin", "main"], seed);

    let failure;
    try {
      await importVault({ dir: vault, repo: pathToFileURL(upstream).href });
    } catch (error) {
      failure = error;
    }

    assert.match(String(failure?.message ?? ""), /被忽略本地文件与远端路径冲突/);
    assert.equal(fs.readFileSync(localNote, "utf8"), localContent);
    assert.equal(fs.existsSync(upstreamNote.replace(path.join(seed), path.join(vault))), false);
  } finally {
    restoreEnvironment();
  }
});

test("refresh skips ignored paths excluded by the sparse image rule", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream, seed } = createRemote(root);
    const vault = path.join(root, "vault");
    cloneVault(upstream, vault);
    const imagePath = path.join(vault, "90-图片", "Added.md");
    fs.appendFileSync(path.join(vault, ".git", "info", "exclude"), "\n90-图片/Added.md\n", "utf8");
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    const localContent = "# Synthetic local excluded file\n";
    fs.writeFileSync(imagePath, localContent, "utf8");

    const upstreamImage = path.join(seed, "90-图片", "Added.md");
    fs.writeFileSync(upstreamImage, "# Synthetic upstream excluded file\n", "utf8");
    git(["add", "."], seed);
    git(["commit", "-m", "add synthetic excluded path"], seed);
    git(["push", "origin", "main"], seed);

    const result = await importVault({ dir: vault, repo: pathToFileURL(upstream).href });

    assert.equal(result.commit, git(["rev-parse", "HEAD"], seed));
    assert.equal(fs.readFileSync(imagePath, "utf8"), localContent);
    assert.equal(fs.existsSync(path.join(vault, "20-考点", "Synthetic.md")), true);
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
    cloneVault(upstream, vault);

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

test("existing vault refuses refresh when configured repo differs from origin", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream } = createRemote(root);
    const vault = path.join(root, "vault");
    cloneVault(upstream, vault);
    const headBefore = git(["rev-parse", "HEAD"], vault);
    const upstreamBefore = git(["rev-parse", "@{upstream}"], vault);
    const originBefore = git(["remote", "get-url", "origin"], vault);
    const otherRepo = pathToFileURL(path.join(root, "other-repo.git")).href;

    let failure;
    try {
      await importVault({ dir: vault, repo: otherRepo });
    } catch (error) {
      failure = error;
    }

    assert.match(String(failure?.message ?? ""), /origin 与配置的脑库源不一致/);
    assert.equal(git(["rev-parse", "HEAD"], vault), headBefore);
    assert.equal(git(["rev-parse", "@{upstream}"], vault), upstreamBefore);
    assert.equal(git(["remote", "get-url", "origin"], vault), originBefore);
  } finally {
    restoreEnvironment();
  }
});

test("existing vault refuses refresh when origin has an additional fetch URL", async (t) => {
  const root = tempRoot(t);
  const restoreEnvironment = isolateGitEnvironment(root);
  try {
    const { upstream } = createRemote(root);
    const vault = path.join(root, "vault");
    cloneVault(upstream, vault);
    const otherRepo = pathToFileURL(path.join(root, "other-repo.git")).href;
    git(["remote", "set-url", "--add", "origin", otherRepo], vault);
    const headBefore = git(["rev-parse", "HEAD"], vault);
    const upstreamBefore = git(["rev-parse", "@{upstream}"], vault);

    let failure;
    try {
      await importVault({ dir: vault, repo: pathToFileURL(upstream).href });
    } catch (error) {
      failure = error;
    }

    assert.match(String(failure?.message ?? ""), /origin 与配置的脑库源不一致/);
    assert.equal(git(["rev-parse", "HEAD"], vault), headBefore);
    assert.equal(git(["rev-parse", "@{upstream}"], vault), upstreamBefore);
    assert.deepEqual(git(["remote", "get-url", "--all", "origin"], vault).split(/\r?\n/), [
      pathToFileURL(upstream).href,
      otherRepo,
    ]);
  } finally {
    restoreEnvironment();
  }
});
