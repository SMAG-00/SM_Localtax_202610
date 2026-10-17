// 폼 요소 (PRD-00 8.6 · 8.9) — 라벨 연결·필수 표시·오류 연결을 실제 입력으로 확인한다
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckboxField, RadioField, SelectField, TextField } from "./FormField";

const tokens = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);
const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("폼 요소 — 입력창", () => {
  it("라벨은 입력창 위 15px 700이고 입력창과 연결된다", () => {
    const { container } = render(<TextField id="name" label="이름" />);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe("form-field");
    const input = screen.getByLabelText("이름");
    expect(input.tagName).toBe("INPUT");
    const label = container.querySelector("label")!;
    expect(label.getAttribute("for")).toBe("name");
    expect(tokens(label)).toEqual(expect.arrayContaining(["text-[15px]", "font-bold"]));
    expect(before(label, input)).toBe(true);
  });

  it("입력창은 rounded-xl navy-200 테두리 흰 바탕 17px, 높이 48px 이상(min-h-12), 포커스 오렌지 2px", () => {
    render(<TextField id="name" label="이름" />);
    expect(tokens(screen.getByLabelText("이름"))).toEqual(
      expect.arrayContaining([
        "rounded-xl",
        "border",
        "border-navy-200",
        "bg-white",
        "px-4",
        "py-3",
        "text-[17px]",
        "text-navy-900",
        "min-h-12",
        "focus:outline-2",
        "focus:outline-hermes-500",
      ]),
    );
  });

  it("필수 항목은 글자 '(필수)'와 required 속성을 함께 갖는다", () => {
    render(<TextField id="addr" label="주소" required />);
    const input = screen.getByLabelText("주소 (필수)") as HTMLInputElement;
    expect(input.required).toBe(true);
  });

  it("필수가 아니면 '(필수)' 글자도 required도 없다", () => {
    render(<TextField id="memo" label="메모" />);
    expect(screen.queryByText(/필수/)).toBeNull();
    expect((screen.getByLabelText("메모") as HTMLInputElement).required).toBe(false);
  });

  it("오류는 입력창 아래 rose-700 14px 문장이고 aria-describedby·aria-invalid로 연결된다", () => {
    render(<TextField id="phone" label="연락처" error="숫자만 입력해 주세요." />);
    const input = screen.getByLabelText("연락처");
    const error = screen.getByText("숫자만 입력해 주세요.");
    expect(tokens(error)).toEqual(expect.arrayContaining(["text-[14px]", "text-rose-700"]));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
    expect(before(input, error)).toBe(true);
  });

  it("오류가 없으면 aria-invalid·aria-describedby가 없다", () => {
    render(<TextField id="phone" label="연락처" />);
    const input = screen.getByLabelText("연락처");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });

  it("도움말과 오류가 함께 있으면 describedby에 도움말 → 오류 순으로 둘 다 들어간다", () => {
    render(<TextField id="mail" label="이메일" hint="답장을 받을 주소입니다." error="형식을 확인해 주세요." />);
    const input = screen.getByLabelText("이메일");
    const ids = input.getAttribute("aria-describedby")!.split(" ");
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual(["답장을 받을 주소입니다.", "형식을 확인해 주세요."]);
  });

  it("글자를 입력하면 값이 바뀐다", async () => {
    render(<TextField id="name" label="이름" />);
    const input = screen.getByLabelText("이름") as HTMLInputElement;
    await userEvent.type(input, "홍길동");
    expect(input.value).toBe("홍길동");
  });
});

