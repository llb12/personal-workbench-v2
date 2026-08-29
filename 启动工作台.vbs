Option Explicit

Dim shell, fso, root, electronExe, debugBat, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = fso.BuildPath(root, "node_modules\electron\dist\electron.exe")
debugBat = fso.BuildPath(root, "启动工作台-优化版.bat")
shell.CurrentDirectory = root

If fso.FileExists(electronExe) Then
  ' Launch Electron directly so the normal entry does not leave a visible CMD window.
  command = """" & electronExe & """ ."
  shell.Run command, 0, False
ElseIf fso.FileExists(debugBat) Then
  ' Reuse the debug launcher when dependencies are not ready, while keeping the window hidden.
  command = """" & debugBat & """"
  shell.Run command, 0, False
Else
  MsgBox "Workbench launcher files were not found: " & root, vbExclamation, "Personal Workbench"
  WScript.Quit 1
End If
