#!/usr/bin/env bash
# One-time setup: downloads the Hyperledger Fabric samples, binaries and Docker images (Fabric 2.5.12, CA 1.5.15)
# into fabric/fabric-samples. Needs Docker running. Takes a few minutes the first time.
#
#   ./fabric/install.sh                    # samples, binaries and images
#   ./fabric/install.sh binary docker      # only the parts named (samples | binary | docker)
#
# Everything is pinned, so two installs get the same bits:
#   - fabric-samples is cloned from the official repository and checked out at a fixed commit;
#   - the binary archives come from the official GitHub releases and must match the SHA-256 recorded below;
#   - the images are pulled by digest (ghcr.io/hyperledger first, Docker Hub second) and only then tagged.
# The upstream helper (install-fabric.sh from the fabric main branch) is no longer downloaded or run.
# Hyperledger does not publish checksum or signature files next to these release archives, so the hashes below
# were taken from the official release downloads on 2026-11-28 and match the binaries this project was tested with.
# To move to another Fabric release, update the versions, the commit, the hashes and the digests together.
set -euo pipefail
cd "$(dirname "$0")"

FABRIC_VERSION=2.5.12
CA_VERSION=1.5.15
SAMPLES_REPO=https://github.com/hyperledger/fabric-samples.git
SAMPLES_COMMIT=5789681b4f4d24e58fa40f19a69f5496892374b6   # fabric-samples main on 2026-11-28, the tree the network was tested with
CLI="${CONTAINER_CLI:-docker}"

die() { echo "install.sh: $*" >&2; exit 1; }

# ---------- platform ----------
case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=darwin ;;
  *) die "unsupported operating system $(uname -s): use Linux, macOS, or WSL 2 on Windows" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) die "unsupported CPU architecture $(uname -m): Fabric publishes amd64 and arm64 builds only" ;;
esac
PLATFORM="$OS-$ARCH"

# ---------- pinned release archives (SHA-256) ----------
fabric_sha256() {
  case "$1" in
    linux-amd64) echo 248be10de7f030a85eaecee118043e84f7b107aa3a8d3c48e6208f5fce0543b6 ;;
    linux-arm64) echo 0175b5f4138474384e33f7ec8288a6cd3194f2cf665cdb6b69e4bb6a3b6f5eca ;;
    darwin-amd64) echo 5d2cc2fbbfce631ef08563b9fa2e5bf9336300bfce988e524d26e80370183be0 ;;
    darwin-arm64) echo bb710b7e7b6103b6e4fa9cf51ee74937b3f5737f18b97d1ff2b7058af0f4f4c4 ;;
  esac
}
ca_sha256() {
  case "$1" in
    linux-amd64) echo a4831c233ab7c1d9e039dc5badf4cf890719358442b5042f12d94b1d6f919289 ;;
    linux-arm64) echo 250f0666c54c419c29ebd4283310d475ccf7f778af36bb396c07b20bd416600a ;;
    darwin-amd64) echo e90958e1613f45079e8c26a35ca6a6290f0460bafbd44c9cf65b738f5f59508d ;;
    darwin-arm64) echo e8c9edc85ee6e31d83f67c85fcde05410b86119286b5658d28a9d92a659d7c5b ;;
  esac
}

# ---------- pinned images (multi-arch index digests; linux/amd64 and linux/arm64) ----------
# <component> <tag> <ghcr.io digest> <docker.io digest>
IMAGES="
peer    $FABRIC_VERSION sha256:f5f3fb3b061a067df0d13ed109fe1109cc9cbf02207936438435fcf431a11440 sha256:18f7503cfc82f062708f93199d372e3f63b6a1b8ce168f20f387d2ce87aaf2eb
orderer $FABRIC_VERSION sha256:5a91a378ed13de92d1566781dede60baaca42265076f96b5921ad03b25184c6a sha256:d33a2714b6628d38a46b2e054d558e002cf2ee991828189741b3417c54e1ac0c
ccenv   $FABRIC_VERSION sha256:72bda013702ad5a4103c00e6b58617110da69c496b60993e35c9d9e09c1a338e sha256:14c6cca8d85535d4eb08de66be025d20e953e7deff34e1c90c3e4f4cae7d497f
baseos  $FABRIC_VERSION sha256:f0dab8b4acd484e35c2303593c6ce850e3d000b77d86b25d2116cbcb67f8b6ff sha256:9133efd86ef1ad7e7f7f8e9795d0e23287aab4caf6b1d7500cccfde9870940fd
tools   $FABRIC_VERSION sha256:f7c8847907c68429e709e7426ba6dfc927e366d4fb90589f1a7861b2859ac8ec sha256:c802f0bae7998bfac4371c02b1cb794216b746931f127ba6dfe3d336ba5e0238
ca      $CA_VERSION     sha256:4704861f82be659372510b72c1e8b141563743e1f5840d8c094ded1df9253c68 sha256:1b64dc702bd400e14c8f452dedc0359b7dc06679b751b08937eb2bf2865fed40
"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else die "need sha256sum or shasum to verify downloads"; fi
}

