Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Stack-Chan\desktop-pet"
WshShell.Run """C:\Stack-Chan\desktop-pet\node_modules\electron\dist\electron.exe"" .", 0, False
