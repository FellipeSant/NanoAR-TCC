#!/usr/bin/env python3
"""Serve o site por HTTPS na rede local, para testar no celular (câmera e giroscópio exigem https).

Uso (computador e celular no mesmo Wi-Fi):
    python3 tools/serve_https.py            # porta 8443
No celular, abra o endereço impresso. O navegador vai avisar que o certificado não é confiável
(é um certificado feito só para este teste): toque em "Avançado" → "Continuar".
Para parar: Ctrl+C. Enquanto estiver rodando, qualquer aparelho desta rede pode abrir o site.
"""
import http.server
import os
import socket
import ssl
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CERT_DIR = os.path.join(os.path.expanduser('~'), '.cache', 'nanoar-https')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))  # não envia nada; só descobre a interface da rede local
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


def ensure_cert(ip):
    os.makedirs(CERT_DIR, exist_ok=True)
    cert, key = os.path.join(CERT_DIR, f'{ip}.crt'), os.path.join(CERT_DIR, f'{ip}.key')
    if not (os.path.exists(cert) and os.path.exists(key)):
        subprocess.run([
            'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
            '-keyout', key, '-out', cert, '-subj', '/CN=NanoAR teste local',
            '-addext', f'subjectAltName=IP:{ip},IP:127.0.0.1,DNS:localhost',
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return cert, key


def main():
    ip = lan_ip()
    cert, key = ensure_cert(ip)
    class NoCache(http.server.SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')  # recarregar no celular sempre pega a versão nova
            super().end_headers()

    handler = lambda *a, **k: NoCache(*a, directory=ROOT, **k)
    httpd = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(f'Site:         https://{ip}:{PORT}/')
    print(f'Laboratório:  https://{ip}:{PORT}/lab/')
    print('No celular, aceite o aviso do certificado (Avançado → Continuar). Ctrl+C para parar.')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
