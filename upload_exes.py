import paramiko
import os

HOSTIVON_IP = '109.236.48.166'
# Key auth by default (~/.ssh/hostivon_key); HOSTIVON_PASS env var is only a fallback. Never commit secrets.
HOSTIVON_KEY = os.path.expanduser(os.environ.get('HOSTIVON_KEY', '~/.ssh/hostivon_key'))

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
auth = {'key_filename': HOSTIVON_KEY} if os.path.exists(HOSTIVON_KEY) else {'password': os.environ['HOSTIVON_PASS']}
ssh.connect(HOSTIVON_IP, port=22, username='root', timeout=15, **auth)
sftp = ssh.open_sftp()

remote_dir = '/opt/cast/server/public/downloads'
ssh.exec_command(f'mkdir -p {remote_dir} && rm -f {remote_dir}/The-Land-of-Legends-Cast-*.exe')

local_setup = r'dist\Cast-Setup-1.0.0.exe'
local_portable = r'dist\Cast-Receiver-1.0.0.exe'

print('Uploading setup exe (104MB)...', flush=True)
sftp.put(local_setup, f'{remote_dir}/Homak-Cast-Setup.exe')

print('Uploading portable exe (95MB)...', flush=True)
sftp.put(local_portable, f'{remote_dir}/Homak-Cast-Receiver.exe')

local_apk = os.path.join('android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
if os.path.exists(local_apk):
    print('Uploading Android APK...', flush=True)
    sftp.put(local_apk, f'{remote_dir}/Homak-Cast.apk')

sftp.close()
ssh.close()
print('All download EXEs uploaded to cast.homaklab.com successfully!', flush=True)
