# Fabric installation script: pinning and verification

**Finding.** Before commit 5439dc4, `fabric/install.sh` downloaded `install-fabric.sh` from the `main` branch of hyperledger/fabric and ran it. What it installed could change at any time without any change in this repository, and nothing was checked. On 28 November 2026 that upstream script already defaulted to Fabric 2.5.16, not the 2.5.12 this project was tested with.

**Fix (commit 5439dc4).** The upstream helper is no longer downloaded or run. `fabric/install.sh` now:

1. Clones fabric-samples and checks out commit `5789681b4f4d24e58fa40f19a69f5496892374b6` (the tree the network was tested with). If the folder exists at another commit it warns and leaves it alone. If the folder exists but is not a git checkout, it stops.
2. Downloads the Fabric 2.5.12 and Fabric CA 1.5.15 release archives from the official GitHub releases. It checks each one against a SHA-256 written in the script, and only then unpacks them. If either hash is wrong, it deletes the download and stops, and nothing is installed.
3. Pulls the six images by digest, from `ghcr.io/hyperledger` first and Docker Hub second, and only then tags them `2.5.12`, `2.5` and `latest` (CA `1.5.15`, `1.5`, `latest`).
4. Checks that `peer version` and `fabric-ca-client version` report the expected versions.

## Pinned values

| Archive | SHA-256 |
|---|---|
| hyperledger-fabric-linux-amd64-2.5.12.tar.gz | 248be10de7f030a85eaecee118043e84f7b107aa3a8d3c48e6208f5fce0543b6 |
| hyperledger-fabric-linux-arm64-2.5.12.tar.gz | 0175b5f4138474384e33f7ec8288a6cd3194f2cf665cdb6b69e4bb6a3b6f5eca |
| hyperledger-fabric-darwin-amd64-2.5.12.tar.gz | 5d2cc2fbbfce631ef08563b9fa2e5bf9336300bfce988e524d26e80370183be0 |
| hyperledger-fabric-darwin-arm64-2.5.12.tar.gz | bb710b7e7b6103b6e4fa9cf51ee74937b3f5737f18b97d1ff2b7058af0f4f4c4 |
| hyperledger-fabric-ca-linux-amd64-1.5.15.tar.gz | a4831c233ab7c1d9e039dc5badf4cf890719358442b5042f12d94b1d6f919289 |
| hyperledger-fabric-ca-linux-arm64-1.5.15.tar.gz | 250f0666c54c419c29ebd4283310d475ccf7f778af36bb396c07b20bd416600a |
| hyperledger-fabric-ca-darwin-amd64-1.5.15.tar.gz | e90958e1613f45079e8c26a35ca6a6290f0460bafbd44c9cf65b738f5f59508d |
| hyperledger-fabric-ca-darwin-arm64-1.5.15.tar.gz | e8c9edc85ee6e31d83f67c85fcde05410b86119286b5658d28a9d92a659d7c5b |

Image digests are multi-architecture index digests, so the same digest works on amd64 and arm64. The full digests are in the `IMAGES` list in `fabric/install.sh`. ghcr.io and Docker Hub publish different index digests for the same release, so the script carries both.

## How the hashes were checked

- The hashes were taken from the official release downloads on 28 November 2026.
- The `peer` and `fabric-ca-client` binaries extracted from the linux-amd64 archives are byte-identical to the binaries this project has used since September 2026, and the `config/` folder is identical too.
- The tag `v2.5.12` of hyperledger/fabric points to commit `af0b647`. The tag `v1.5.15` of hyperledger/fabric-ca points to `256fdbee`.

**Limitation (trust on first use).** Hyperledger does not publish checksum or signature files next to these archives. No such files were found, and the release page itself could not be opened from the test machine because of its network proxy. The hashes therefore show that every later install gets the same bytes as the 28 November download, and that those bytes match what was tested. They do not prove where the first download came from beyond GitHub's own release hosting over HTTPS.

## Tests run

| Test | Result | File |
|---|---|---|
| Clean install into an empty folder (x86_64, Linux) | 4 archives verified ("SHA-256 verified" 4 times: Fabric and CA, then the same on a second run); all 6 images pulled by digest; `peer` 2.5.12 and `fabric-ca-client` 1.5.15 reported | `clean-install.txt` |
| Second run on the same folder | fabric-samples left as it is (already at the pinned commit), archives downloaded and verified again, images pulled again by the same digests | `clean-install.txt` |
| Wrong expected hash | Stopped with "checksum mismatch … nothing was installed", exit code 1, nothing unpacked | `tamper-test.txt` |
| Final regression (on the existing checkout) | exit 0 | `../regression/fabric-install.txt` |
| `fabric.yml` on GitHub x64 (run 46174623807) | samples cloned at the pinned commit, both archives SHA-256 verified, all six images pulled from ghcr.io by digest; 7 of 7, NFR 31 of 31 | `../github-runs.md` |
| `oracle-arm64-readiness.yml` on GitHub arm64 (runs 46174686728 and 46174759675) | installer step exit 0, network and every check passed | `../github-runs.md` |

On the test machine, ghcr.io's download host is blocked by the network proxy, so every image fell back to Docker Hub. The log shows this as "not available from this registry, trying the next one", followed by the Docker Hub pull of the same release. That tested the fallback path. The ghcr.io path was then tested on GitHub: in `fabric.yml` run 46174623807 every image came from ghcr.io.
