import subprocess
import time

exe_path = r'C:\Users\Administrator\AppData\Local\Programs\The Land of Legends Cast Receiver\The Land of Legends Cast Receiver.exe'

# Create and run task with schtasks
subprocess.run(['schtasks', '/Create', '/TN', 'LaunchCastReceiver', '/TR', f'"{exe_path}"', '/SC', 'ONCE', '/ST', '00:00', '/F'], capture_output=True)
subprocess.run(['schtasks', '/Run', '/TN', 'LaunchCastReceiver'], capture_output=True)

time.sleep(3)
out = subprocess.check_output(['tasklist'], text=True)
found = False
for line in out.splitlines():
    if any(k in line.lower() for k in ['the', 'legend', 'cast', 'electron', 'homak']):
        print('Running:', line)
        found = True

if not found:
    print('No process matching query in tasklist')
