"use client";

import { useEffect } from "react";

/**
 * 정적 파일 보관용 서비스 워커(public/sw.js)를 등록한다. 첫 화면을 다 그린 뒤에
 * 등록하므로 첫 방문 속도에는 영향이 없고, 다음 방문부터 스크립트·자료 파일을 바로 쓴다.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
