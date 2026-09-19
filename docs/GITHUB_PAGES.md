# 部署到 GitHub Pages + 云同步配置

这份文档解决两件事：

1. **把系统部署到 GitHub Pages** —— 手机、电脑打开同一个网址就能用，不需要服务器。
2. **配置云同步** —— 数据加密后存进同一个 GitHub 仓库，换设备或换浏览器时一键恢复。

> 全程只需要：一个 GitHub 账号、一个 Personal Access Token。
> 数据存在浏览器本地（IndexedDB），断网也能用；云同步只是多一份加密备份与迁移通道。

---

## 一、创建仓库

1. 登录 GitHub，右上角 **+ → New repository**。
2. 仓库名随便起，例如 `my-erp`；**建议选 Private**（快照虽然加密，私有更稳妥；
   但注意：免费账号的私有仓库也能开 Pages）。
3. 勾选 **Add a README file**（保证仓库不是空的，接口写入才不会报错），点创建。

记下两样东西：

- 用户名（Owner），如 `zhangsan`
- 仓库名（Repository name），如 `my-erp`

---

## 二、生成 Access Token

1. GitHub 右上角头像 → **Settings** → 左侧最下面 **Developer settings**
   → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**。
2. Note 填 `erp-sync`，过期建议选 **No expiration**（免得同步突然失效）。
3. 权限只勾 **`repo`**（包含 Contents 读写）即可，不要多勾。
4. 点 **Generate token**，**把那串 `ghp_…` 复制下来**——离开页面后就再也看不到了。
   > 若用 Fine-grained token，需要对目标仓库授予 **Contents: Read and write**。

---

## 三、部署页面到 Pages

在项目目录执行：

```bash
npm run deploy git@github.com:zhangsan/my-erp.git gh-pages
# 或者用 https 地址
npm run deploy https://github.com/zhangsan/my-erp.git gh-pages
```

脚本会：构建生产版本 → 把 `dist` 推到仓库的 `gh-pages` 分支（孤儿分支，每次覆盖）。

然后回到 GitHub 仓库页面：**Settings → Pages**（左侧）
- **Source** 选 *Deploy from a branch*
- **Branch** 选 `gh-pages`、目录选 `/(root)` → Save

等 1~2 分钟，访问：

```
https://zhangsan.github.io/my-erp/
```

> **为什么会自动识别仓库？** 页面跑在 `*.github.io` 上时，系统会从网址反推出用户名与仓库名，
> 打开「系统设置 → 云同步 → 同步设置」时前两格已经填好了，你只需补 Token 和口令。

### 不想用脚本？手动上传也行

```bash
npm run build        # 产出 dist 目录
```

把 `dist` 里的**所有文件**（注意还有个隐藏文件 `.nojekyll`）上传到仓库的 `gh-pages` 分支根目录即可。

---

## 四、配置云同步

在任一设备上打开 Pages 网址 → 登录 → **系统设置 → ☁️ 云同步** → 点「⚙️ 同步设置」，填：

| 项目 | 填什么 | 例子 |
|---|---|---|
| GitHub 用户名 | 仓库 Owner | `zhangsan` |
| 仓库名 | Repository name | `my-erp` |
| 分支 | 放快照的分支，一般不动 | `main` |
| 快照路径 | 快照文件在仓库里的位置 | `data/erp-snapshot.json` |
| Access Token | 第二步生成的那串 | `ghp_xxxx…` |
| 同步口令 | **自己想一个，务必牢记** | 至少 6 位 |

点 **保存同步设置** → 点 **测试连接**，看到「连接成功：zhangsan/my-erp」就说明配置没问题。

然后在另一台设备（或另一个浏览器）上**填完全相同的六项**——尤其是**同一个同步口令**——
点「从云端恢复」即可拿到一模一样的数据。

---

## 五、日常怎么用

| 场景 | 操作 |
|---|---|
| 换了一台电脑 / 手机 | 打开网址 → 填同步配置 → **从云端恢复** |
| 今天录了很多单据 | **同步到云端**（下班前点一次就够） |
| 数据没变还去点上传 | 系统比对指纹后发现一致，提示「云端已是最新」，不会白写一次 |
| 清理了浏览器数据 | 重新填一次配置，从云端恢复即可 |
| 换口令 | 两边都改成新口令后重新上传一次；旧快照用新口令解不开，属正常 |

**注意**：「从云端恢复」是**覆盖式**的——云端快照会整库覆盖本机数据，
点之前系统会再确认一次。如果本机有还没上传的新单据，请先「同步到云端」再恢复。

---

## 六、它是怎么保证安全的

- **加密**：口令经 PBKDF2-SHA256（20 万次迭代）派生密钥，再用 AES-GCM 加密整库 JSON。
  仓库里存的只有密文，**没有口令谁都解不开**，包括把仓库设为 Public 也不怕。
- **口令不上网**：口令只在本机参与密钥派生，从来不发给 GitHub。
- **Token 只存本机**：存在浏览器 `localStorage` 里，不进备份、不上传；
  换设备要在新设备上重新填一次。
- **先压缩后加密**：gzip 之后体积通常降到 1/5，仓库不会越用越臃肿。
- **只留一份快照**：每次上传覆盖同一个文件，不堆积历史版本。

---

## 七、出问题先看这里

| 提示 | 原因与处理 |
|---|---|
| Token 无效或已过期 | Token 填错 / 被删了，重新生成一个 |
| 没有权限：请确认 Token 勾选… | Token 缺 `repo`（或 Contents 读写）权限，重新生成时勾上 |
| 仓库或路径不存在 | 用户名 / 仓库名 / 分支填错了；分支要用放快照的那个（默认 `main`） |
| 提交失败：请检查仓库是否为空仓库 | 新建仓库时没勾 README，先提交一个文件再同步 |
| 连不上 GitHub | 网络问题，确认浏览器能访问 `api.github.com` |
| 云端还没有快照 | 这台设备还没上传过，先在已录好数据的设备上点「同步到云端」 |
| 同步口令不对，无法解密 | 口令跟上传时用的不一致；口令无法找回，只能换一个重新上传 |
| 页面 404 / 白屏 | Pages 的 Source 没选对分支；或 `gh-pages` 分支里少了 `.nojekyll` |

---

## 八、文件清单

| 文件 | 作用 |
|---|---|
| `src/utils/cloudSync.ts` | 加密、压缩、GitHub Contents API 读写、错误提示中文化 |
| `src/stores/sync.ts` | 整库导出 / 恢复，对接云端上传与拉取 |
| `src/views/boss/SettingsView.vue` | 云同步设置界面（数据空间、上次同步、连接状态、六项配置） |
| `scripts/deploy-gh-pages.sh` | 构建并把 dist 推到 gh-pages 分支 |
| `public/.nojekyll` | 禁用 Jekyll，避免下划线开头的文件被丢掉 |
| `public/404.html` | 兜底跳转（hash 路由下一般用不到） |
