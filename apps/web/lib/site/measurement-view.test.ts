// 측정 거부 화면 글자 시험 — 상태마다 버튼 하나(반대 동작), 저장 알림, 안내 문장 60자 이하(R8)·공포 표현 0
import { describe, expect, test } from "vitest";
import { MEASUREMENT_EXPLANATION, measurementView } from "./measurement-view";

describe("측정 거부 화면", () => {
  test("측정 중 → [방문 통계 수집 거부], 거부 → [다시 허용], GPC → [방문 통계 수집 거부](거부를 저장해 둔다)", () => {
    expect(measurementView("measuring", undefined)).toEqual({ status: "지금은 방문을 측정하고 있습니다.", notice: null, button: { choice: "refuse", label: "방문 통계 수집 거부" } });
    expect(measurementView("refused", "refuse")).toEqual({ status: "지금은 측정을 거부한 상태입니다.", notice: "측정 거부를 저장했습니다.", button: { choice: "allow", label: "다시 허용" } });
    expect(measurementView("gpc", undefined).button.choice).toBe("refuse");
  });

  test("모르는 done 값은 알림 없음", () => {
    expect(measurementView("measuring", "<script>").notice).toBeNull();
    expect(measurementView("measuring", "allow").notice).toBe("측정 허용을 저장했습니다.");
  });

  test("안내 문장은 60자 이하(R8), 겁주는 낱말 0", () => {
    const all = [...MEASUREMENT_EXPLANATION, ...(["measuring", "refused", "gpc"] as const).map((s) => measurementView(s, "refuse").status)];
    for (const s of all) {
      expect([...s].length, s).toBeLessThanOrEqual(60);
      expect(s).not.toMatch(/폭탄|큰일|위험|경고/);
    }
  });
});
