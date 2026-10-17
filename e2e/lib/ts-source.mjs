// 저장소 TypeScript 원본(packages/*/src)을 E2E에서 그대로 부른다 — Node의 타입 지우기(type stripping)로 읽고,
// 확장자 없는 상대 경로(import "./models")는 .ts를 붙여 찾는다. 같은 규칙 함수를 화면 시험과 패키지 시험이 함께 쓰게 (OPT-02 compareRendered)
import { registerHooks } from "node:module";

let registered = false;
function register() {
  if (registered) return;
  registered = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (err) {
        if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
        throw err;
      }
    },
  });
}

/** 저장소 루트 기준 경로의 .ts 모듈을 불러온다 */
export async function importSource(url) {
  register();
  return import(url);
}
