@echo off
setlocal
rem One-click daily run: public market leads + roujiaosuo poultry leads,
rem then commit and push. Run once per day after the machine is switched on.
rem Clear proxy vars: a stale proxy makes GitHub return "CONNECT tunnel failed: 502".
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "http_proxy="
set "https_proxy="
cd /d "%~dp0.."

rem github.com is often RST-blocked when dialed directly; fall back to the local SOCKS proxy.
set "PROXYARG="
curl -s -o nul -m 8 https://github.com/ >nul 2>&1
if errorlevel 1 goto useproxy
goto netok

:useproxy
echo     github.com direct blocked, using local SOCKS proxy 127.0.0.1:10808
set "PROXYARG=-c http.proxy=socks5h://127.0.0.1:10808"

:netok

echo [1/4] Collect public market leads...
node scripts/discovery.mjs
if errorlevel 1 echo     Some sources failed, continuing with available data.

echo [2/4] Scrape roujiaosuo poultry leads...
node scripts/roujiaosuo-scrape.mjs
if errorlevel 1 (
  echo     Scrape failed, keeping the previous lead file.
) else (
  node scripts/roujiaosuo-build.mjs
  node scripts/import-roujiaosuo-leads.mjs --only-frozen
)

echo [3/4] Check changes...
git add -A
git diff --cached --quiet
if not errorlevel 1 goto nochange

echo [4/4] Commit and push...
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "Daily price collection (local run)"
git %PROXYARG% pull --rebase origin main
if errorlevel 1 (
  echo     Rebase conflict: keep the freshly collected snapshot...
  git checkout --theirs data/discovery.json 2>nul
  git checkout --theirs data/roujiaosuo-leads.json 2>nul
  git checkout --theirs data/roujiaosuo-leads.csv 2>nul
  node scripts/import-roujiaosuo-leads.mjs --only-frozen
  git add -A
  git -c core.editor=true rebase --continue
)
git %PROXYARG% push origin main
if errorlevel 1 (
  echo     Push failed, retrying in 5s...
  ping -n 6 127.0.0.1 >nul
  git %PROXYARG% push origin main
)
if errorlevel 1 echo     Push still failed. Check network or open the proxy on port 10808.
echo Done.
goto :eof

:nochange
echo     Nothing changed, skipping commit.
echo Done.
