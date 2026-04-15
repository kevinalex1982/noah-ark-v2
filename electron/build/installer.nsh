; 诺亚保管库安装程序自定义脚本
; 安装前自动关闭正在运行的应用进程

!macro customHeader
  !system "echo 'Building Noah Ark Installer...'"
!macroend

!macro customInit
  ; 检测并关闭正在运行的诺亚保管库进程
  nsExec::ExecToStack 'taskkill /F /IM "诺亚保管库.exe"'
  nsExec::ExecToStack 'taskkill /F /IM "electron.exe" /FI "WINDOWTITLE eq 诺亚保管库*"'
  ; 关闭 Next.js 服务（端口 3001）
  nsExec::ExecToStack 'for /f "tokens=5" %a in (\'netstat -ano ^| findstr :3001\') do taskkill /F /PID %a'
!macroend

!macro customInstall
  ; 创建数据目录
  CreateDirectory "$INSTDIR\resources\app\data"
!macroend

!macro customUnInstall
  ; 卸载时保留数据目录（AppData 中的数据不会受影响）
  ; 仅清理安装目录
!macroend

; ==================== 清除旧数据选项 ====================
; NSIS MUI2 的 finish page 函数回调不支持分别定义 install/uninstall 函数名
; 改为在 customInstallDone 中弹出确认对话框，用户确认后写入标记文件
; 应用启动时检测标记文件并执行清除

!macro customInstallDone
  ; 安装完成后弹出确认对话框
  MessageBox MB_YESNO|MB_ICONQUESTION "是否清除所有旧数据？$\n（数据库、设置、日志等，下次启动将自动重新初始化）" \
    /SD IDNO IDNO NoClear
  ; 用户选择"是"，写入标记文件
  CreateDirectory "$APPDATA\noah-ark-electron"
  FileOpen $0 "$APPDATA\noah-ark-electron\.clear-old-data" w
  FileWrite $0 "clear"
  FileClose $0
  NoClear:
!macroend
