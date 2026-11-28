#!/usr/bin/env bash
# Pulls a base image from the first registry that serves it, and prints the reference that worked.
#   .github/scripts/pull-image.sh <image reference> [<same image from another registry> ...]
# Each reference is tried at most twice, 20 s apart: a registry that answers 429 (rate limit) is not
# retried further; the next official copy of the same image is used instead (for example Docker Hub's
# library image and its public.ecr.aws/docker/library or mirror.gcr.io/library copies). Fails when no registry
# serves it. public.ecr.aws reports its quota as "Data limit exceeded", which counts as a rate limit here.
set -u
for ref in "$@"; do
  [ -n "$ref" ] || continue
  for attempt in 1 2; do
    if out=$(docker pull --quiet "$ref" 2>&1); then echo "$ref"; exit 0; fi
    echo "pull $ref failed (attempt $attempt): $(echo "$out" | tail -1)" >&2
    echo "$out" | grep -qiE '429|toomanyrequests|rate limit|data limit' && break
    [ "$attempt" -lt 2 ] && sleep 20
  done
done
echo "no registry served the image: $*" >&2
exit 1