install_samples() {
  command -v git >/dev/null 2>&1 || die "git is required"
  if [ -d fabric-samples/.git ]; then
    local head
    head=$(git -C fabric-samples rev-parse HEAD)
    if [ "$head" = "$SAMPLES_COMMIT" ]; then
      echo "==> fabric-samples is already at the pinned commit ${SAMPLES_COMMIT:0:12}"
    else
      # An existing network keeps its files in this folder, so it is left as it is and not switched over.
      echo "WARNING: fabric-samples is at ${head:0:12}, not the pinned ${SAMPLES_COMMIT:0:12}. It is left unchanged." >&2
      echo "         For the pinned tree, stop the network, move fabric/fabric-samples aside, and run this script again." >&2
    fi
  elif [ -e fabric-samples ]; then
    die "fabric/fabric-samples exists but is not a git checkout; move it aside and run this script again"
  else
    echo "==> Cloning fabric-samples at ${SAMPLES_COMMIT:0:12}"
    git clone --quiet "$SAMPLES_REPO" fabric-samples
    git -C fabric-samples -c advice.detachedHead=false checkout --quiet "$SAMPLES_COMMIT"
    test "$(git -C fabric-samples rev-parse HEAD)" = "$SAMPLES_COMMIT" || die "fabric-samples checkout did not land on $SAMPLES_COMMIT"
  fi
}

fetch_verified() { # <url> <expected sha256> <destination file>
  local url=$1 want=$2 out=$3 got
  [ -n "$want" ] || die "no recorded checksum for $url"
  echo "==> Downloading $url"
  curl -fsSL --retry 5 --retry-delay 3 --connect-timeout 20 -o "$out" "$url" || die "download failed: $url"
  got=$(sha256_of "$out")
  if [ "$got" != "$want" ]; then
    rm -rf "$(dirname "$out")"
    die "checksum mismatch for $url (expected $want, got $got); nothing was installed"
  fi
  echo "    SHA-256 verified: $got"
}

install_binaries() {
  [ -d fabric-samples ] || die "fabric-samples is missing; run ./fabric/install.sh samples first"
  local tmp
  tmp=$(mktemp -d)
  fetch_verified "https://github.com/hyperledger/fabric/releases/download/v$FABRIC_VERSION/hyperledger-fabric-$PLATFORM-$FABRIC_VERSION.tar.gz" \
    "$(fabric_sha256 "$PLATFORM")" "$tmp/fabric.tar.gz"
  fetch_verified "https://github.com/hyperledger/fabric-ca/releases/download/v$CA_VERSION/hyperledger-fabric-ca-$PLATFORM-$CA_VERSION.tar.gz" \
    "$(ca_sha256 "$PLATFORM")" "$tmp/ca.tar.gz"
  # Both archives are verified before either is unpacked.
  tar -xzf "$tmp/fabric.tar.gz" -C fabric-samples
  tar -xzf "$tmp/ca.tar.gz" -C fabric-samples
  rm -rf "$tmp"
  fabric-samples/bin/peer version | grep -q "Version: v$FABRIC_VERSION" || die "peer binary does not report v$FABRIC_VERSION"
  fabric-samples/bin/fabric-ca-client version | grep -q "Version: v$CA_VERSION" || die "fabric-ca-client does not report v$CA_VERSION"
  echo "==> Binaries for $PLATFORM installed in fabric/fabric-samples/bin"
}

install_images() {
  command -v "$CLI" >/dev/null 2>&1 || die "$CLI is not installed or not on PATH"
  "$CLI" info >/dev/null 2>&1 || die "$CLI is not running"
  local name tag ghcr hub short ref pulled
  while read -r name tag ghcr hub; do
    [ -n "$name" ] || continue
    pulled=""
    for ref in "ghcr.io/hyperledger/fabric-$name@$ghcr" "docker.io/hyperledger/fabric-$name@$hub"; do
      echo "==> Pulling $ref"
      if "$CLI" pull --quiet "$ref" >/dev/null; then pulled=$ref; break; fi
      echo "    not available from this registry, trying the next one" >&2
    done
    [ -n "$pulled" ] || die "could not pull fabric-$name $tag from ghcr.io or Docker Hub"
    short=$(echo "$tag" | cut -d. -f1,2)
    # The test network's compose files use :latest; the backup scripts use :2.5.
    for t in "$tag" "$short" latest; do "$CLI" tag "$pulled" "hyperledger/fabric-$name:$t"; done
  done <<EOF
$IMAGES
EOF
  echo "==> Images pulled by digest and tagged ($FABRIC_VERSION / $CA_VERSION, 2.5 / 1.5, latest)"
}

[ $# -gt 0 ] || set -- samples binary docker
for part in "$@"; do
  case "$part" in
    samples) install_samples ;;
    binary | binaries) install_binaries ;;
    docker | images) install_images ;;
    *) die "unknown part '$part' (use samples, binary or docker)" ;;
  esac
done
echo
echo "Fabric is installed. Start the Wethaq network with: ./fabric/up.sh"
