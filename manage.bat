@echo off
setlocal enabledelayedexpansion

REM Session Observer Windows 管理脚本
REM 提供与 manage.sh 相同的功能，但适配 Windows 环境

cd /d "%~dp0"
set ROOT_DIR=%CD%
set RUNTIME_DIR=%ROOT_DIR%\.runtime
set PID_FILE=%RUNTIME_DIR%\server.pid
set LOG_FILE=%RUNTIME_DIR%\server.log

if "%HOST%"=="" set HOST=127.0.0.1
if "%PORT%"=="" set PORT=8787
if "%CODEX_SESSIONS_DIR%"=="" set CODEX_SESSIONS_DIR=%USERPROFILE%\.codex\sessions
if "%CLAUDE_PROJECTS_DIR%"=="" set CLAUDE_PROJECTS_DIR=%USERPROFILE%\.claude\projects
if "%OBSERVER_NODE_MAX_OLD_SPACE_MB%"=="" set OBSERVER_NODE_MAX_OLD_SPACE_MB=192
if "%OBSERVER_NODE_SEMI_SPACE_MB%"=="" set OBSERVER_NODE_SEMI_SPACE_MB=8

:usage
if "%1%"=="" goto usage
if "%1%"=="-h" goto usage
if "%1%"=="--help" goto usage
if "%1%"=="help" goto usage
goto %1%

:usage
echo 用法: manage.bat ^<命令^>
echo.
echo 命令:
echo   start      在后台启动 observer 服务器
echo   stop       停止 observer 服务器
echo   restart    重启 observer 服务器
echo   status     显示 observer 服务器状态
echo   logs       显示服务器日志 (使用 -f 跟踪)
echo   open       在浏览器中打开 UI
echo   run        在前台运行服务器
echo.
echo 环境变量:
echo   HOST                 默认: 127.0.0.1
echo   PORT                 默认: 8787
echo   CODEX_SESSIONS_DIR   默认: %%USERPROFILE%%\.codex\sessions
echo   CLAUDE_PROJECTS_DIR  默认: %%USERPROFILE%%\.claude\projects
echo   OBSERVER_NODE_MAX_OLD_SPACE_MB
echo                        默认: 192, 限制 V8 旧空间以减少 RSS 增长
echo   OBSERVER_NODE_SEMI_SPACE_MB
echo                        默认: 8, 限制 V8 年轻代半空间
goto :eof

:ensure_node
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: node 未安装或不在 PATH 中。
    exit /b 1
)
goto :eof

:find_listener_pid
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    set listener_pid=%%a
    goto :find_listener_done
)
:find_listener_done
goto :eof

:get_process_command
for /f "tokens=*" %%a in ('wmic process where processid=%1 get commandline /value 2^>nul ^| findstr "CommandLine="') do (
    set process_command=%%a
    set process_command=!process_command:CommandLine=!
)
goto :eof

:is_observer_pid
if "%1"=="" exit /b 1
tasklist /FI "PID eq %1" 2>nul | find "%1" >nul
if %errorlevel% neq 0 exit /b 1

call :get_process_command %1
echo !process_command! | findstr /i "node" >nul
if %errorlevel% neq 0 exit /b 1
echo !process_command! | findstr /i "server.js" >nul
if %errorlevel% neq 0 exit /b 1
exit /b 0

:get_running_pid
if exist "%PID_FILE%" (
    set /p pid=<"%PID_FILE%"
    call :is_observer_pid !pid!
    if !errorlevel! equ 0 (
        echo !pid!
        exit /b 0
    )
)

call :find_listener_pid
if defined listener_pid (
    call :is_observer_pid !listener_pid!
    if !errorlevel! equ 0 (
        echo !listener_pid! > "%PID_FILE%"
        echo !listener_pid!
        exit /b 0
    )
)
exit /b 1

:ensure_frontend_build
if not exist "%ROOT_DIR%\package.json" exit /b 0

set dist_index=%ROOT_DIR%\dist\index.html
set needs_build=0

if not exist "%dist_index%" (
    set needs_build=1
) else (
    REM 检查源文件是否比构建文件新
    for /f %%a in ('dir /b /s "%ROOT_DIR%\src\*.jsx" "%ROOT_DIR%\src\*.js" 2^>nul ^| find /c /v ""') do (
        if %%a gtr 0 (
            set needs_build=1
            goto :frontend_build_check_done
        )
    )
)

:frontend_build_check_done
if %needs_build% equ 1 (
    echo 正在构建前端...
    cd "%ROOT_DIR%"
    call npm run build >nul 2>&1
    cd "%ROOT_DIR%"
)
goto :eof

:is_running
call :get_running_pid >nul 2>&1
exit /b %errorlevel%

:wait_for_server
set pid=%1
set /a attempts=%START_WAIT_SECONDS% * 4
set /a elapsed=0

:wait_loop
if %elapsed% geq %attempts% exit /b 1

REM 检查进程是否还在运行
tasklist /FI "PID eq %pid%" 2>nul | find "%pid%" >nul
if %errorlevel% neq 0 exit /b 1

