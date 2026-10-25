// 계산기 연결을 불러오지 못했을 때 - 요청 때 그리는 화면이라 잠시 뒤 다시 시도하면 된다 (기존 /calc 문구와 같다)
export function CalcUnavailable() {
  return (
    <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
      <h1 className="text-[28px] font-black text-navy-900">세금 계산기</h1>
      <p className="mt-4 text-[15px] text-navy-500">지금은 연결을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
    </main>
  );
}
