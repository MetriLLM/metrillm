class Metrillm < Formula
  desc "Benchmark local LLM models for speed, quality, and hardware fit"
  homepage "https://github.com/MetriLLM/metrillm"
  url "https://registry.npmjs.org/metrillm/-/metrillm-0.2.0.tgz"
  sha256 "f48893fdb61d5fd36bf734c4e9a0ea6351aa55cdbf511cf26d64129b9446b503"
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
