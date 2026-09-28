import { execSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

/**
 * 用 GitHub contents API 把 dist/ 全量发布到 gh-pages（代理挂掉、git push 502 时的通道）。
 * 用法：先 npm run build && touch dist/.nojekyll，再 node scripts/publish-gh-pages-api.mjs
 *
 * 踩过的坑（都写在这儿，别再踩）：
 *  1. trees API 每次只写入极少数条目（实测 7/137 就被静默截断）→ 不要用它做全量建树。
 *  2. contents PUT 对**已存在**文件必须带 sha，否则 422 "sha wasn't supplied"；
 *     对不存在的文件则不能带 sha。所以每次写入前先 GET 当前 sha。
 *  3. contents 每写一个文件都会产生新 commit 并推进 ref，**任何并发都会 409**，
 *     必须严格串行；遇到 409/5xx 重新取 sha 重试。
 */
const REPO = 'bailihongxi/wholesale-erp'
const API = `https://api.github.com/repos/${REPO}`
// 项目根的 dist（脚本放在 scripts/ 下，向上两级即项目根）
const DIST = path.resolve(new URL('.', import.meta.url).pathname, '../dist')
const BRANCH = 'gh-pages'

const token = execSync('gh auth token').toString().trim()
const H = { Authorization: `Bearer ${token}`, 'User-Agent': 'erp-publish', 'Content-Type': 'application/json' }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const j = async (url, init = {}) => {
  const r = await fetch(url, { headers: H, ...init })
  const t = await r.text()
  if (r.ok) return t ? JSON.parse(t) : null
  const err = new Error(`${r.status} ${init.method || 'GET'} ${url}\n${t.slice(0, 200)}`)
  err.status = r.status
  throw err
}

function walk(dir, base = '') {
  const out = []
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name === '.git') continue
    const p = path.join(dir, f.name)
    const rel = base ? `${base}/${f.name}` : f.name
    f.isDirectory() ? out.push(...walk(p, rel)) : out.push([rel, p])
  }
  return out
}
const localArr = walk(DIST)
const local = new Map(localArr.map(([rel, abs]) => {
  const buf = fs.readFileSync(abs)
  return [rel, { abs, sha: crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex') }]
}))

const remoteBlobs = async () => {
  const refSha = (await j(`${API}/git/refs/heads/${BRANCH}`)).object.sha
  const treeSha = (await j(`${API}/git/commits/${refSha}`)).tree.sha
  const t = await j(`${API}/git/trees/${treeSha}?recursive=1`)
  return new Map(t.tree.filter(e => e.type === 'blob').map(e => [e.path, e.sha]))
}

let remote = await remoteBlobs()
console.log(`远端 ${remote.size} 文件 | 本地 ${local.size} 文件`)

const putFile = async (rel) => {
  const b64 = fs.readFileSync(local.get(rel).abs).toString('base64')
  for (let i = 0; i < 4; i++) {
    let sha = null
    try { sha = (await j(`${API}/contents/${rel}?ref=${BRANCH}`)).sha } catch (e) { if (e.status !== 404) throw e }
    const body = { message: `deploy: 更新 ${rel}`, content: b64, branch: BRANCH }
    if (sha) body.sha = sha
    try { await j(`${API}/contents/${rel}`, { method: 'PUT', body: JSON.stringify(body) }); return }
    catch (e) { if (i === 3) throw e; await sleep(900 * (i + 1)) }
  }
}

const delFile = async (p) => {
  for (let i = 0; i < 4; i++) {
    let sha = null
    try { sha = (await j(`${API}/contents/${p}?ref=${BRANCH}`)).sha } catch (e) { if (e.status === 404) return; throw e }
    try { await j(`${API}/contents/${p}`, { method: 'DELETE', body: JSON.stringify({ message: `chore: 清理旧产物 ${p}`, sha, branch: BRANCH }) }); return }
    catch (e) { if (i === 3) throw e; await sleep(900 * (i + 1)) }
  }
}

const toPut = [...local.keys()].filter(rel => remote.get(rel) !== local.get(rel).sha)
const toDel = [...remote.keys()].filter(p => !local.has(p))
console.log(`需写入 ${toPut.length} | 需删除 ${toDel.length}`)

let ok = 0, fail = []
for (const rel of toPut) {
  try { await putFile(rel); ok++ } catch (e) { fail.push(`${rel}: ${String(e.message).slice(0, 120)}`) }
  process.stdout.write(`\r写入 ${ok}/${toPut.length}${fail.length ? ` 失败 ${fail.length}` : ''}   `)
}
console.log()

let dok = 0
for (const p of toDel) {
  try { await delFile(p); dok++ } catch (e) { fail.push(`del ${p}: ${String(e.message).slice(0, 120)}`) }
  process.stdout.write(`\r删除 ${dok}/${toDel.length}${fail.length ? ` 失败 ${fail.length}` : ''}   `)
}
console.log()

remote = await remoteBlobs()
const stillDiff = [...local.keys()].filter(rel => remote.get(rel) !== local.get(rel).sha)
const stillExtra = [...remote.keys()].filter(p => !local.has(p))
console.log(`\n复验：远端 ${remote.size} | 本地 ${local.size} | 内容不一致 ${stillDiff.length} | 多余残留 ${stillExtra.length}`)
if (stillDiff.length) console.log('不一致:', stillDiff.slice(0, 10).join(', '))
if (stillExtra.length) console.log('残留:', stillExtra.slice(0, 10).join(', '))
if (fail.length) { console.log('失败明细:'); fail.slice(0, 10).forEach(f => console.log('  ' + f)) }
if (!stillDiff.length && !stillExtra.length && !fail.length) console.log('✅ 线上产物与本地 dist 完全一致')
