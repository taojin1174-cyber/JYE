#!/usr/bin/env bash
# 行情跳动 · 采集器一键安装（Ubuntu / Debian）
# 用法：sudo bash install.sh
set -uo pipefail

APP_DIR=/opt/hqtd
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[X]${NC} $*"; }

if [ "$(id -u)" -ne 0 ]; then
  err "请用 root 运行：sudo bash install.sh"
  exit 1
fi

echo "===== 行情跳动采集器安装 ====="

# ---------- 1. Node 22 ----------
need_node=1
if command -v node >/dev/null 2>&1; then
  cur="$(node -v | sed 's/^v//')"
  major="${cur%%.*}"
  if [ "$major" -ge 22 ] 2>/dev/null; then
    ok "Node 已满足要求：v$cur"
    need_node=0
  else
    warn "当前 Node v$cur 低于 22，需要升级"
  fi
fi

if [ "$need_node" -eq 1 ]; then
  echo "正在安装 Node 22 ..."
  if command -v curl >/dev/null 2>&1; then
    if curl -fsSL --max-time 40 https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh 2>/dev/null; then
      bash /tmp/nodesource_setup.sh >/dev/null 2>&1 && apt-get install -y nodejs >/dev/null 2>&1
    fi
  fi

  if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/^v//' | cut -d. -f1)" -lt 22 ]; then
    warn "NodeSource 未成功，改用国内镜像下载二进制包"
    NODE_VER=v22.11.0
    ARCH=$(uname -m)
    [ "$ARCH" = "aarch64" ] && ARCH_PKG=arm64 || ARCH_PKG=x64
    PKG="node-$NODE_VER-linux-$ARCH_PKG"
    for base in https://npmmirror.com/mirrors/node https://nodejs.org/dist; do
      if curl -fsSL --max-time 120 "$base/$NODE_VER/$PKG.tar.xz" -o /tmp/node.tar.xz 2>/dev/null; then
        mkdir -p /usr/local/lib/nodejs
        tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs 2>/dev/null
        ln -sf "/usr/local/lib/nodejs/$PKG/bin/node" /usr/local/bin/node
        ln -sf "/usr/local/lib/nodejs/$PKG/bin/npm"  /usr/local/bin/npm
        rm -f /tmp/node.tar.xz
        break
      fi
    done
  fi
fi

if command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/^v//' | cut -d. -f1)" -ge 22 ]; then
  ok "Node 可用：$(node -v)"
else
  err "Node 22 安装失败，请手动安装后重跑本脚本"
  exit 1
fi

# ---------- 2. 部署文件 ----------
mkdir -p "$APP_DIR/scripts" "$APP_DIR/data" "$APP_DIR/logs"
cp "$SRC_DIR/scripts/roujiaosuo-scrape.mjs"        "$APP_DIR/scripts/"
cp "$SRC_DIR/scripts/import-roujiaosuo-leads.mjs"  "$APP_DIR/scripts/"
cp "$SRC_DIR/collect.sh"                           "$APP_DIR/collect.sh"
chmod +x "$APP_DIR/collect.sh"
ok "文件已部署到 $APP_DIR"

# ---------- 3. 环境变量 ----------
if [ -f "$APP_DIR/.env" ]; then
  ok ".env 已存在，保持不变"
else
  cp "$SRC_DIR/env.example" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  warn "已生成 $APP_DIR/.env，请填入 SUPABASE_SERVICE_ROLE_KEY"
fi

# ---------- 4. 定时任务 ----------
CRON_LINE="0 9,15 * * * $APP_DIR/collect.sh >/dev/null 2>&1"
if crontab -l 2>/dev/null | grep -Fq "$APP_DIR/collect.sh"; then
  ok "定时任务已存在"
else
  ( crontab -l 2>/dev/null; echo "$CRON_LINE" ) | crontab -
  ok "已添加定时任务：每天 09:00 与 15:00"
fi

# cron 服务确保在跑
systemctl is-active --quiet cron 2>/dev/null || systemctl start cron 2>/dev/null || true

# ---------- 5. 收尾 ----------
echo ""
echo "===== 安装完成 ====="
echo "下一步："
echo "  1) 编辑配置：nano $APP_DIR/.env"
echo "     填入 SUPABASE_SERVICE_ROLE_KEY"
echo "  2) 手动试跑：$APP_DIR/collect.sh"
echo "  3) 查看日志：tail -f $APP_DIR/logs/collect-\$(date +%Y%m%d).log"
echo ""
echo "定时：每天 09:00、15:00 自动采集"
echo "停止：crontab -l | grep -v hqtd | crontab -"
