import { createHash } from "node:crypto";
import source from "@ltr/igt-engine/SOURCE.json";

// 서버 전용 - 상속·증여세 엔진 해시. SOURCE.json 의 engineFiles(엔진 소스 파일별 SHA-256, 패키지 시험이 실제 파일과 대조)를 다시 해시한 값이다.
// 엔진 코드가 바뀌면 달라져 이전 대조 실행이 무효가 되고 게이트가 다시 닫힌다 (FAM-12).
export const IGT_ENGINE_HASH: string = createHash("sha256")
  .update(
    JSON.stringify(
      (source.engineFiles as { copy: string; copySha256: string }[])
        .map((f) => [f.copy, f.copySha256])
        .sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
    ),
  )
  .digest("hex");
