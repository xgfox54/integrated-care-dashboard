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
  }
}
