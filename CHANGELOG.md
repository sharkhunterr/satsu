# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.1.12](https://github.com/sharkhunterr/satsu/-/compare/v0.1.11...v0.1.12) (2026-03-02)


### Bug Fixes

* Docker volume permissions with gosu and PUID/PGID support ([c36e3e2](https://github.com/sharkhunterr/satsu/-/commit/c36e3e21aaba56b1110ae34d0345ed5fcc9306d4))

### [0.1.11](https://github.com/sharkhunterr/satsu/-/compare/v0.1.10...v0.1.11) (2026-03-02)


### Features

* remove About page, fix Logs page display ([af48a78](https://github.com/sharkhunterr/satsu/-/commit/af48a78db5763c35bc53f177c34b8ee94ffab3a6))

### [0.1.10](https://github.com/sharkhunterr/satsu/-/compare/v0.1.9...v0.1.10) (2026-03-02)


### Bug Fixes

* store auto-generated SSL certs in /data/certs/ instead of /certs/ ([699384d](https://github.com/sharkhunterr/satsu/-/commit/699384dd2c856f775a422e69bea2cf372d3d866e))

### [0.1.9](https://github.com/sharkhunterr/satsu/-/compare/v0.1.8...v0.1.9) (2026-03-02)


### Features

* auto-generate self-signed SSL certificate when HTTPS enabled ([77692fd](https://github.com/sharkhunterr/satsu/-/commit/77692fd9bccec227b02b7a3e4b0fb13c6f717c8c))

### [0.1.8](https://github.com/sharkhunterr/satsu/-/compare/v0.1.7...v0.1.8) (2026-03-02)


### Bug Fixes

* use hardcoded 'satsu' for Docker Hub repo name instead of CI_PROJECT_NAME ([143cbba](https://github.com/sharkhunterr/satsu/-/commit/143cbba246d01f69f37dad33002fc0496176141f))

### [0.1.7](https://github.com/sharkhunterr/satsu/-/compare/v0.1.6...v0.1.7) (2026-03-02)


### Bug Fixes

* correct frontend build output path in Dockerfile ([e99bb11](https://github.com/sharkhunterr/satsu/-/commit/e99bb117b1d6f2e34d452e3c7eb7269bc212649e))

### [0.1.6](https://github.com/sharkhunterr/satsu/-/compare/v0.1.5...v0.1.6) (2026-03-02)


### Bug Fixes

* replace obsolete libgl1-mesa-glx with libgl1 in Dockerfile ([1cd4b6f](https://github.com/sharkhunterr/satsu/-/commit/1cd4b6f19b08b29261d18f87fe2f6ee934241fda))

### [0.1.5](https://github.com/sharkhunterr/satsu/-/compare/v0.1.4...v0.1.5) (2026-03-02)


### Bug Fixes

* resolve test_config cross-test pollution, bump release notes to v0.1.5 ([1529907](https://github.com/sharkhunterr/satsu/-/commit/1529907cb1595a3760cba55eb805b808ee6f2fdf))

### [0.1.4](https://github.com/sharkhunterr/satsu/-/compare/v0.1.3...v0.1.4) (2026-03-02)


### Bug Fixes

* resolve remaining 4 CI test failures, bump release notes to v0.1.4 ([b2fd736](https://github.com/sharkhunterr/satsu/-/commit/b2fd736bf6a70718d9d3fd35c6cfee4a92e8c271))

### [0.1.3](https://github.com/sharkhunterr/satsu/-/compare/v0.1.2...v0.1.3) (2026-03-02)


### Bug Fixes

* resolve all CI test failures ([aff6ea2](https://github.com/sharkhunterr/satsu/-/commit/aff6ea247be6ab1c3ea58332852bc3d5881ef2a9))

### [0.1.2](https://github.com/sharkhunterr/satsu/-/compare/v0.1.1...v0.1.2) (2026-03-02)


### Bug Fixes

* CI pipeline errors — ruff output format, missing test deps, unused vars ([ae1d492](https://github.com/sharkhunterr/satsu/-/commit/ae1d49212b2a685398b4b93d3d0d982b37e808f0))

### 0.1.1 (2026-03-02)


### Features

* add branding assets (favicon, icons, banner) and README ([cba184c](https://github.com/sharkhunterr/satsu/-/commit/cba184cb4a4cdd3e7db8dd287084012c396d12db))
* configurable port and HTTPS support in Docker image ([c4a8a55](https://github.com/sharkhunterr/satsu/-/commit/c4a8a5548b7fb793c662235248284d5d44e022c0))
* implement full system — merged Home page, backend, firmware, frontend ([8f4a385](https://github.com/sharkhunterr/satsu/-/commit/8f4a38519e10191c5f6a805f6e71450599ccb4e7))
* interactive crop modal, configurable processing profiles, color mode ([1b1ffa7](https://github.com/sharkhunterr/satsu/-/commit/1b1ffa7e02432cc7cad2b2d2d79483d243183d39))
* per-profile storage, storage badges, device info, center-bias crop ([773acdf](https://github.com/sharkhunterr/satsu/-/commit/773acdf9230444f454a1d62795b36334c4f0cfde))
* scanning station (kiosk mode), remote control, multi-page PDF merge ([7ea6f14](https://github.com/sharkhunterr/satsu/-/commit/7ea6f14557e5b73738d379e35b37182935bffde1))
* station crop zone calibration, quick-access buttons on Devices page ([e92b7a9](https://github.com/sharkhunterr/satsu/-/commit/e92b7a948b4031c5599508b96e424bb9f875cfa5))


### Bug Fixes

* improve document detection for low-contrast and half-sheet photos ([396f9b8](https://github.com/sharkhunterr/satsu/-/commit/396f9b884149c0e53ba98681b42be2fabd607825))
