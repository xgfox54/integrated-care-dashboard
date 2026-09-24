declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** 공공데이터포털 인증키(선택). */
    PUBLIC_DATA_SERVICE_KEY?: string;
    PUBLIC_DATA_SERVICE_KEY_ENCODING?: "encoded" | "decoded";
  }
}
