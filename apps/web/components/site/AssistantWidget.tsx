"use client";

import { lazy, Suspense, useId, useRef, useState } from "react";
import { AssistantLauncher } from "@ltr/ui";

// 런처만 첫 화면 번들에 둔다 — 패널·대화 코드는 누를 때 불러온다 (CHAT-02).
const Chat = lazy(() => import("./AssistantChat"));

export function AssistantWidget(props: { aiNotice: string; firstUseNotice: string[]; noticeVersion: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const panelId = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  return (
    <div data-nosnippet="" data-assistant-root="">
      <AssistantLauncher
        ref={launcher}
        expanded={open}
        controls={panelId}
        onClick={() => {
          setOpen((v) => !v);
          setLoaded(true);
        }}
      />
      {loaded && open && (
        <Suspense fallback={null}>
          <Chat id={panelId} onClose={() => setOpen(false)} returnFocusRef={launcher} {...props} />
        </Suspense>
      )}
    </div>
  );
}
