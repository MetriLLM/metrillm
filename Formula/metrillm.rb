class Metrillm < Formula
  desc "Benchmark local LLM models for speed, quality, and hardware fit"
  homepage "https://github.com/MetriLLM/metrillm"
  url "https://registry.npmjs.org/metrillm/-/metrillm-0.2.2.tgz"
  sha256 "138d0790854175720bcf6f6a78df20323c75c58708bcd3a263aae0a2dbcf1645"
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