call :find_listener_pid
if defined listener_pid (
    call :is_observer_pid !listener_pid!
    if !errorlevel% equ 0 (
        echo !listener_pid! > "%PID_FILE%"
        where curl >nul 2>&1
        if !errorlevel! equ 0 (
            curl -fsS --max-time 1 "http://%HOST%:%PORT%/" >nul 2>&1
            if !errorlevel! equ 0 exit /b 0
        ) else (
            exit /b 0
        )
    )
)

timeout /t 1 /nobreak >nul
set /a elapsed+=1
goto wait_loop

:start_detached_server
set node_args=--max-old-space-size=%OBSERVER_NODE_MAX_OLD_SPACE_MB% --max-semi-space-size=%OBSERVER_NODE_SEMI_SPACE_MB% --optimize-for-size --expose-gc

start /B "" node %node_args% server.js > "%LOG_FILE%" 2>&1
goto :eof

:start_server
call :ensure_node
if %errorlevel% neq 0 exit /b 1

call :ensure_frontend_build
if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%"

call :is_running
if %errorlevel% equ 0 (
    call :get_running_pid
    for /f %%a in ('call :get_running_pid') do set running_pid=%%a
    echo Observer 已运行 (PID !running_pid!)，地址: http://%HOST%:%PORT%
    exit /b 0
)

call :find_listener_pid
if defined listener_pid (
    call :is_observer_pid !listener_pid!
    if !errorlevel% equ 0 (
        echo !listener_pid! > "%PID_FILE%"
        echo Observer 已运行 (PID !listener_pid!)，地址: http://%HOST%:%PORT%
        exit /b 0
    )
    echo 端口 %PORT% 已被 PID !listener_pid! 占用。
    echo 停止该进程或使用不同的 PORT。
    exit /b 1
)

REM 清空日志文件
type nul > "%LOG_FILE%"

call :start_detached_server
if %errorlevel% neq 0 (
    echo 启动 observer 失败: 无法启动进程。
    exit /b 1
)

REM 等待进程启动并获取 PID
timeout /t 2 /nobreak >nul
call :find_listener_pid
if defined listener_pid (
    echo !listener_pid! > "%PID_FILE%"
    
    call :wait_for_server !listener_pid!
    if %errorlevel% equ 0 (
        call :get_running_pid
        for /f %%a in ('call :get_running_pid') do set final_pid=%%a
        echo 已启动 observer (PID !final_pid!)
        echo UI: http://%HOST%:%PORT%
        echo Sessions: %CODEX_SESSIONS_DIR%
        exit /b 0
    )
)

del "%PID_FILE%" 2>nul
echo 启动 observer 失败。检查日志:
echo   %LOG_FILE%
exit /b 1

:stop_server
call :get_running_pid
for /f %%a in ('call :get_running_pid') do set pid=%%a

if not defined pid (
    echo Observer 未运行。
    del "%PID_FILE%" 2>nul
    exit /b 0
)

tasklist /FI "PID eq %pid%" 2>nul | find "%pid%" >nul
if %errorlevel% equ 0 (
    taskkill /PID %pid% /F >nul 2>&1
    echo 已停止 observer (PID %pid%)
) else (
    echo Observer 进程未找到，清理陈旧 PID。
)
del "%PID_FILE%" 2>nul
exit /b 0

:status_server
call :is_running
if %errorlevel% equ 0 (
    call :get_running_pid
    for /f %%a in ('call :get_running_pid') do set pid=%%a
    echo Observer 正在运行。
    echo PID: %pid%
    echo UI: http://%HOST%:%PORT%
    echo Sessions: %CODEX_SESSIONS_DIR%
) else (
    echo Observer 未运行。
    echo 使用: manage.bat start
)
exit /b 0

:logs_server
if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%"
if not exist "%LOG_FILE%" type nul > "%LOG_FILE%"

if "%2"=="-f" (
    echo 跟踪日志 (Ctrl+C 退出):
    tail -f "%LOG_FILE%"
) else (
    REM 显示最后 120 行
    powershell -Command "Get-Content '%LOG_FILE%' -Tail 120"
)
exit /b 0

:open_ui
set url=http://%HOST%:%PORT%
start "" "%url%"
echo 已打开: %url
exit /b 0

:run_foreground
call :ensure_node
if %errorlevel% neq 0 exit /b 1

call :ensure_frontend_build
cd "%ROOT_DIR%"
set node_args=--max-old-space-size=%OBSERVER_NODE_MAX_OLD_SPACE_MB% --max-semi-space-size=%OBSERVER_NODE_SEMI_SPACE_MB% --optimize-for-size --expose-gc
node %node_args% server.js
exit /b 0

:start
call :start_server
goto :eof

:stop
call :stop_server
goto :eof

:restart
call :stop_server
call :start_server
goto :eof

:status
call :status_server
goto :eof

:logs
call :logs_server
goto :eof

:open
call :open_ui
goto :eof

:run
call :run_foreground
goto :eof

:default
echo 未知命令: %1%
call :usage
exit /b 1
