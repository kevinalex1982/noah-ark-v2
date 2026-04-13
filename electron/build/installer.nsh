; 诺亚宝库安装程序自定义脚本
; 添加额外的安装后操作

!macro customHeader
  !system "echo 'Building Noah Ark Installer...'"
!macroend

!macro customInstall
  ; 创建数据目录
  CreateDirectory "$INSTDIR\resources\app\data"
!macroend

!macro customUnInstall
  ; 卸载时保留数据目录（可选）
  ; 如果需要删除数据，取消下面的注释
  ; RMDir /r "$INSTDIR\resources\app\data"
!macroend