import type { CommandResult } from "@/types/platform"

export const tourWebsitePort = 3000
function marker(run: string) {
  if (!/^[\w-]{1,80}$/.test(run)) throw new Error("Invalid tutorial ID")
  return `opendock-hello-${run}`
}
const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`
const pythonCommand = (code: string) => `python3 -c ${quote(`exec(${JSON.stringify(code)})`)}`

// A fixed response, NOT a directory server: no files, environment variables,
// request bodies or query strings are read or reflected in the public page.
export function helloWebsitePython(run: string, host = "0.0.0.0", port = tourWebsitePort) {
  if (!["0.0.0.0", "127.0.0.1"].includes(host) || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid demo listener")
  return `from http.server import BaseHTTPRequestHandler, HTTPServer
page = b'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="opendock-demo" content="${marker(run)}"><title>Hello World</title><body><h1>Hello World!</h1><p>My first website in Yougori.</p></body></html>'
class Hello(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(page)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(page)
    def log_message(self, *args):
        pass
server = HTTPServer(('${host}', ${port}), Hello)
print('Hello World ready on port ' + str(server.server_port) + '. Keep this terminal open; Ctrl+C stops it.', flush=True)
server.serve_forever()`
}

export function helloWebsiteCommand(run: string) {
  const script = `set -e; od_demo_root() { if [ "$(id -u)" = 0 ]; then "$@"; elif command -v sudo >/dev/null 2>&1; then sudo "$@"; else printf '%s\\n' 'Python setup needs root or sudo. Use an Ubuntu, Debian or Alpine container.' >&2; return 1; fi; }; if ! command -v python3 >/dev/null 2>&1; then if command -v apk >/dev/null 2>&1; then od_demo_root apk add --no-cache python3; elif command -v apt-get >/dev/null 2>&1; then od_demo_root apt-get update && od_demo_root apt-get install -y --no-install-recommends python3; elif command -v dnf >/dev/null 2>&1; then od_demo_root dnf install -y python3; elif command -v microdnf >/dev/null 2>&1; then od_demo_root microdnf install -y python3; elif command -v yum >/dev/null 2>&1; then od_demo_root yum install -y python3; elif command -v zypper >/dev/null 2>&1; then od_demo_root zypper --non-interactive install python3; else printf '%s\\n' 'Install Python 3 in this container, then retry.' >&2; exit 1; fi; fi; exec ${pythonCommand(helloWebsitePython(run))}`
  return `sh -c ${quote(script)}`
}

export function helloWebsiteCheck(run: string) {
  return pythonCommand(`import urllib.request
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
with opener.open('http://127.0.0.1:${tourWebsitePort}/', timeout=3) as response:
    page = response.read(4096)
if b'${marker(run)}' not in page:
    raise SystemExit('Port ${tourWebsitePort} is not this tutorial website. Do not publish it.')
print('${marker(run)}')`)
}
export async function verifyHelloWebsite(execute: (id: string, command: string) => Promise<CommandResult>, id: string, run: string) {
  const result = await execute(id, helloWebsiteCheck(run))
  if (result.exitCode !== 0 || result.stdout.trim() !== marker(run)) throw new Error("Hello World is not ready on port 3000. Check the website terminal for errors and keep it open. If the port is already in use, do not publish that other app; stop it yourself or use a fresh tutorial container, then retry.")
}
