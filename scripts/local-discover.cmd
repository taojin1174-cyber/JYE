@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

echo [1/3] 采集公开行情（禽网 / 肉交所 / 畜牧总站）...
node scripts/discovery.mjs
if errorlevel 1 echo     有来源本次未取到数据，可继续提交可用部分。

echo [2/3] 检查快照是否有变化...
git add data/discovery.json
git diff --cached --quiet
if not errorlevel 1 goto nochange

echo [3/3] 提交并推送，GitHub Actions 会自动构建发布...
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -m "Update public price leads (local run)"
git push origin main
if errorlevel 1 echo     推送失败，检查网络或凭据后重试。
echo 完成。
goto :eof

:nochange
echo     快照无变化，无需提交。
echo 完成。
