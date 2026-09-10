# Terminal colours

Yougori's host and guest terminals use the Windows Terminal Campbell palette,
including all 16 ANSI colours. Programs can also choose 256-colour and truecolour
output. The terminal receives the original PTY bytes; it does not guess colours
from command text or rewrite program output.

Previously, host shells skipped user profiles and the Yougori CLI always printed
plain JSON and help. A desktop started by an automation tool could also inherit
`NO_COLOR=1`, `FORCE_COLOR=0` or `TERM=dumb`.

New host terminals load normal PowerShell, Bash or Zsh profiles. PowerShell keeps
PSReadLine syntax highlighting and session-only history. The child shell gets
`TERM=xterm-256color`, `COLORTERM=truecolor`, `CLICOLOR=1` and
`TERM_PROGRAM=Yougori`; inherited colour-disabling flags are cleared there. System
settings and existing terminals are untouched. Personal shell profiles can still
customise colours. PowerShell's treatment of these environment variables is
documented in [Microsoft's ANSI terminal documentation](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_ansi_terminals?view=powershell-7.5).

Interactive container and built-in microVM shells advertise the same colour
support and start Bash when available, otherwise the image's `/bin/sh`. The image
still supplies the shell, commands and profiles. Noninteractive environment
commands and workload services keep their environment.

The Yougori CLI highlights JSON keys, values, numbers and booleans, plus command
help, only when stdout is a terminal. Pipes and files receive ordinary parseable
JSON. A nonempty `NO_COLOR` or `TERM=dumb`/`xterm-mono` disables CLI colouring.
Programs that intentionally print plain text continue to do so.

Verification covers JSON round trips with Unicode and escaped strings, redirected
output, child-shell environment setup, a real PowerShell ConPTY with PSReadLine
and interactive/piped CLI output, and browser rendering of ordinary ANSI, bright,
256-colour and RGB text in both host and container panels. The guest agent tests
execute the actual shell bootstrap in Linux.

Apply the new desktop package and open new terminal tabs. The guest agent payloads
are bundled with the package; guest runtimes pick them up through their normal
restart/update flow. Running user workloads are not restarted by this change.

Validated on 2026-09-10: lint and production builds, 31 script tests, 306 frontend
tests, 25 CLI tests, 151 native unit tests, the Linux Go agent suite, three browser
terminal tests, and real PowerShell, container and microVM terminal integration
tests passed. The Ubuntu package also passed an isolated installation and app/CLI
smoke test. The Windows and Ubuntu installers include the earlier onboarding and
storage/CUDA fixes.

Both Windows archives were checked for integrity and compared byte-for-byte with
the newly compiled application, CLI, CUDA agent and microVM agent. The local
website's download sync, production build, release check and download browser
test passed. Its files use the suffix `-20260910-terminal-colors`; earlier
packages are retained in the website's `tmp/installers-before-terminal-colors-20260910`.
The installed Windows app was not replaced and the live website was not deployed.

| Package | SHA-256 |
| --- | --- |
| Windows EXE | `b176cde1cb1eb336a90ea6c91caf69c417e2c8560ce04de6e9de6cb5fc4fc751` |
| Windows MSI | `21b7a723a17388e42c0a2686cd821fb620001b4bbfbcf29a27804719f6840537` |
| Ubuntu DEB | `59dea48c3a6fed000cb9762fd313b7bfafe2b7f052a6e812ad0fb1dfde9c280a` |
