# VM memory diagnostics

Integrated in `src-tauri/src/runtime/vm_memory.rs` and the full VM/microVM startup path.
Windows available commit capacity is checked before preparation and before each launch.
Full VMs reserve maximum RAM; microVMs start with preferred RAM. Errors use GB and
point to Adjust memory or Stop on other VMs. Failed pc.ram allocation is translated
without retrying an unrelated CPU accelerator. Unknown commit capacity does not block
startup, and unrelated errors are preserved.

Run `cargo test --manifest-path src-tauri/Cargo.toml vm_memory` for the unit tests.
No guest disks or host paging settings are changed by this check.
