#!/usr/bin/env bash
# Builds the shipment chaincode image and deploys it as a service (approve by both organizations, commit with
# the endorsement policy). Used by up.sh for the first definition; use upgrade-chaincode.sh afterwards.
source "$(dirname "$0")/lib.sh"
require_samples
cd "$NET"
VERSION="${1:-1.0}"
SEQUENCE="${2:-1}"
# The chaincode runs as a service in its own container, built here from chaincode/shipment/Dockerfile. This avoids
# the peers building chaincode images through the Docker socket (unreliable on Docker Desktop for macOS).
if [ "${WETHAQ_SKIP_CC_BUILD:-}" != "1" ]; then
  docker build -t "${CC_NAME}_ccaas_image:latest" --build-arg CC_SERVER_PORT=9999 "$CC_SRC"
fi
# network.sh packages, installs, approves (both organizations) and commits the definition; the containers are
# started below (-ccaasdocker false) so that Docker restarts them and stop.sh/start.sh keep working.
./network.sh deployCCAAS -c "$CHANNEL" -ccn "$CC_NAME" -ccp "$CC_SRC" -ccv "$VERSION" -ccs "$SEQUENCE" -ccep "$CC_POLICY" -ccaasdocker false
run_ccaas "$(installed_package_id "${CC_NAME}_${VERSION}")"
