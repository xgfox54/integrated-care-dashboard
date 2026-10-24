declare namespace Cloudflare {
  interface Env {
    ADMIN_SETUP_TOKEN?: string;
    PRESS_RELAY_TOKEN_SHA256?: string;
    DB?: D1Database;
    /** 배포된 매뉴얼 반입 조각은 이 내부 바인딩으로만 읽는다. */
    ASSETS?: Fetcher;
    MANUAL_CORPUS_KEY?: string;
    BUCKET?: R2Bucket;
    /** 공공데이터포털 인증키(선택). */
    PUBLIC_DATA_SERVICE_KEY?: string;
    PUBLIC_DATA_SERVICE_KEY_ENCODING?: "encoded" | "decoded";
    /** 지방재정365 인증키(선택). */
    LOFIN_API_KEY?: string;
    /** KOSIS 인증키(선택). */
    KOSIS_API_KEY?: string;
    /** 서울 열린데이터광장 인증키(선택). */
    SEOUL_OPEN_DATA_KEY?: string;
    /** 법제처 OPEN API 인증값. 운영 Secret에서만 주입한다. */
    LAW_OC?: string;
    /** 법제처에 등록한 Referer(선택). 생략하면 운영 Site origin을 사용한다. */
    LAW_REFERER?: string;
  }
}
