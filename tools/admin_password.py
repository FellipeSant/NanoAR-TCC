#!/usr/bin/env python3
"""Gera o "hash" da senha da página admin.html (a senha em si nunca fica no código).

Uso:
    python tools/admin_password.py            # pede a senha sem mostrar na tela
Copie as três linhas impressas para o objeto ADMIN no início de js/admin-auth.js.
Atenção: o token do GitHub guardado em config/admin-key.json está criptografado com a senha antiga;
depois de trocar a senha, quem cuida do site precisa "Liberar para todos os administradores" de novo.
"""
import getpass, hashlib, os, sys

ITERATIONS = 600_000
pw = sys.argv[1] if len(sys.argv) > 1 else getpass.getpass('Nova senha: ')
salt = os.urandom(16)
digest = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), salt, ITERATIONS, 32)
print(f"  passwordSalt: '{salt.hex()}',")
print(f"  passwordHash: '{digest.hex()}',")
print(f"  iterations: {ITERATIONS},")
