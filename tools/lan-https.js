#!/usr/bin/env node
/**
 * Serve the app over HTTPS on this machine's network address.
 *
 * ## Why this exists
 *
 * Browsers only hand the camera to a *secure context*. `http://localhost`
 * counts; `http://192.168.x.x` does not — so the QR scanner works on the
 * machine running the app and refuses on the phone you actually want to hold.
 * That is the browser being right, and no amount of application code changes
 * it. The page has to be served over HTTPS.
 *
 * So this puts a TLS front door on port 3443 and forwards everything to the
 * Next server on 3000. Nothing about the app changes; it still sees ordinary
 * HTTP from a local client.
 *
 * ## The certificate
 *
 * Self-signed, generated on first run into `tools/certs/` (gitignored), with
 * the machine's current LAN address in the subjectAltName — an IP SAN, because
 * a certificate naming only a hostname is not valid for a URL that is an IP.
 * It is regenerated whenever the address changes, since a router handing out a
 * new lease would otherwise silently break it.
 *
 * Nothing signed it, so the phone shows a warning the first time. Accepting it
 * is what makes the origin a secure context, and from then on the camera works.
 * That warning is honest — the certificate really is untrusted — and it is the
 * price of not sending your traffic through somebody else's server.
 *
 * ## The alternative, if the warning is a nuisance
 *
 *     cloudflared tunnel --url http://localhost:3000
 *
 * gives a real HTTPS URL with a certificate every device already trusts,
 * reachable from anywhere. The trade is that the traffic leaves your network.
 *
 *     node tools/lan-https.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const http = require("http");
const { execFileSync } = require("child_process");

const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const TARGET_PORT = Number(process.env.TARGET_PORT || 3000);
const CERT_DIR = path.join(__dirname, "certs");
const KEY_FILE = path.join(CERT_DIR, "lan.key");
const CRT_FILE = path.join(CERT_DIR, "lan.crt");
const ADDR_FILE = path.join(CERT_DIR, "issued-for.txt");

/** This machine's address on the local network, ignoring virtual adapters. */
function lanAddress() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" || a.internal) continue;
      // Hyper-V, WSL and Docker adapters are on this machine but not on the
      // network the phone is on, so they are the wrong answer here.
      const virtual = /vEthernet|VirtualBox|VMware|Loopback|Docker|WSL/i.test(name);
      candidates.push({ name, address: a.address, virtual });
    }
  }
  const real = candidates.find((c) => !c.virtual);
  return (real || candidates[0])?.address || "127.0.0.1";
}

function ensureCertificate(address) {
  fs.mkdirSync(CERT_DIR, { recursive: true });

  const issuedFor = fs.existsSync(ADDR_FILE)
    ? fs.readFileSync(ADDR_FILE, "utf8").trim()
    : null;

  const usable =
    fs.existsSync(KEY_FILE) && fs.existsSync(CRT_FILE) && issuedFor === address;

  if (usable) return;

  if (issuedFor && issuedFor !== address) {
    console.log(`Address changed (${issuedFor} → ${address}); making a new certificate.`);
  } else {
    console.log("No certificate yet; making one.");
  }

  // An IP SAN is the point: a certificate naming only a hostname is not valid
  // for https://192.168.x.x, and the browser will refuse it outright rather
  // than offering the warning you can click through.
  const config = `
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no

[dn]
CN = ${address}

[ext]
subjectAltName = IP:${address}, IP:127.0.0.1, DNS:localhost
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
`;
  const configFile = path.join(CERT_DIR, "openssl.cnf");
  fs.writeFileSync(configFile, config);

  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", KEY_FILE,
      "-out", CRT_FILE,
      "-days", "365",
      "-config", configFile,
    ],
    { stdio: "pipe" }
  );

  fs.writeFileSync(ADDR_FILE, address);
  console.log(`Certificate written for ${address}.`);
}

function start(address) {
  const server = https.createServer(
    { key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CRT_FILE) },
    (req, res) => {
      /*
       * Forwarded as-is, including the Origin header.
       *
       * That matters: Next passes Origin through to the API, and the API's
       * development CORS rule allows private addresses — so an https origin on
       * a LAN address is allowed for the same reason the http one is.
       */
      const upstream = http.request(
        {
          host: "127.0.0.1",
          port: TARGET_PORT,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
          upstreamRes.pipe(res);
        }
      );

      upstream.on("error", (err) => {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(
          `Cannot reach the app on port ${TARGET_PORT}.\n\n` +
            `Start it first:  npx next start\n\n${err.message}\n`
        );
      });

      req.pipe(upstream);
    }
  );

  // Next uses websockets in development; without this they fail silently.
  server.on("upgrade", (req, socket, head) => {
    const upstream = http.request({
      host: "127.0.0.1",
      port: TARGET_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers,
    });
    upstream.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n` +
          Object.entries(upstreamRes.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\r\n") +
          "\r\n\r\n"
      );
      if (upstreamHead?.length) socket.unshift(upstreamHead);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstream.on("error", () => socket.destroy());
    if (head?.length) upstream.write(head);
    upstream.end();
  });

  server.listen(HTTPS_PORT, "0.0.0.0", () => {
    console.log("");
    console.log("  Open this on your phone:");
    console.log(`    https://${address}:${HTTPS_PORT}`);
    console.log("");
    console.log("  The certificate is self-signed, so the first visit shows a warning.");
    console.log("  Accept it once — that is what makes the camera available.");
    console.log("");
    console.log(`  Forwarding to http://127.0.0.1:${TARGET_PORT}`);
    console.log("");
  });
}

const address = lanAddress();
ensureCertificate(address);
start(address);
