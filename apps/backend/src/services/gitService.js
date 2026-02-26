import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import fs from 'fs';
import path from 'path';

const DEFAULT_GITIGNORE = `.compile/
*.pdf
*.aux
*.log
*.synctex.gz
*.fls
*.fdb_latexmk
*.out
*.bbl
*.blg
*.toc
*.lof
*.lot
git-remote.json
`;

export async function isGitRepo(dir) {
  try {
    await git.resolveRef({ fs, dir, ref: 'HEAD' });
    return true;
  } catch {
    return false;
  }
}

export async function initRepo(dir) {
  await git.init({ fs, dir });
  const gitignorePath = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, DEFAULT_GITIGNORE, 'utf8');
  }
  // Initial commit
  await git.add({ fs, dir, filepath: '.gitignore' });
  await git.commit({
    fs, dir,
    message: 'Initial commit',
    author: { name: 'Manuscripta', email: 'manuscripta@local' },
  });
}

export async function getStatus(dir) {
  const matrix = await git.statusMatrix({ fs, dir });
  return matrix
    .filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1))
    .map(([filepath, head, workdir, stage]) => {
      let status = 'unmodified';
      if (head === 0 && workdir === 2 && stage === 0) status = 'new';
      else if (head === 0 && workdir === 2 && stage === 2) status = 'added';
      else if (head === 0 && workdir === 2 && stage === 3) status = 'added-modified';
      else if (head === 1 && workdir === 2 && stage === 1) status = 'modified';
      else if (head === 1 && workdir === 2 && stage === 2) status = 'modified';
      else if (head === 1 && workdir === 2 && stage === 3) status = 'modified-staged';
      else if (head === 1 && workdir === 0 && stage === 0) status = 'deleted';
      else if (head === 1 && workdir === 0 && stage === 1) status = 'deleted';
      else if (head === 0 && workdir === 0 && stage === 3) status = 'added-deleted';
      else status = `${head}${workdir}${stage}`;
      return { filepath, status };
    });
}

export async function commitAll(dir, { message, authorName, authorEmail }) {
  // Stage all changes
  const matrix = await git.statusMatrix({ fs, dir });
  for (const [filepath, head, workdir] of matrix) {
    if (workdir === 0) {
      await git.remove({ fs, dir, filepath });
    } else if (head !== workdir) {
      await git.add({ fs, dir, filepath });
    }
  }

  const sha = await git.commit({
    fs, dir,
    message: message || 'Update',
    author: {
      name: authorName || 'Manuscripta User',
      email: authorEmail || 'user@manuscripta.local',
    },
  });
  return sha;
}

export async function getLog(dir, depth = 20) {
  const commits = await git.log({ fs, dir, depth });
  return commits.map(c => ({
    oid: c.oid,
    message: c.commit.message,
    author: c.commit.author.name,
    email: c.commit.author.email,
    timestamp: c.commit.author.timestamp,
  }));
}

export async function getDiff(dir, oid1, oid2) {
  const TREE = git.TREE;
  const trees = [TREE({ ref: oid1 }), TREE({ ref: oid2 })];
  const diffs = [];

  await git.walk({
    fs, dir, trees,
    map: async function (filepath, [A, B]) {
      if (filepath === '.') return;
      const aType = A ? await A.type() : null;
      const bType = B ? await B.type() : null;
      if (aType === 'tree' || bType === 'tree') return;

      const aOid = A ? await A.oid() : null;
      const bOid = B ? await B.oid() : null;
      if (aOid === bOid) return;

      let aContent = '';
      let bContent = '';
      try {
        if (A) {
          const blob = await A.content();
          if (blob) aContent = new TextDecoder().decode(blob);
        }
      } catch { /* binary */ }
      try {
        if (B) {
          const blob = await B.content();
          if (blob) bContent = new TextDecoder().decode(blob);
        }
      } catch { /* binary */ }

      let status = 'modified';
      if (!aOid) status = 'added';
      else if (!bOid) status = 'deleted';

      diffs.push({ filepath, status, before: aContent, after: bContent });
    },
  });

  return diffs;
}

export async function listBranches(dir) {
  const branches = await git.listBranches({ fs, dir });
  const current = await git.currentBranch({ fs, dir });
  return { branches, current };
}

export async function createBranch(dir, name) {
  await git.branch({ fs, dir, ref: name });
}

export async function checkoutBranch(dir, name) {
  await git.checkout({ fs, dir, ref: name });
}

export async function push(dir, { remoteUrl, branch, username, token }) {
  await git.push({
    fs, http, dir,
    remote: 'origin',
    ref: branch || 'main',
    url: remoteUrl,
    onAuth: () => ({ username: username || token, password: token }),
  });
}

export async function pull(dir, { remoteUrl, branch, username, token, authorName, authorEmail }) {
  await git.pull({
    fs, http, dir,
    ref: branch || 'main',
    url: remoteUrl,
    singleBranch: true,
    onAuth: () => ({ username: username || token, password: token }),
    author: {
      name: authorName || 'Manuscripta User',
      email: authorEmail || 'user@manuscripta.local',
    },
  });
}

export async function addRemote(dir, url) {
  try {
    await git.addRemote({ fs, dir, remote: 'origin', url });
  } catch {
    await git.deleteRemote({ fs, dir, remote: 'origin' });
    await git.addRemote({ fs, dir, remote: 'origin', url });
  }
}
