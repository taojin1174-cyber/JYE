@echo off
setlocal
rem Roujiaosuo frozen-poultry only: scrape, write to cloud, back up locally.
rem No git commit here -- business data never enters the public repo.
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "http_proxy="
set "https_proxy="
cd /d "%~dp0.."

echo [1/3] Scrape roujiaosuo frozen-poultry categories...
node scripts/roujiaosuo-scrape.mjs
if errorlevel 1 goto failed

echo [2/3] Rebuild CSV and push new leads to cloud...
node scripts/roujiaosuo-build.mjs
node scripts/import-roujiaosuo-leads.mjs --only-frozen --cloud

echo [3/3] Backup cloud data to local folder...
if exist .env node scripts\backup-cloud.mjs

echo Done.
goto :eof

:failed
echo     Scrape failed, nothing was changed.
