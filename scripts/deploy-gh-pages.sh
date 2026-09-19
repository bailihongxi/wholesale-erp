#!/usr/bin/env bash
#
# 构建本项目并把 dist 推送到 GitHub 仓库的 gh-pages 分支，用于 GitHub Pages 托管。
#
# 用法：
#   ./scripts/deploy-gh-pages.sh <仓库地址> [分支名]
#   ./scripts/deploy-gh-pages.sh git@github.com:zhangsan/my-erp.git
#   ./scripts/deploy-gh-pages.sh https://github.com/zhangsan/my-erp.git gh-pages
#
# 说明：
#   - 只上传构建产物 dist，源码不会推上去；
#   - 分支是孤儿分支（没有历史），每次覆盖推送，仓库体积只随版本略增；
#   - 数据同步用的快照文件在 main 分支（data/erp-snapshot.json），与页面分支互不干扰。
#
set -euo pipefail

REPO_URL="${1:-}"
BRANCH="${2:-gh-pages}"

if [ -z "$REPO_URL" ]; then
  echo "用法: $0 <仓库地址> [分支名]"
  echo "示例: $0 git@github.com:zhangsan/my-erp.git gh-pages"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "==> 1/3 构建生产版本"
npm run build

if [ ! -d dist ]; then
  echo "构建失败：dist 目录不存在"
  exit 1
fi

# dist 目录本身不进版本库，这里临时建一个用于推送的工作区
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "==> 2/3 准备 $BRANCH 分支内容"
cp -R dist/. "$TMP_DIR"/
# Pages 默认会跑 Jekyll，会把下划线开头的文件丢掉，加这个文件禁用它
touch "$TMP_DIR/.nojekyll"

cd "$TMP_DIR"
git init -q
git checkout -q -b "$BRANCH"
git add -A
git -c user.name="erp-deploy" -c user.email="erp@local" \
  commit -q -m "deploy $(date '+%Y-%m-%d %H:%M:%S')"

echo "==> 3/3 推送到 $BRANCH"
git push -q --force "$REPO_URL" "$BRANCH"

echo
# 注意：中文全角标点紧贴在 $BRANCH 后面时，bash 会把「BRANCH、目录」整体当成变量名，
# 在 set -u 下报 unbound variable。这里统一用 ${BRANCH} 显式界定变量名边界。
echo "完成。请在 GitHub 仓库 Settings → Pages 里把 Source 选为分支 ${BRANCH} 、目录 /(root)。"
echo "稍等 1~2 分钟即可通过 Pages 地址访问。"
