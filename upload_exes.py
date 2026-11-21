import paramiko
import os

HOSTIVON_IP = '109.236.48.166'
HOSTIVON_PASS = os.environ['HOSTIVON_PASS']  # set in the shell, never commit

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOSTIVON_IP, port=22, username='root', password=HOSTIVON_PASS, timeout=15)
sftp = ssh.open_sftp()

remote_dir = '/opt/cast/server/public/downloads'
ssh.exec_command(f'mkdir -p {remote_dir}')

local_setup = r'dist\The Land of Legends Cast Receiver Setup 1.0.0.exe'
local_portable = r'dist\The Land of Legends Cast Receiver 1.0.0.exe'

print('Uploading setup exe (104MB)...', flush=True)
sftp.put(local_setup, f'{remote_dir}/Homak-Cast-Setup.exe')
sftp.put(local_setup, f'{remote_dir}/The-Land-of-Legends-Cast-Setup.exe')

print('Uploading portable exe (95MB)...', flush=True)
sftp.put(local_portable, f'{remote_dir}/Homak-Cast-Receiver.exe')
sftp.put(local_portable, f'{remote_dir}/The-Land-of-Legends-Cast-Receiver.exe')

sftp.close()
ssh.close()
print('All download EXEs uploaded to cast.homaklab.com successfully!', flush=True)
