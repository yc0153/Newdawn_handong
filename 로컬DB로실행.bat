@echo off
chcp 65001 >nul
title 포항 생활의견 지도 - 로컬 DB로 실행 (Supabase 없이)
cd /d "%~dp0"
echo.
echo [1/3] Node.js 확인
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS를 설치한 뒤 이 파일을 다시 실행하세요.
  pause
  exit /b 1
)
node -v
echo.
echo [2/3] 라이브러리 설치 확인
if not exist node_modules (
  echo   처음 실행이라 설치합니다. 몇 분 걸립니다...
  call npm ci
  if errorlevel 1 (
    echo   설치에 실패했습니다. 이 창을 캡처해서 보내 주세요.
    pause
    exit /b 1
  )
) else (
  echo   이미 설치되어 있습니다.
)
echo.
echo [3/3] 로컬 DB로 서비스 시작 - Supabase 없이 이 PC의 .local-db 폴더에 저장합니다.
echo   담당자 로그인 정보: .local-db\admin-account.txt  (주소: http://localhost:3000/admin/login)
echo   잠시 후 브라우저가 열립니다. 이 창을 닫으면 서비스가 꺼집니다.
start "" cmd /c "timeout /t 12 >nul & start http://localhost:3000"
call npm run dev:local
pause
