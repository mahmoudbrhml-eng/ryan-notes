#!/usr/bin/env python3
"""Verify GH/VC/SB tokens from scripts/.env-tokens. Prints ONLY status info, never the token itself."""
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(HERE, ".env-tokens")


def load_tokens():
    toks = {}
    with open(TOKEN_FILE) as f:
        for line in f:
            line = line.strip()
            if line.startswith("export "):
                line = line[len("export "):]
            k, _, v = line.partition("=")
            if k in ("GH", "VC", "SB"):
                toks[k] = v.strip().strip("'\"")
    return toks


def get(url, tok, scheme):
    req = urllib.request.Request(url, headers={"Authorization": f"{scheme} {tok}", "User-Agent": "ryan-notes-check"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, {}


def main():
    t = load_tokens()
    # GitHub
    code, data = get("https://api.github.com/user", t["GH"], "token")
    login = data.get("login", "?") if code == 200 else "?"
    print(f"GITHUB: {'OK' if code == 200 else 'FAIL ' + str(code)} (user: {login})")
    # Vercel
    code, data = get("https://api.vercel.com/v2/user", t["VC"], "Bearer")
    u = data.get("user", {})
    print(f"VERCEL: {'OK' if code == 200 else 'FAIL ' + str(code)} (user: {u.get('username', '?')}, team ok)")
    # Supabase (management API, project scope)
    code, data = get("https://api.supabase.com/v1/projects/hieqmpdvpfrxmcelphlw", t["SB"], "Bearer")
    print(f"SUPABASE: {'OK' if code == 200 else 'FAIL ' + str(code)} (project: {data.get('name', '?')}, region: {data.get('region', '?')})")


if __name__ == "__main__":
    main()
