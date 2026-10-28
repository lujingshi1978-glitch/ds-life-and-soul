# Creator pipe compatibility addon

The release contains one native addon:
`packages/feiyu/plugins/qq-agent-presets/creator-pipe-shim.node`.
It was rebuilt from the adjacent MIT-licensed C source for this release with
the already installed Microsoft C/C++ x64 compiler 19.44.35229 and linker
14.44.35229.0. Two isolated builds produced the same SHA-256.

To reproduce, open an **x64 Native Tools Command Prompt for Visual Studio**,
copy `creator-pipe-shim.c` into an empty working directory, and run:

```cmd
cl /LD /O2 /GS /guard:cf /utf-8 creator-pipe-shim.c advapi32.lib /Fe:creator-pipe-shim.node /link /INCREMENTAL:NO /Brepro
```

The SDK headers and import library come from your installed Windows SDK.
No SDK/runtime distribution or compiler output other than the single `.node`
file is redistributed. `native-artifacts.json` pins the source, binary and
license hashes. A different compiler/SDK may produce a different binary.

The addon is Windows x64 only and exposes the Node-API entry point. It redirects
libuv pipe names within the same Windows AppContainer's local namespace. It
does not establish the creator sandbox. Initialization outside an AppContainer
fails closed. Other platforms cannot use this precompiled addon.

Creator execution remains disabled in the generated configuration. A separately
verified creator runtime is still required; this addon does not enable creator
execution or provide any fallback to unrestricted host execution. The release
audit rebuilt and inspected the binary; it did not execute a creator workload.
