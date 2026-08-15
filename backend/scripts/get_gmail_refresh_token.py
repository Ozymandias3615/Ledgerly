"""One-time local setup script: authorizes this app to send email as a
Gmail account via the Gmail API, and prints a refresh token to put in
Render's env vars (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN).

Run this on your own machine, not on Render - it opens a browser window
for you to approve the "send email" permission as n.abbiw10@gmail.com (or
whichever account you're authorizing), then prints the refresh token here
in the terminal. It is never sent anywhere except Google's own token
endpoint.

Usage:
    python get_gmail_refresh_token.py
"""
import http.server
import threading
import urllib.parse
import webbrowser
from getpass import getpass

import httpx

REDIRECT_PORT = 8765
REDIRECT_URI = f"http://localhost:{REDIRECT_PORT}/"
SCOPE = "https://www.googleapis.com/auth/gmail.send"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"

_auth_code = {}


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        _auth_code["code"] = params.get("code", [None])[0]
        _auth_code["error"] = params.get("error", [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        message = "You can close this tab and go back to the terminal." if _auth_code["code"] else "Authorization failed - check the terminal."
        self.wfile.write(f"<html><body><p>{message}</p></body></html>".encode())

    def log_message(self, format, *args):
        pass  # silence default request logging


def main():
    client_id = input("Client ID: ").strip()
    client_secret = getpass("Client Secret (input hidden): ").strip()

    server = http.server.HTTPServer(("localhost", REDIRECT_PORT), _CallbackHandler)
    thread = threading.Thread(target=server.handle_request, daemon=True)
    thread.start()

    auth_params = {
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        # Forces Google to always return a refresh_token, even if this
        # account already authorized this app before.
        "prompt": "consent",
    }
    url = f"{AUTH_URL}?{urllib.parse.urlencode(auth_params)}"
    print(f"\nOpening your browser to authorize... if it doesn't open, visit:\n{url}\n")
    webbrowser.open(url)

    thread.join(timeout=180)
    server.server_close()

    if not _auth_code.get("code"):
        print(f"\nAuthorization failed: {_auth_code.get('error') or 'timed out waiting for browser response'}")
        return

    resp = httpx.post(TOKEN_URL, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "code": _auth_code["code"],
        "grant_type": "authorization_code",
        "redirect_uri": REDIRECT_URI,
    })
    resp.raise_for_status()
    tokens = resp.json()
    refresh_token = tokens.get("refresh_token")

    if not refresh_token:
        print("\nNo refresh_token in the response - this can happen if this exact app already had a token issued")
        print("for this account before. Go to https://myaccount.google.com/permissions, remove access for this")
        print("app, and run this script again.")
        print(tokens)
        return

    print("\nSuccess. Set these three env vars in Render (ledgerly-api service):\n")
    print(f"  GMAIL_CLIENT_ID={client_id}")
    print(f"  GMAIL_CLIENT_SECRET={client_secret}")
    print(f"  GMAIL_REFRESH_TOKEN={refresh_token}")


if __name__ == "__main__":
    main()
