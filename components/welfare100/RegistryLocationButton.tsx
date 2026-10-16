"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LocationIcon } from "@/components/ui/jeju-icons";
import { requestGpsSido } from "@/lib/visitor-location";
import styles from "./RegistrySearchTools.module.css";

export function RegistryLocationButton({ onRegion }: { readonly onRegion: (sido: string) => void }) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");

  async function locate() {
    setPending(true);
    setNotice("");
    try {
      const sido = await requestGpsSido();
      if (sido) {
        onRegion(sido);
        setNotice(`${sido} 지역으로 조회조건을 설정했습니다.`);
      } else {
        setNotice("현재 위치를 확인하지 못했습니다. 검색 옵션에서 지역을 직접 선택해 주세요.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.location}>
      <Button type="button" variant="outline" onClick={locate} disabled={pending} aria-busy={pending}>
        <LocationIcon />{pending ? "현재 위치 확인 중" : "현재 위치로 보기"}
      </Button>
      <span role="status" className={styles.notice}>{notice}</span>
    </div>
  );
}
