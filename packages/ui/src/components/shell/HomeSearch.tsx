"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Chip, PrimaryButton } from "../base";

/** 추천 검색어 칩 상한 — 편집자가 settings에 3~6개를 지정한다 (HOME-01) */
const MAX_SUGGESTIONS = 6;

export type HomeSearchProps = {
  /** 입력창 위에 보이는 라벨 — 자리표시 글자로 라벨을 대신하지 않는다 */
  label?: string;
  /** 입력창 안내 (R1 글자 수에 들어간다) */
  placeholder?: string;
  /** 추천 검색어 — settings 값. 0개면 칩 줄을 숨긴다 */
  suggestions?: readonly string[];
};

/**
 * 홈 큰 입력창 — 히어로 안 흰 입력창(rounded-2xl, 높이 64px 이상) + 주 버튼 [검색하기] + 추천 검색어 칩 (PRD-00 8.6, HOME-01).
 * 기사·상황·지역 통합 검색으로 /search에 GET 제출한다(q). 빈 입력·공백만 입력은 막고 안내 문구를 보인다. 엔터 키로도 제출된다.
 * 어두운 히어로 위에 두므로 안내 문구는 흰 바탕 위 rose-700 (폼 요소 오류 색)으로 보인다.
 */
export function HomeSearch({ label = "검색어", placeholder, suggestions = [] }: HomeSearchProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [empty, setEmpty] = useState(false);
  const chips = suggestions.map((s) => s.trim()).filter(Boolean).slice(0, MAX_SUGGESTIONS);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const input = inputRef.current;
    if (!input) return;
    const q = input.value.trim();
    if (!q) {
      e.preventDefault();
      setEmpty(true);
      input.focus();
      return;
    }
    input.value = q;
    setEmpty(false);
  }

  return (
    <form data-ui="home-search" role="search" action="/search" method="get" onSubmit={onSubmit} className="w-full max-w-3xl">
      <label htmlFor={inputId} className="block text-[15px] font-bold text-navy-100">
        {label}
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <input
          ref={inputRef}
          id={inputId}
          name="q"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder={placeholder}
          aria-invalid={empty ? true : undefined}
          aria-describedby={empty ? errorId : undefined}
          onChange={() => empty && setEmpty(false)}
          className="min-h-16 w-full min-w-0 flex-1 rounded-2xl border border-navy-100 bg-white px-5 text-[17px] text-navy-900 placeholder:text-navy-400 focus:outline-2 focus:outline-offset-2 focus:outline-hermes-500"
        />
        <PrimaryButton type="submit">검색하기</PrimaryButton>
      </div>
      {empty && (
        <p id={errorId} role="alert" className="mt-3 inline-block rounded-lg bg-white px-3 py-1.5 text-[14px] font-semibold text-rose-700">
          검색어를 입력해 주세요.
        </p>
      )}
      {chips.length > 0 && (
        <ul aria-label="추천 검색어" className="mt-4 flex flex-wrap gap-x-2">
          {chips.map((s) => (
            <li key={s}>
              <a
                href={`/search?q=${encodeURIComponent(s)}`}
                className="inline-flex min-h-11 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400"
              >
                <Chip className="transition hover:border-hermes-400">{s}</Chip>
              </a>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
