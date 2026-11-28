# GP1 closure evidence, 28 November 2026

Collected on branch `gp1-closure` (from `main` at `3347560`). Nothing here contains secrets, private keys,
certificates, tokens or `.env` values. Signed download URLs were shortened, and the Fabric CA enrollment secrets that the sample network prints in `regression/fabric-up.txt` were replaced by `<redacted>`. Every file was written by the commands
named in it, and nothing was edited to change a result.

| File or folder | What it shows |
| --- | --- |
| [github-runs.md](github-runs.md) | The pull-request checks of #17 and #18 as read on GitHub, the Node 20 deprecation check, and the fresh `fabric.yml` run on `main` (run 46169704428: 7 of 7, NFR 31 of 31) |
| [fabric-install/](fabric-install/README.md) | The pinned installer: hashes, digests, a clean install, a second run, and a wrong-hash test |
| [arm64-measurement-context.md](arm64-measurement-context.md) | What the first arm64 figures measure (memory at rest, not peak; a GitHub runner, not Oracle) and what the new workflow options measure |
| [accessibility/](accessibility/README.md) | axe before and after the heading fix, the screenshot comparison, and NFR2 against the report |
| [academic-requirements-verification.md](academic-requirements-verification.md) | FR1–FR12 and NFR1–NFR7 against the GP481 report, the planned evaluations, and the phase-name question |
| [regression/](regression/README.md) | The final regression on `d0835da`: every suite, persistence across a restart, a failing NFR run on purpose, and the 106 lint warnings |

Security findings changed in this closure (F13 verified, F15 verified on x64, F16 fixed, F18 new and fixed) are in
[../../SECURITY_AUDIT.md](../../SECURITY_AUDIT.md). The overall sign-off is
[../../GP1_FINAL_SIGNOFF.md](../../GP1_FINAL_SIGNOFF.md).

**Still to be run by the project owner** (needs the branch on GitHub): `fabric.yml` and
`oracle-arm64-readiness.yml` on `gp1-closure`, the second one twice (with and without `a1_limits`).
