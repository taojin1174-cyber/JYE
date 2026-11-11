#!/usr/bin/env bash
# 行情跳动 · 肉交所四品类采集
# 用法：/opt/hqtd/collect.sh          正常采集
#       /opt/hqtd/collect.sh --dry    只抓取，不写库
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR" || exit 1

LOG_DIR="$APP_DIR/logs"
mkdir -p "$LOG_DIR" data
LOG="$LOG_DIR/collect-$(date +%Y%m%d).log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# 加载 Supabase 配置
if [ -f "$APP_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$APP_DIR/.env"
  set +a
else
  log "错误：缺少 $APP_DIR/.env"
  exit 1
fi

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  log "错误：.env 中 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 为空"
  exit 1
fi

MODE="${1:-}"
log "===== 开始采集 ====="

# 1) 抓取肉交所四品类
if ! node scripts/roujiaosuo-scrape.mjs >>"$LOG" 2>&1; then
  log "抓取失败，本次不写库（保留上一批线索）"
  exit 2
fi

# 2) 写入 Supabase
if [ "$MODE" = "--dry" ]; then
  log "dry 模式：跳过写库"
else
  if ! node scripts/import-roujiaosuo-leads.mjs --cloud >>"$LOG" 2>&1; then
    log "写库失败，请检查 SUPABASE_SERVICE_ROLE_KEY 是否已轮换"
    exit 3
  fi
fi

# 3) 摘要
SUMMARY=$(node -e '
try{
  const j=require("./data/roujiaosuo-leads.json");
  const c={};
  (j.rows||[]).forEach(r=>{c[r.category]=(c[r.category]||0)+1;});
  console.log("共 "+(j.rows||[]).length+" 条 | "+Object.entries(c).map(([k,v])=>k+" "+v).join(" / "));
}catch(e){console.log("无法读取结果文件");}
' 2>/dev/null)

log "完成：$SUMMARY"
log "===== 结束 ====="

# 清理 30 天前日志
find "$LOG_DIR" -name 'collect-*.log' -mtime +30 -delete 2>/dev/null

exit 0
