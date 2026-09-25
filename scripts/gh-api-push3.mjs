// gh-api-push3.mjs — 代理挂掉时经 api.github.com 推单个提交（含 blob/tree）+ 轻量 tag
// 用法: node gh-api-push3.mjs <commit-sha> <branch> <tag>
import { execFileSync, execSync } from 'node:child_process'

const [sha, branch, tag] = process.argv.slice(2)
const REPO = 'bailihongxi/wholesale-erp'

function gh(path, method, input) {
  const args = ['api', `repos/${REPO}/${path}`]
  if (method) args.push('-X', method)
  if (input) args.push('--input', '-')
  const out = execFileSync('gh', args, {
    input: input ? JSON.stringify(input) : undefined,
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.length ? JSON.parse(out.toString()) : null
}

const G = ['-c', 'core.quotepath=false']

function readCommit(s) {
  const raw = execFileSync('git', [...G, 'cat-file', 'commit', s]).toString('utf8')
  const lines = raw.split('\n')
  let i = 0
  const header = {}
  const parents = []
  while (i < lines.length && lines[i] !== '') {
    const m = lines[i].match(/^(\w+) (.*)$/)
    if (!m) break
    if (m[1] === 'parent') parents.push(m[2])
    else if (m[1] !== 'tree') header[m[1]] = m[2]
    i++
  }
  const message = lines.slice(i + 1).join('\n')
  const parse = (h) => {
    const m = h.match(/^(.*) <(.*)> (\d+) ([+-]\d{4})$/)
    const epoch = Number(m[3])
    const offset = m[4]
    const sign = offset[0] === '-' ? -1 : 1
    const hh = Number(offset.slice(1, 3)) * sign
    const mm = Number(offset.slice(3, 5)) * sign
    const iso = new Date((epoch + hh * 3600 + mm * 60) * 1000)
      .toISOString()
      .replace('Z', `${offset.slice(0, 3)}:${offset.slice(3)}`)
    return { name: m[1], email: m[2], date: iso }
  }
  return {
    tree: lines[0].match(/^tree (.*)$/)[1],
    parents,
    message,
    author: parse(header.author),
    committer: parse(header.committer),
  }
}

const c = readCommit(sha)
const parentTree = readCommit(c.parents[0]).tree
console.log('commit:', sha, '| tree:', c.tree, '| parent:', c.parents[0])

// 1) 找出该提交相对父提交变化的文件，逐个建 blob（未变的直接引用父 tree 已有对象）
const changed = execFileSync('git', [...G, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', sha])
  .toString()
  .split('\0')
  .map((s) => s.replace(/^"(.*)"$/, '$1'))
  .filter(Boolean)
console.log('变化文件:', changed.length)

const entries = []
for (const p of changed) {
  const mode = execFileSync('git', [...G, 'ls-tree', sha, '--', p]).toString().split('\t')[0].split(' ')[0]
  const localBlob = execFileSync('git', [...G, 'rev-parse', `${sha}:${p}`]).toString().trim()
  let remoteBlob
  try {
    remoteBlob = gh(`git/blobs/${localBlob}`, 'GET', null).sha
    console.log(`  = ${p}（远端已有）`)
  } catch {
    const content = execFileSync('git', [...G, 'cat-file', 'blob', localBlob]).toString('binary')
    remoteBlob = gh('git/blobs', 'POST', {
      content: Buffer.from(content, 'binary').toString('base64'),
      encoding: 'base64',
    }).sha
    console.log(`  + ${p} → ${remoteBlob}`)
  }
  entries.push({ path: p, mode, type: 'blob', sha: remoteBlob })
}

// 2) 基于父提交的 tree 建新树
const tree = gh('git/trees', 'POST', { base_tree: parentTree, tree: entries })
console.log('新树:', tree.sha)
if (tree.sha !== c.tree) {
  console.error(`❌ 树 SHA 不一致：远端 ${tree.sha} ≠ 本地 ${c.tree}，中止`)
  process.exit(1)
}

// 3) 建提交（SHA 必须与本地一致才动 ref）
const created = gh('git/commits', 'POST', {
  message: c.message,
  tree: c.tree,
  parents: c.parents,
  author: c.author,
  committer: c.committer,
})
console.log('远端 commit:', created.sha)
if (created.sha !== sha) {
  console.error(`❌ 提交 SHA 不一致：远端 ${created.sha} ≠ 本地 ${sha}，中止（不更新 ref）`)
  process.exit(1)
}

const ref = gh(`git/refs/heads/${branch}`, 'PATCH', { sha, force: true })
console.log(`✅ ${branch} → ${ref.object.sha}`)

try {
  gh('git/refs', 'POST', { ref: `refs/tags/${tag}`, sha })
  console.log(`✅ tag ${tag} → ${sha}（轻量）`)
} catch (e) {
  console.log(`tag ${tag}: ${/422/.test(String(e)) ? '已存在' : '失败 ' + e.message}`)
}
