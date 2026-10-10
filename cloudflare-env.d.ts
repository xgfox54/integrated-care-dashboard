declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
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
    /** 법제처 국가법령정보 OPEN API 인증값. 비밀값으로만 저장한다. */
    LAW_OC?: string;
    /** 법제처에 보낼 등록 도메인 Referer(선택). 예: https://integrated-care-national-dashboard.xgfox54.chatgpt.site/ */
    LAW_REFERER?: string;
  }
}
