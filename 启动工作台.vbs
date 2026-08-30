Option Explicit

Dim shell, fso, scriptDir, electronExe, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = fso.BuildPath(scriptDir, "node_modules\electron\dist\electron.exe")

If Not fso.FileExists(electronExe) Then
  MsgBox "Electron launcher not found.", vbExclamation, "Personal Workbench"
  WScript.Quit 1
End If

shell.CurrentDirectory = scriptDir
command = """" & electronExe & """ """ & scriptDir & """"
shell.Run command, 0, False
