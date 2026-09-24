// vite.config.ts의 define으로 빌드 때 채우는 값(scripts/data-versions.mjs).
// 테스트처럼 Vite를 거치지 않으면 정의되지 않으므로 typeof로 확인해서 쓴다.

/** 자료 응답을 만드는 코드의 지문. 바뀌면 D1 응답 보관본을 새로 만든다. */
declare const __DATASET_CACHE_VERSION__: string | undefined;

/** 정적 자료 파일(public/data)의 내용 지문. 주소 뒤에 ?v=로 붙여 새 자료를 바로 받게 한다. */
declare const __DATA_VERSIONS__: Readonly<Record<string, string>> | undefined;
