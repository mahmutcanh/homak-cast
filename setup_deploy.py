import os
import shutil
import subprocess
import winreg

desktop = r'C:\Users\Administrator\Desktop'
downloads = r'c:\Users\Administrator\Desktop\cast\server\public\downloads'
os.makedirs(downloads, exist_ok=True)

setup_src = r'dist\The Land of Legends Cast Receiver Setup 1.0.0.exe'
portable_src = r'dist\The Land of Legends Cast Receiver 1.0.0.exe'

# 1. Copy to Desktop
for target_name in ['The-Land-of-Legends-Cast-Setup.exe', 'Homak-Cast-Setup.exe']:
    dest = os.path.join(desktop, target_name)
    shutil.copy2(setup_src, dest)
    print('Copied to desktop:', target_name, os.path.getsize(dest))

for target_name in ['The-Land-of-Legends-Cast-Receiver.exe', 'Homak-Cast-Receiver.exe']:
    dest = os.path.join(desktop, target_name)
    shutil.copy2(portable_src, dest)
    print('Copied to desktop:', target_name, os.path.getsize(dest))

# 2. Copy to server downloads
for target_name in ['The-Land-of-Legends-Cast-Setup.exe', 'Homak-Cast-Setup.exe']:
    dest = os.path.join(downloads, target_name)
    shutil.copy2(setup_src, dest)
    print('Copied to server downloads:', target_name)

for target_name in ['The-Land-of-Legends-Cast-Receiver.exe', 'Homak-Cast-Receiver.exe']:
    dest = os.path.join(downloads, target_name)
    shutil.copy2(portable_src, dest)
    print('Copied to server downloads:', target_name)

# 3. Install to Program Files (All Users) & Local Programs
for install_dir in [
    r'C:\Program Files\The Land of Legends Cast Receiver',
    r'C:\Users\Administrator\AppData\Local\Programs\The Land of Legends Cast Receiver'
]:
    os.makedirs(install_dir, exist_ok=True)
    src_dir = r'dist\win-unpacked'
    for item in os.listdir(src_dir):
        s = os.path.join(src_dir, item)
        d = os.path.join(install_dir, item)
        try:
            if os.path.isdir(s):
                if os.path.exists(d):
                    shutil.rmtree(d, ignore_errors=True)
                shutil.copytree(s, d)
            else:
                shutil.copy2(s, d)
        except Exception as e:
            print(f'Note: Could not overwrite {item} in {install_dir} (in-use):', e)
    print('Installed to:', install_dir)

target_exe = r'C:\Program Files\The Land of Legends Cast Receiver\The Land of Legends Cast Receiver.exe'

# 4. Create Desktop & Startup Shortcuts
user_startup = os.path.expandvars(r'%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup')
common_startup = os.path.expandvars(r'%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\Startup')
os.makedirs(user_startup, exist_ok=True)
os.makedirs(common_startup, exist_ok=True)

vbs_lines = [
    'Set oWS = WScript.CreateObject("WScript.Shell")',
    f'Set oLink1 = oWS.CreateShortcut("{desktop}\\The Land of Legends Cast Receiver.lnk")',
    f'oLink1.TargetPath = "{target_exe}"',
    f'oLink1.WorkingDirectory = "C:\\Program Files\\The Land of Legends Cast Receiver"',
    'oLink1.Description = "The Land of Legends Cast Receiver"',
    'oLink1.Save',
    
    # Startup shortcuts
    f'Set oLink2 = oWS.CreateShortcut("{user_startup}\\The Land of Legends Cast Receiver.lnk")',
    f'oLink2.TargetPath = "{target_exe}"',
    f'oLink2.WorkingDirectory = "C:\\Program Files\\The Land of Legends Cast Receiver"',
    'oLink2.Description = "The Land of Legends Cast Receiver - Startup"',
    'oLink2.Save',

    f'Set oLink3 = oWS.CreateShortcut("{common_startup}\\The Land of Legends Cast Receiver.lnk")',
    f'oLink3.TargetPath = "{target_exe}"',
    f'oLink3.WorkingDirectory = "C:\\Program Files\\The Land of Legends Cast Receiver"',
    'oLink3.Description = "The Land of Legends Cast Receiver - Startup (All Users)"',
    'oLink3.Save'
]

with open('make_shortcut.vbs', 'w', encoding='utf-8') as f:
    f.write('\n'.join(vbs_lines))

subprocess.run(['cscript', '//nologo', 'make_shortcut.vbs'])
if os.path.exists('make_shortcut.vbs'):
    os.remove('make_shortcut.vbs')

# 5. Registry Auto-Start (Run Key)
try:
    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
    winreg.SetValueEx(key, "The Land of Legends Cast Receiver", 0, winreg.REG_SZ, f'"{target_exe}"')
    winreg.CloseKey(key)
    print('Registry Run key added for current user.')
except Exception as e:
    print('Registry HKCU set error:', e)

try:
    key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
    winreg.SetValueEx(key, "The Land of Legends Cast Receiver", 0, winreg.REG_SZ, f'"{target_exe}"')
    winreg.CloseKey(key)
    print('Registry Run key added for Local Machine (All Users).')
except Exception as e:
    print('Registry HKLM set error:', e)

print('All deployment and startup configurations finished successfully!')