describe("폼 요소 — 선택 목록", () => {
  const options = [
    { value: "seoul", label: "서울특별시" },
    { value: "busan", label: "부산광역시" },
  ];

  it("입력창과 같은 형태이고 라벨로 찾을 수 있으며 고르면 값이 바뀐다", async () => {
    const { container } = render(<SelectField id="sido" label="시·도" options={options} placeholder="선택해 주세요" />);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe("form-field");
    const select = screen.getByLabelText("시·도") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(tokens(select)).toEqual(expect.arrayContaining(["rounded-xl", "border-navy-200", "bg-white", "text-[17px]", "min-h-12", "focus:outline-hermes-500"]));
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ["", "선택해 주세요"],
      ["seoul", "서울특별시"],
      ["busan", "부산광역시"],
    ]);
    await userEvent.selectOptions(select, "busan");
    expect(select.value).toBe("busan");
  });

  it("자리표시 선택지를 주지 않으면 실제 선택지만 있다", () => {
    render(<SelectField id="sido" label="시·도" options={options} />);
    expect((screen.getByLabelText("시·도") as HTMLSelectElement).options.length).toBe(2);
  });

  it("필수·오류 규칙이 입력창과 같다", () => {
    render(<SelectField id="sido" label="시·도" options={options} required error="시·도를 골라 주세요." />);
    const select = screen.getByLabelText("시·도 (필수)") as HTMLSelectElement;
    expect(select.required).toBe(true);
    expect(select.getAttribute("aria-describedby")).toBe(screen.getByText("시·도를 골라 주세요.").id);
  });
});

describe("폼 요소 — 체크박스·라디오", () => {
  it("체크박스는 24px, 선택 시 navy-900이고 라벨을 눌러도 선택된다", async () => {
    const { container } = render(<CheckboxField id="agree" label="개인정보 수집·이용에 동의합니다" required />);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe("form-field");
    const box = screen.getByRole("checkbox", { name: "개인정보 수집·이용에 동의합니다 (필수)" }) as HTMLInputElement;
    expect(tokens(box)).toEqual(expect.arrayContaining(["size-[24px]", "accent-navy-900"]));
    expect(box.checked).toBe(false);
    expect(box.required).toBe(true);
    await userEvent.click(screen.getByText("개인정보 수집·이용에 동의합니다"));
    expect(box.checked).toBe(true);
    await userEvent.click(box);
    expect(box.checked).toBe(false);
  });

  it("체크박스 라벨 줄은 터치 영역 44px 이상이고, 오류는 aria-describedby로 연결된다", () => {
    render(<CheckboxField id="agree" label="동의합니다" error="동의해야 보낼 수 있습니다." />);
    const box = screen.getByRole("checkbox", { name: "동의합니다" });
    expect(tokens(box.closest("label"))).toContain("min-h-11");
    const error = screen.getByText("동의해야 보낼 수 있습니다.");
    expect(tokens(error)).toContain("text-rose-700");
    expect(box.getAttribute("aria-describedby")).toBe(error.id);
    expect(box.getAttribute("aria-invalid")).toBe("true");
  });

  it("라디오 묶음은 fieldset·legend(15px 700)이고 24px 라디오 중 하나만 고른다", async () => {
    const { container } = render(
      <RadioField
        id="cause"
        name="cause"
        legend="취득 원인"
        required
        options={[
          { value: "buy", label: "매매" },
          { value: "inherit", label: "상속" },
          { value: "gift", label: "증여" },
        ]}
      />,
    );
    const group = screen.getByRole("group", { name: "취득 원인 (필수)" });
    expect(group.tagName).toBe("FIELDSET");
    expect(container.firstElementChild).toBe(group);
    expect(group.getAttribute("data-ui")).toBe("form-field");
    expect(tokens(group.querySelector("legend"))).toEqual(expect.arrayContaining(["text-[15px]", "font-bold"]));
    const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(["buy", "inherit", "gift"]);
    radios.forEach((r) => expect(tokens(r)).toEqual(expect.arrayContaining(["size-[24px]", "accent-navy-900"])));
    expect(radios.every((r) => r.required)).toBe(true);
    await userEvent.click(screen.getByText("상속"));
    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
    await userEvent.click(screen.getByText("증여"));
    expect(radios.map((r) => r.checked)).toEqual([false, false, true]);
  });

  it("라디오 묶음 오류는 fieldset의 aria-describedby로 연결되고 기본값을 지정할 수 있다", () => {
    render(
      <RadioField
        id="cause"
        name="cause"
        legend="취득 원인"
        defaultValue="gift"
        error="취득 원인을 골라 주세요."
        options={[
          { value: "buy", label: "매매" },
          { value: "gift", label: "증여" },
        ]}
      />,
    );
    const group = screen.getByRole("group", { name: "취득 원인" });
    expect(group.getAttribute("aria-describedby")).toBe(screen.getByText("취득 원인을 골라 주세요.").id);
    expect((screen.getByRole("radio", { name: "증여" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "매매" }) as HTMLInputElement).checked).toBe(false);
  });
});
