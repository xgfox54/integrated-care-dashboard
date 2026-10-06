// 지방재정365 인증키 입력값 정리. 붙여넣을 때 섞이는 공백·줄바꿈·보이지 않는 문자를 지우고,
// 호출 주소 전체(…?Key=값)를 붙여넣었으면 Key 값만 꺼낸다. 형식이 맞지 않으면 null.
const INVISIBLE = /[\s\u00a0\u200b-\u200d\u2060\ufeff]/g;

export function normalizeLofinKey(raw: string): string | null {
  let value = raw.replace(INVISIBLE, "");
  const fromUrl = /[?&]key=([^&#]+)/i.exec(value);
  if (fromUrl?.[1]) value = fromUrl[1];
  return /^[A-Za-z0-9%+/=_-]{10,200}$/.test(value) ? value : null;
}

