const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { shell } = require("electron");

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function callbackPage({ ok }) {
  const icon = ok
    ? `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
         <circle cx="12" cy="12" r="12" fill="#16a34a"/>
         <path d="M7 12.5l3 3 7-7" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
       </svg>`
    : `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
         <circle cx="12" cy="12" r="12" fill="#dc2626"/>
         <path d="M8 8l8 8M16 8l-8 8" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
       </svg>`;
  const title = ok ? "You're signed in" : "Sign-in failed";
  const subtitle = ok
    ? "You can close this window and return to Ledgerly."
    : "Something went wrong. You can close this window and try again in Ledgerly.";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Ledgerly</title>
<style>
  html, body {
    height: 100%;
    margin: 0;
    background: #0f172a;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  }
  .wrap {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .card {
    background: #ffffff;
    border-radius: 12px;
    padding: 40px 44px;
    max-width: 360px;
    text-align: center;
    box-shadow: 0 20px 50px rgba(0,0,0,0.35);
  }
  .icon { margin-bottom: 18px; }
  h1 {
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.01em;
    color: #0f172a;
    margin: 0 0 8px;
  }
  p {
    font-size: 14px;
    color: #64748b;
    margin: 0;
    line-height: 1.5;
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="icon">${icon}</div>
      <h1>${title}</h1>
      <p>${subtitle}</p>
    </div>
  </div>
</body>
</html>`;
}

function postForm(url, form) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid token response: ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Google blocks its sign-in page inside embedded webviews (Electron's window included),
// so this opens the OS browser for consent and catches the redirect on a local loopback
// server instead - the standard "installed app" OAuth2 flow, using PKCE since Desktop
// app OAuth clients are public clients.
function signInWithGoogle({ clientId, clientSecret }) {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());

  return new Promise((resolve, reject) => {
    let redirectUri;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      reject(new Error("Google sign-in timed out"));
    }, 5 * 60 * 1000);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(error ? callbackPage({ ok: false }) : callbackPage({ ok: true }));
      res.on("finish", () => server.close());

      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(new Error(error));
      else if (code) resolve({ code, redirectUri });
      else reject(new Error("No authorization code returned"));
    });

    server.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", "openid email profile");
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("prompt", "select_account");
      shell.openExternal(authUrl.toString());
    });
  }).then(async ({ code, redirectUri }) => {
    const tokenResponse = await postForm("https://oauth2.googleapis.com/token", {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    if (tokenResponse.error) {
      throw new Error(tokenResponse.error_description || tokenResponse.error);
    }
    return tokenResponse.id_token;
  });
}

module.exports = { signInWithGoogle };
