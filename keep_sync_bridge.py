#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
DRIVER PYTHON: GOOGLE KEEP API BRIDGE (keep_sync_bridge.py)
=============================================================================
Conecta o Stack-chan diretamente à conta do Google Keep via gkeepapi usando
Master Token (App Password ou Master Token OAuth).

Instalação opcional:
  pip install gkeepapi

Configuração no .env:
  GOOGLE_KEEP_EMAIL=seu_email@gmail.com
  GOOGLE_KEEP_MASTER_TOKEN=oauth2_4/0AY0... (ou senha de app)
=============================================================================
"""

import sys
import os
import json
import argparse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"
SYNC_FILE = BASE_DIR / "keep_notes_sync.json"


def load_env_vars():
    env = {}
    if ENV_FILE.exists():
        try:
            with open(ENV_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        k, v = line.split("=", 1)
                        env[k.strip()] = v.strip().strip("'\"")
        except Exception as e:
            print(f"[KeepBridge] Erro ao ler .env: {e}", file=sys.stderr)
    return env


def main():
    parser = argparse.ArgumentParser(description="Google Keep Sync Bridge via gkeepapi")
    parser.add_argument("action", choices=["create_note", "append_note", "read_notes", "sync"], help="Ação a executar")
    parser.add_argument("--payload", type=str, default="{}", help="Dados em JSON da nota")
    args = parser.parse_args()

    try:
        import gkeepapi
    except ImportError:
        print("[KeepBridge] Biblioteca 'gkeepapi' não instalada. Para usar automação nativa do Keep, execute: pip install gkeepapi", file=sys.stderr)
        sys.exit(2)

    env = load_env_vars()
    email = os.environ.get("GOOGLE_KEEP_EMAIL") or env.get("GOOGLE_KEEP_EMAIL")
    token = os.environ.get("GOOGLE_KEEP_MASTER_TOKEN") or env.get("GOOGLE_KEEP_MASTER_TOKEN")

    if not email or not token:
        print("[KeepBridge] GOOGLE_KEEP_EMAIL ou GOOGLE_KEEP_MASTER_TOKEN ausentes no .env.", file=sys.stderr)
        sys.exit(3)

    keep = gkeepapi.Keep()
    try:
        keep.authenticate(email, token)
        print(f"[KeepBridge] Autenticado com sucesso no Google Keep como: {email}")
    except Exception as e:
        print(f"[KeepBridge] Falha na autenticação do Google Keep: {e}", file=sys.stderr)
        sys.exit(4)

    try:
        data = json.loads(args.payload)
    except Exception:
        data = {}

    if args.action == "create_note":
        title = data.get("title", "Nova Nota")
        content = data.get("content", "")
        is_list = bool(data.get("is_list", False))

        if is_list:
            items = [item.strip() for item in content.replace("\r", "").split("\n") if item.strip()]
            note = keep.createList(title, [(it, False) for it in items])
        else:
            note = keep.createNote(title, content)

        keep.sync()
        print(json.dumps({"ok": True, "id": note.id, "title": note.title}))

    elif args.action == "append_note":
        query = data.get("search_query") or data.get("title") or ""
        new_content = data.get("new_content", "")
        notes = list(keep.find(query=query))
        if not notes:
            # Se não achou por query, busca todas e tenta título parcial
            for n in keep.all():
                if query.lower() in (n.title or "").lower():
                    notes = [n]
                    break

        if notes:
            note = notes[0]
            if hasattr(note, "add") and callable(note.add):
                # É checklist
                for line in new_content.split("\n"):
                    if line.strip():
                        note.add(line.strip(), False)
            else:
                note.text = (note.text or "") + "\n\n" + new_content
            keep.sync()
            print(json.dumps({"ok": True, "id": note.id, "title": note.title}))
        else:
            # Cria se não existir
            note = keep.createNote(query or "Anotações", new_content)
            keep.sync()
            print(json.dumps({"ok": True, "id": note.id, "title": note.title, "created": True}))

    elif args.action in ("read_notes", "sync"):
        keep.sync()
        notes_out = []
        for n in keep.all():
            if n.trashed or n.archived:
                continue
            is_lst = hasattr(n, "items")
            content_str = "\n".join([f"- {it.text}" for it in n.items]) if is_lst else (n.text or "")
            notes_out.append({
                "id": n.id,
                "title": n.title or "Sem Título",
                "content": content_str,
                "is_list": is_lst,
                "timestamps": str(n.timestamps.updated if hasattr(n.timestamps, "updated") else "")
            })

        # Salva espelho no arquivo local keep_notes_sync.json
        try:
            with open(SYNC_FILE, "w", encoding="utf-8") as f:
                json.dump({"version": 1, "updated_at": str(keep.sync()), "notes": notes_out}, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[KeepBridge] Erro ao gravar {SYNC_FILE}: {e}", file=sys.stderr)

        print(json.dumps({"ok": True, "count": len(notes_out), "notes": notes_out[:10]}))


if __name__ == "__main__":
    main()
