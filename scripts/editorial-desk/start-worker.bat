@echo off
rem 편집위원 데스크 작업기 켜기 (PO PC) — 이 창을 열어 두는 동안 웹 '편집위원' 요청을 받아 만듭니다. 끄려면 창을 닫거나 Ctrl+C.
rem 비밀값(운영 Supabase 주소·service_role 키)은 비밀보관 폴더의 편집위원데스크-작업기.env에 둡니다(없으면 저장소 .env.local).
chcp 65001 >nul
cd /d "%~dp0..\.."
set "DESK_ENV=%USERPROFILE%\Documents\SM_Localtax_비밀보관\편집위원데스크-작업기.env"
if exist "%DESK_ENV%" set "EDITORIAL_ENV_FILE=%DESK_ENV%"
node scripts\editorial-desk\worker.mjs check
if errorlevel 1 (
  echo.
  echo 설정을 확인해 주세요 - docs\dev\편집위원데스크_설계.md 7장
  pause
  exit /b 1
)
node scripts\editorial-desk\worker.mjs
pause
