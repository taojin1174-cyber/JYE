@echo off
setlocal
rem One-click daily run: collect leads, write them to the cloud, back up locally.
rem Business data never enters this public repo -- only code does.
rem Clear proxy vars: a stale proxy makes GitHub return "CONNECT tunnel failed: 502".
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "http_proxy="
set "https_proxy="
cd /d "%~dp0.."

rem github.com is often RST-blocked when dialed directly; fall back to the local SOCKS proxy.
set "PROXYARG="
curl -s -o nul -m 8 https://github.com/ >nul 2>&1
if not errorlevel 1 goto netok

rem DNS poisoning: github.com resolves to a fake IP on this network even though
rem the real address is reachable. Pin the address before giving up on direct.
curl -s -o nul -m 8 --resolve github.com:443:20.205.243.166 https://github.com/ >nul 2>&1
if errorlevel 1 goto useproxy
echo     github.com returns a fake IP, pinning the real address 20.205.243.166
set "PROXYARG=-c http.curloptResolve=github.com:443:20.205.243.166"
goto netok

:useproxy
echo     github.com direct blocked, using local SOCKS proxy 127.0.0.1:10808
set "PROXYARG=-c http.proxy=socks5h://127.0.0.1:10808"

:netok

echo [1/7] Collect public market leads...
node scripts/discovery.mjs
if errorlevel 1 echo     Some sources failed, continuing with available data.

echo [2/7] Push new market leads to cloud (insert only, never overwrite reviewed)...
node scripts/import-leads-to-cloud.mjs
if errorlevel 1 echo     Cloud import failed; falling back to the repo queue.

rem Domestic price sites are unreachable from GitHub runners, while this machine
rem cannot reach supabase.co. Queue the leads and let GitHub Actions write them.
echo [3/7] Queue leads for cloud import...
node scripts/queue-leads.mjs
if errorlevel 1 echo     Queue build failed; nothing queued this run.

echo [4/7] Scrape roujiaosuo poultry leads...
node scripts/roujiaosuo-scrape.mjs
if errorlevel 1 (
  echo     Scrape failed, keeping the previous lead file.
) else (
  node scripts/roujiaosuo-build.mjs
  node scripts/import-roujiaosuo-leads.mjs --only-frozen --cloud
)

echo [5/7] Backup cloud data to local folder...
if exist .env node scripts\backup-cloud.mjs

echo [6/7] Check code changes...
git add -A
git diff --cached --quiet
if not errorlevel 1 goto nochange

echo [7/7] Commit and push code only...
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "Daily code update (local run)"
git %PROXYARG% pull --rebase origin main
if errorlevel 1 (
  echo     Rebase failed, please resolve manually. Nothing was pushed.
  goto done
)
git %PROXYARG% push origin main
if errorlevel 1 (
  echo     Push failed, retrying in 5s...
  ping -n 6 127.0.0.1 >nul
  git %PROXYARG% push origin main
)
if errorlevel 1 echo     Push still failed. Check network or open the proxy on port 10808.

:done
echo Done.
goto :eof

:nochange
echo     Nothing changed, skipping commit.
echo Done.
