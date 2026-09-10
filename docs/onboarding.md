# First-run instructions

The overview draws a temporary **Tutorial preview** node in the home window.
It is graph presentation only: it is never saved as an environment, included in
resource totals, or sent to runtime and service APIs. It disappears on Skip to hands-on,
when the overview ends, and when the guide finishes. Real environments remain.

During the overview, **Skip to hands-on** jumps to the first practical step and
keeps the guide open. During hands-on, **Skip** ends the guide. Escape follows the
same behaviour, and holding Escape does not skip both stages in one keypress.

The practice guide creates one standard container with the default OCI image
and keep-alive command. Type, image and startup choices stay fixed during the
guide; names and resource limits remain editable. Skipping or finishing restores
the normal choices. Guest windows stay on that tutorial's container.

At the website step, Yougori automatically installs Python if needed, writes
`index.html` and `server.py` under
`~/.local/share/yougori/tutorials/<tour-run>/`, and starts the page on port 3000.
The process runs independently of terminal tabs and windows. Stopping the
container stops it; setup can be retried while the guide remains at that step.
Files remain in the container. The server log and PID are stored alongside them.

Only the selected tutorial container receives the command. Repeated UI mounts
share one pending request, and a guest file lock plus the page's unique response
marker prevents duplicate servers on retries. An occupied port belonging to
another website produces an error; its process and files are left alone.
Skipping during setup prevents a late result from advancing the dismissed guide.
An already dispatched setup can finish, and Skip does not remove the real project.

The demo is a responsive, self-contained page in Yougori's ivory/graphite theme.
It fetches no external assets and serves only its fixed HTML, regardless of the
requested URL. Publishing remains a separate action and checks the current
tutorial's response before opening a public tunnel.

## Validation, 10 September 2026

- Lint, production frontend build, 28 packaging/script checks and 305 app tests passed.
- All 10 instruction browser tests passed: empty-workspace preview cleanup,
  default-only creation, window handoff, automatic setup, retries, Skip,
  publication checks, and responsive demo layout down to 320 pixels.
- An isolated WSL Linux network namespace exercised the real generated Python
  setup: two simultaneous builds and a retry used one detached server; another
  tutorial could not replace it; arbitrary request paths did not disclose files.
- Windows EXE/MSI and native Ubuntu DEB rebuilt with the same frontend. Windows
  archive integrity passed; the EXE contains the freshly compiled app (with
  Tauri's expected installer-type marker). The Ubuntu package passed icon,
  metadata, native executable, and isolated non-root installed app/CLI checks.
- The broader graph suite passed 108 of 111 tests. The three failures are the
  existing standalone shared-file browser upload cases (LF, CRLF and CR input).
  Those cases serve `connection_files.html` without loading the modified app.

`npm test` scans `src` explicitly so packaged copies of third-party source tests
under `src-tauri/target` are not accidentally rediscovered as application tests.

## Two-stage Skip validation, 10 September 2026

- Lint, production frontend build, and all 10 instruction/preview unit tests passed.
- All 10 instruction browser tests passed, including Skip from the welcome and
  later overview steps, preview removal, a second Skip during hands-on, manual
  replay, and held Escape. The complete container and website walkthrough also passed.
- Rebuilt Windows EXE/MSI archives passed integrity checks and contained the fresh
  application, CLI, CUDA agent and microVM agent. The native Ubuntu DEB passed
  branding, metadata, native executable and isolated installed app/CLI checks.
- Local website downloads use the `-20260910-hands-on` suffix. Copies were verified
  by SHA-256; the website build, release checks and production download browser
  test passed. Previous local download files were retained in
  `tmp/installers-before-hands-on-20260910` in the website repository.
- The installed Windows app was not replaced. Release assets were not uploaded
  and the live website was not deployed.

| Package | SHA-256 |
| --- | --- |
| Windows EXE | `09694ddbd9869437c5c9a0daebd5247b552af28045beebb8c479742937a5b553` |
| Windows MSI | `78628690590358e5020781013dcf642f60bf47ed5655ed967c1a1daf795718b1` |
| Ubuntu DEB | `e14f225dbf49985b04e4d37938297c19d1de957a10824dece30e6c65e242e08e` |
