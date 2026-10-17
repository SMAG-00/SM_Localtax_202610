import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 사내 서버 이전 대비 — Docker 이미지는 standalone 빌드로 만든다 (FND-07, PRD-00 7장 이식성)
  output: "standalone",
  // 모노레포 루트 기준으로 추적해 workspace 패키지를 standalone 산출물에 포함한다
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // workspace 패키지(TypeScript 원본)를 앱과 함께 컴파일한다
  transpilePackages: ["@ltr/workflows"],
  poweredByHeader: false,
};

export default nextConfig;
