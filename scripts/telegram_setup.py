#!/usr/bin/env python3
"""One-shot Telegram bot setup for Ryan Notes.

Reads tokens from scripts/.env-tokens:
  export TG=...   -> bot token from @BotFather
  export VC=...   -> Vercel token
  (optional existing export TGWH=... -> webhook secret; generated & saved if missing)

Does, in order:
  1. Validates the bot token via getMe (prints bot username, never the token).
  2. Adds TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET to Vercel env
     (all targets, upsert).
  3. Registers the webhook on the production URL with the secret.
  4. Prints getWebhookInfo as the final confirmation.
"""
import json
import os
import secrets
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(HERE, ".env-tokens")
TEAM = "team_o8kAx4heEKQNsuI1ti1EhpN8"
PROJECT = "prj_cDwYcL1BNecbc8TJpqmZ6LeRBD51"
WEBHOOK_URL = "https://ryan-notes-zeta.vercel.app/api/telegram/webhook"


def load_tokens():
    toks = {}
    if os.environ.get("TG") and os.environ.get("VC"):
        toks["TG"] = os.environ["TG"].strip()
        toks["VC"] = os.environ["VC"].strip()
        if os.environ.get("TGWH"):
            toks["TGWH"] = os.environ["TGWH"].strip()
        return toks
    with open(TOKEN_FILE) as f:
        for line in f:
            line = line.strip()
            if line.startswith("export "):
                line = line[len("export "):]
            k, _, v = line.partition("=")
            if k in ("TG", "VC", "TGWH"):
                toks[k] = v.strip().strip("'\"")
    return toks


def save_webhook_secret(tok):
    """Persist TGWH into .env-tokens so future runs reuse the same secret."""
    with open(TOKEN_FILE) as f:
        content = f.read()
    if "TGWH=" in content:
        return
    with open(TOKEN_FILE, "a") as f:
        f.write(f"export TGWH={tok}\n")


def tg(method, token, payload=None):
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload or {}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def vercel(method, token, path, payload=None):
    req = urllib.request.Request(
        f"https://api.vercel.com{path}" + (f"?teamId={TEAM}" if "?" not in path else f"&teamId={TEAM}"),
        data=json.dumps(payload).encode() if payload else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode()
        return json.loads(body) if body else {}


def main():
    toks = load_tokens()
    tg_tok = toks.get("TG")
    vc_tok = toks.get("VC")
    if not tg_tok:
        raise SystemExit("Missing TG (bot token). Add `export TG=...` to scripts/.env-tokens")
    if not vc_tok:
        raise SystemExit("Missing VC (Vercel token). Add `export VC=...` to scripts/.env-tokens")

    # 1) validate bot token
    me = tg("getMe", tg_tok)
    if not me.get("ok"):
        raise SystemExit("Telegram rejected the bot token.")
    print(f"1) Bot OK: @{me['result']['username']}")

    # webhook secret (stable across runs)
    wh_secret = toks.get("TGWH") or secrets.token_urlsafe(24)
    save_webhook_secret(wh_secret)

    # 2) Vercel env vars (upsert, all targets)
    for key, val in (("TELEGRAM_BOT_TOKEN", tg_tok), ("TELEGRAM_WEBHOOK_SECRET", wh_secret)):
        vercel(
            "POST",
            vc_tok,
            f"/v10/projects/{PROJECT}/env?upsert=true",
            {"key": key, "value": val, "type": "encrypted",
             "target": ["production", "preview", "development"]},
        )
        print(f"2) Vercel env set: {key} (value never printed)")

    # 3) register the webhook
    wh = tg("setWebhook", tg_tok, {
        "url": WEBHOOK_URL,
        "secret_token": wh_secret,
        "allowed_updates": ["message"],
        "drop_pending_updates": True,
    })
    print(f"3) setWebhook: {'OK' if wh.get('ok') else wh}")

    # 4) confirm
    info = tg("getWebhookInfo", tg_tok)
    r = info.get("result", {})
    print(f"4) Webhook registered: {r.get('url') or '(none)'}  pending={r.get('pending_update_count', 0)}")
    print("\nDone. Redeploy the site (or push a commit) so the env vars reach the functions.")


if __name__ == "__main__":
    sys.exit(main())
