#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORMULA_PATH="${ROOT_DIR}/Formula/metrillm.rb"
PACKAGE_NAME="metrillm"
VERSION="${1:-$(npm view "${PACKAGE_NAME}" version)}"
TARBALL_URL="https://registry.npmjs.org/${PACKAGE_NAME}/-/${PACKAGE_NAME}-${VERSION}.tgz"
TMP_TGZ="$(mktemp -t "${PACKAGE_NAME}.${VERSION}.XXXXXX.tgz")"

cleanup() {
  rm -f "${TMP_TGZ}"
}
trap cleanup EXIT

curl -fsSL "${TARBALL_URL}" -o "${TMP_TGZ}"
if command -v shasum >/dev/null 2>&1; then
  SHA256="$(shasum -a 256 "${TMP_TGZ}" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(sha256sum "${TMP_TGZ}" | awk '{print $1}')"
else
  echo "Error: neither shasum nor sha256sum is available." >&2
  exit 1
fi

cat > "${FORMULA_PATH}" <<EOF
class Metrillm < Formula
  desc "Benchmark local LLM models for speed, quality, and hardware fit"
  homepage "https://github.com/MetriLLM/metrillm"
  url "https://registry.npmjs.org/metrillm/-/metrillm-${VERSION}.tgz"
  sha256 "${SHA256}"
  license "Apache-2.0"

  depends_on "node"

  livecheck do
    url "https://registry.npmjs.org/metrillm/latest"
    strategy :json do |json|
      json["version"]
    end
  end

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/metrillm"
  end

  test do
    assert_match "Benchmark local LLMs", shell_output("#{bin}/metrillm --help")
  end
end
EOF

echo "Updated ${FORMULA_PATH}"
echo "  version: ${VERSION}"
echo "  sha256:  ${SHA256}"
