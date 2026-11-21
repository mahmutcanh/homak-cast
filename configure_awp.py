import os
import urllib.request
import json
import paramiko
import time
import sys

CF_TOKEN = os.environ['CF_TOKEN']
ZONE_ID = '44dab7da9ef829b2303a961983a4668b'
RECORD_ID = '82cbb2aa4689b7fbab23c0eb7653ba90'
TUNNEL_CNAME = '5e1d3511-5adc-4fb3-8622-1d3b6c759404.cfargotunnel.com'

print("Step 1: Updating Cloudflare DNS record...", flush=True)
update_url = f'https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/dns_records/{RECORD_ID}'
payload = json.dumps({
    'type': 'CNAME',
    'name': 'awp.homaklab.com',
    'content': TUNNEL_CNAME,
    'ttl': 1,
    'proxied': True
}).encode('utf-8')
req = urllib.request.Request(update_url, data=payload, headers={
    'Authorization': f'Bearer {CF_TOKEN}',
    'Content-Type': 'application/json'
}, method='PUT')
with urllib.request.urlopen(req, timeout=10) as resp:
    res = json.loads(resp.read().decode())
    print(f"DNS record updated: {res['success']}", flush=True)

print("Step 2: Connecting to Hostivon via SSH...", flush=True)
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('109.236.48.166', port=22, username='root', password=os.environ['HOSTIVON_PASS'], timeout=10)
print("Connected to SSH.", flush=True)

_, stdout, _ = ssh.exec_command('cat /etc/cloudflared-omni/config.yml')
content = stdout.read().decode('utf-8', 'ignore')
print(f"Read config length: {len(content)}", flush=True)

if 'awp.homaklab.com' not in content:
    new_content = content.replace(
        '  - hostname: cast.homaklab.com\n    service: http://localhost:20150',
        '  - hostname: cast.homaklab.com\n    service: http://localhost:20150\n  - hostname: awp.homaklab.com\n    service: http://localhost:20150'
    )
    sftp = ssh.open_sftp()
    with sftp.file('/etc/cloudflared-omni/config.yml', 'w') as f:
        f.write(new_content)
    sftp.close()
    print("Updated /etc/cloudflared-omni/config.yml", flush=True)
    _, stdout, _ = ssh.exec_command('systemctl restart cloudflared-omni')
    print("Restarted cloudflared-omni:", stdout.read().decode('utf-8', 'ignore'), flush=True)
else:
    print("awp.homaklab.com already present in config.", flush=True)

# Also let's update PM2 to have PUBLIC_HOST=awp.homaklab.com
print("Step 3: Updating PM2 environment...", flush=True)
ssh.exec_command('cd /opt/cast && PORT=20150 PUBLIC_HOST=awp.homaklab.com pm2 restart cast --update-env && pm2 save')
time.sleep(2)

ssh.close()
print("SSH closed. Done!", flush=True)
