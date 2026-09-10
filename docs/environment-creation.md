# Creation progress on the graph

Creating a container, NVIDIA CUDA container, MicroVM or VM closes the creation
form immediately after its local validation. The desktop command continues and
the graph shows the real environment node with a spinner and **Creating…**.
Start, Stop and Delete are unavailable while preparation is in progress.

The shared creation lifecycle in `src-tauri/src/commands/vm_creation.rs` reserves
the name and persists the final node ID before image downloads or disk work.
Completion updates that same node to Stopped. Failures keep the node and its
error, including after a restart interrupted preparation. Original source images
and boot media remain intact. Runtime prerequisite and input rejections that
happen before creation are reported through the application notification.

The platform provider owns the request, event updates and progress polling. A
completed or failed request cannot close or overwrite a newly opened form. The
onboarding guide follows its pending container on the graph and continues only
after successful preparation; an early failure lets the user explicitly reopen
the form.

The existing CLI continues to wait for completion unless its normal job options
request otherwise. The request schema and environment IDs are unchanged.

Validated on 2026-09-10: lint, production frontend build, 31 script tests, 309
frontend tests, 152 native unit tests, and 12 browser checks covering all four
creation categories, failure handling, subsequent drafts, node placement and the
full onboarding walkthrough. Native tests also checked a real VM disk and the
container/MicroVM/VM lifecycle through the CLI transport, including cleanup of
all disposable workloads. Existing user environments were not operated on.

Windows EXE/MSI archives passed integrity and embedded-binary checks. The Ubuntu
DEB passed its installation and application/CLI smoke test. The local website's
download sync, production build, release check and download browser test passed.
The files use `-20260910-background-create`; earlier terminal-colour installers
are retained in `tmp/installers-before-background-create-20260910` in the website
project. The running Windows app was not replaced and the live website was not
deployed.

| Package | SHA-256 |
| --- | --- |
| Windows EXE | `cc13761d74930b0c075a89beebd3df7435e50a0ddce7276c333cd97f8e3e642f` |
| Windows MSI | `882c6765bf27dee110dff1fb0f8849a2848939923ab28a64660969c2b82ce839` |
| Ubuntu DEB | `f69f7e99f1e4556c8082a1e560a3ca6ad551c6fd173a573d13268298df1fd206` |
