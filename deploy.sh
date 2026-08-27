#!/usr/bin/env bash
# Deploy Cut the Fuse to Firebase Hosting → https://cut-the-fuse.web.app
# Custom domain (after DNS): https://play.cutthefuse.com
set -euo pipefail
cd "$(dirname "$0")"
firebase deploy --only hosting --project synalume-care
