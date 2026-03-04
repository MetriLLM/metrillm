class Metrillm < Formula
  desc "Benchmark local LLM models for speed, quality, and hardware fit"
  homepage "https://github.com/MetriLLM/metrillm"
  url "https://registry.npmjs.org/metrillm/-/metrillm-0.2.1.tgz"
  sha256 "8679bc114b430918a98919e92942434902ef675f6c7652e7ae6fcfae7b16ba97"
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
