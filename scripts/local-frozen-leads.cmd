@echo off
setlocal
rem One-shot local run: scrape 4 frozen-poultry categories, rebuild the table page,
rem merge the leads into the review queue, then push. Schedule once per day.
rem Clear proxy vars: a proxy makes GitHub return "CONNECT tunnel failed: 502".
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

echo [1/5] Scrape roujiaosuo frozen-poultry categories...
node scripts/roujiaosuo-scrape.mjs
if errorlevel 1 goto failed

echo [2/5] Rebuild leads.html and CSV...
node scripts/roujiaosuo-build.mjs
if errorlevel 1 goto failed

echo [3/5] Merge into review queue, frozen poultry only...
node scripts/import-roujiaosuo-leads.mjs --only-frozen
if errorlevel 1 goto failed

echo [4/5] Check changes...
git add leads.html data/roujiaosuo-leads.json data/roujiaosuo-leads.csv data/discovery.json
git diff --cached --quiet
if not errorlevel 1 goto nochange

echo [5/5] Commit and push...
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "Update frozen poultry leads (local run)"
git %PROXYARG% pull --rebase origin main
if errorlevel 1 (
  echo     Rebase conflict: regenerate snapshot from the fresh local data...
  node scripts/import-roujiaosuo-leads.mjs --only-frozen
  git add leads.html data/roujiaosuo-leads.json data/roujiaosuo-leads.csv data/discovery.json
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
goto :eof

:failed
echo     Stopped. Fix the error above and run again. No files were pushed.
exit /b 1
