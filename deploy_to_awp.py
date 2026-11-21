import paramiko
import os
import tarfile
import tempfile
import urllib.request
import json
import time

HOSTIVON_IP = '109.236.48.166'
HOSTIVON_PASS = os.environ['HOSTIVON_PASS']  # set in the shell, never commit
REMOTE_DIR = '/opt/cast'
PORT = 20150

def run_ssh(ssh, cmd):
    print(f">> {cmd}", flush=True)
    _, stdout, stderr = ssh.exec_command(cmd)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', 'ignore').strip()
    err = stderr.read().decode('utf-8', 'ignore').strip()
    if out:
        print(out, flush=True)
    if err and exit_code != 0:
        print(f"STDERR: {err}", flush=True)
    return exit_code, out

def deploy():
    print("--- 1. Packaging Server Files ---", flush=True)
    tmp_tar = os.path.join(tempfile.gettempdir(), 'cast_server.tar.gz')
    def filter_func(tarinfo):
        if 'downloads' in tarinfo.name:
            return None
        return tarinfo

    with tarfile.open(tmp_tar, 'w:gz') as tar:
        tar.add('server', arcname='server', filter=filter_func)
        tar.add('package.json', arcname='package.json')
        tar.add('package-lock.json', arcname='package-lock.json')

    print(f"Archive created: {tmp_tar} ({os.path.getsize(tmp_tar)} bytes)", flush=True)

    print("\n--- 2. Connecting to Hostivon SSH ---", flush=True)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOSTIVON_IP, port=22, username='root', password=HOSTIVON_PASS, timeout=15)
    print("SSH connected.", flush=True)

    print("\n--- 3. Uploading Files ---", flush=True)
    sftp = ssh.open_sftp()
    remote_tar = f"{REMOTE_DIR}/cast_server.tar.gz"
    sftp.put(tmp_tar, remote_tar)
    sftp.close()
    print("Upload complete.", flush=True)

    print("\n--- 4. Extracting Files on Server ---", flush=True)
    run_ssh(ssh, f"cd {REMOTE_DIR} && tar -xzf cast_server.tar.gz && rm -f cast_server.tar.gz")

    print("\n--- 5. Restarting PM2 with PUBLIC_HOST=cast.homaklab.com ---", flush=True)
    run_ssh(ssh, f"cd {REMOTE_DIR} && PORT={PORT} PUBLIC_HOST=cast.homaklab.com pm2 restart cast --update-env")
    run_ssh(ssh, "pm2 save")

    time.sleep(2)
    code, out = run_ssh(ssh, f"curl -s http://127.0.0.1:{PORT}/api/status")
    print("Server status response:", out, flush=True)

    ssh.close()
    print("\n--- 6. Testing Public Domain https://cast.homaklab.com ---", flush=True)
    try:
        req = urllib.request.Request("https://cast.homaklab.com/api/status", headers={"User-Agent": "HomakCastTest/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            res = json.loads(r.read().decode())
            print("Domain Verification SUCCESS:", res, flush=True)
    except Exception as e:
        print("Domain Verification Error:", e, flush=True)

if __name__ == '__main__':
    deploy()
