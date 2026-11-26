import hashlib
import re
import socket
import subprocess
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

LOCAL_IP = socket.gethostbyname(socket.gethostname())


def create_hash(timestamp, log_type, user, source_ip, details):
    raw = f"{timestamp}|{log_type}|{user}|{source_ip}|{details}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_record(log_type, action, severity, user, src_ip, dst_ip, details):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return {
        "timestamp": now,
        "log_type": log_type,
        "action": action,
        "severity": severity,
        "user": user,
        "source_ip": src_ip,
        "destination_ip": dst_ip,
        "details": details,
        "status": "Aktif",
        "source": "kali-linux",
        "integrity_hash": create_hash(now, log_type, user, src_ip, details)
    }


def parse_line(line):
    if "sudo:" in line and ("incorrect password" in line or "authentication failure" in line):
        user_match = re.search(r"sudo:\s+(\S+)", line)
        user = user_match.group(1) if user_match else "kali"
        return build_record(
            "KVKK_ACCESS",
            "BLOCK",
            "CRITICAL",
            user,
            LOCAL_IP,
            LOCAL_IP,
            f"Hatalı sudo yetki yükseltme denemesi: {line.strip()[:140]}"
        )

    if "su:" in line and ("FAILED SU" in line or "authentication failure" in line):
        return build_record(
            "KVKK_ACCESS",
            "BLOCK",
            "CRITICAL",
            "root",
            LOCAL_IP,
            LOCAL_IP,
            f"Root kullanıcısına yetkisiz geçiş (su) denemesi: {line.strip()[:140]}"
        )

    if "sudo:" in line and "COMMAND=" in line:
        user_match = re.search(r"sudo:\s+(\S+)", line)
        user = user_match.group(1) if user_match else "kali"
        return build_record(
            "KVKK_ACCESS",
            "ALERT",
            "WARNING",
            user,
            LOCAL_IP,
            LOCAL_IP,
            f"Yönetici yetkisiyle komut çalıştırıldı: {line.strip()[:140]}"
        )

    if "sshd" in line and ("Failed password" in line or "Invalid user" in line):
        user_match = re.search(r"for (?:invalid user )?(\S+)", line)
        ip_match = re.search(r"from (\d+\.\d+\.\d+\.\d+)", line)
        user = user_match.group(1) if user_match else "unknown"
        src_ip = ip_match.group(1) if ip_match else "127.0.0.1"
        return build_record(
            "KVKK_ACCESS",
            "ALERT",
            "HIGH",
            user,
            src_ip,
            LOCAL_IP,
            f"SSH üzerinden başarısız uzaktan erişim denemesi: {line.strip()[:140]}"
        )

    if any(cmd in line for cmd in ["useradd[", "userdel[", "usermod[", "passwd["]):
        return build_record(
            "KVKK_ACCESS",
            "ALERT",
            "HIGH",
            "root",
            LOCAL_IP,
            LOCAL_IP,
            f"Sistem kullanıcı hesabı veya parola değişikliği: {line.strip()[:140]}"
        )

    if "UFW BLOCK" in line:
        src_match = re.search(r"SRC=(\d+\.\d+\.\d+\.\d+)", line)
        dst_match = re.search(r"DST=(\d+\.\d+\.\d+\.\d+)", line)
        return build_record(
            "5651_FIREWALL",
            "BLOCK",
            "WARNING",
            "firewall",
            src_match.group(1) if src_match else "0.0.0.0",
            dst_match.group(1) if dst_match else LOCAL_IP,
            f"Güvenlik duvarı (UFW) gelen ağ paketini engelledi: {line.strip()[:140]}"
        )

    return None


def watch_logs():
    process = subprocess.Popen(
        ["journalctl", "-f", "-n", "0"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    print("Kali Linux canlı log izleme aktif...")

    for line in process.stdout:
        record = parse_line(line)
        if record:
            db.collection("logs").add(record)
            print(f"[{record['timestamp']}] {record['log_type']} | {record['severity']} | SHA256:{record['integrity_hash'][:12]}...")


if __name__ == "__main__":
    watch_logs()
