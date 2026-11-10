@echo off
setlocal
rem Clear proxy vars: a proxy makes GitHub return "CONNECT tunnel failed: 502".
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "http_proxy="
set "https_proxy="
cd /d "%~dp0.."

echo [1/4] Collect public price leads...
node scripts/discovery.mjs
if errorlevel 1 echo     Some sources failed, continuing with available data.

echo [2/4] Check snapshot changes...
git add -A
git diff --cached --quiet
if not errorlevel 1 goto nochange

echo [3/4] Commit local snapshot...
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "Update public price leads (local run)"

echo [4/4] Sync with remote then push...
git pull --rebase origin main
if errorlevel 1 (
  echo     Rebase conflict: keep the freshly collected snapshot...
  git checkout --theirs data/discovery.json
  git add data/discovery.json
  git -c core.editor=true rebase --continue
)
git push origin main
if errorlevel 1 (
  echo     Push failed, retrying in 5s...
  timeout /t 5 /nobreak >nul
  git push origin main
)
if errorlevel 1 echo     Push still failed. Check network or credentials.
echo Done.
goto :eof

:nochange
echo     Snapshot unchanged, nothing to commit.
echo Done.
