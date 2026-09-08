ONNX Runtime Web 1.29.0 single-thread WASM runtime asset.

Package: onnxruntime-web@1.29.0
Registry: https://registry.npmjs.org/onnxruntime-web/1.29.0
Registry integrity: sha512-LuQlpX6MFLJZu756erwUeb1mNfoJGbs1kzDwJGNlf5RvfYMdqhcY3vNpDPK40CUV2HoWTkIj+uS0o36GFHjeYw==
Runtime package source path: dist/ort-wasm-simd-threaded.wasm
Bytes: 13961845
SHA-256: ec8580a9d7b9476ceee52e10a7f94124e4dc71a019d666ed6d4726697c109a4d
License: MIT; see LICENSE.upstream.txt and ThirdPartyNotices.upstream.txt in this directory.

Vite emits this exact package file once as a content-hashed build asset. The
application configures one WASM thread. Multithreaded deployment,
WebGPU, memory, performance, and sustained-load behavior are separate gates.
