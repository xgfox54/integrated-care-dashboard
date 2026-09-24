export interface VerifiedWikiSupplement {
  readonly serviceIds: readonly string[];
  readonly overview: string;
  readonly content: string;
  readonly eligibility?: string;
  readonly sourceTitle: string;
  readonly publisher: string;
  readonly url: string;
  readonly verifiedOn: string;
}

const VERIFIED_SUPPLEMENTS: readonly VerifiedWikiSupplement[] = [
  {
    serviceIds: ["0083:1489622:1:2:7"],
    overview: "노인일자리 참여자가 취약계층 어르신 가정을 찾아 안부를 확인하고 말벗·고충상담·생활안전점검을 제공하는 이웃돌봄 사업입니다.",
    content: "우리동네 1촌돌봄단은 노인일자리 사업과 연계해 돌봄단을 읍·면·동 주민센터와 수요처에 배치하고, 취약계층 어르신 가정을 정기적으로 방문해 말벗, 고충상담, 안부확인, 생활안전점검을 수행합니다.",
    eligibility: "안부확인과 생활안전점검 등 돌봄이 필요한 취약계층 어르신",
    sourceTitle: "2025년 노인일자리 및 사회활동지원사업 '우리동네1촌돌봄단'",
    publisher: "강릉종합사회복지관",
    url: "https://gssw.or.kr/board/board.php?b_id=photo&cmd=view&num=1274",
    verifiedOn: "2026-09-21",
  },
  {
    serviceIds: ["0085:1489588:1:1:15"],
    overview: "돌봄이 필요한 수원시민에게 아동·청소년·성인·중독상담 등 심리상담을 제공하는 수원새빛돌봄 특화형 서비스입니다.",
    content: "수원새빛돌봄의 심리상담은 돌봄이 필요한 시민에게 아동·청소년 상담, 성인 상담, 중독 상담을 제공합니다. 병원동행과 일상생활 업무동행은 별도의 동행돌봄 서비스입니다.",
    eligibility: "돌봄이 필요한 수원시민(실거주자와 관내 체류지 신고 외국인 포함). 서비스 비용 지원은 소득기준에 따라 차등 적용",
    sourceTitle: "수원새빛돌봄(누구나) 사업안내",
    publisher: "수원특례시 팔달구",
    url: "https://paldal.suwon.go.kr/bbsplus/view.asp?bd_gubn=14&code=tbl_bbs_sub200510&dong_gubn=&menuid=sub200510&mnuflag=&no=MTY1NDAg&page=1",
    verifiedOn: "2026-09-21",
  },
  {
    serviceIds: ["0085:1489603:1:1:5"],
    overview: "보건 전문인력이 건강취약계층 가정을 방문해 건강상태를 확인하고 개인별 건강관리와 지역자원 연계를 제공하는 사업입니다.",
    content: "간호사·영양사·사회복지사 등 전문인력이 가정을 방문해 건강상담, 복약지도, 만성질환 관리, 영양·정신건강 지원을 제공하고 필요한 지역사회 자원과 연계합니다. AI 로봇을 활용한 건강관리는 별도의 지역특화 사업입니다.",
    eligibility: "하남시에 거주하는 65세 이상 어르신, 건강 고위험 취약계층 또는 빈곤위기가정 등 방문 건강관리가 필요한 시민",
    sourceTitle: "2026 하남시 전입시민 생활안내서 - 방문건강관리사업",
    publisher: "하남시",
    url: "https://www.hanam.go.kr/DATA/newsletter/3902/20260107104038747_rjZx.pdf",
    verifiedOn: "2026-09-21",
  },
  {
    serviceIds: ["0090:1489803:1:2:18"],
    overview: "전문기술을 가진 주민들이 재능기부로 취약가구의 주거환경과 일상생활 불편을 개선하는 읍·면 단위 민간 돌봄조직입니다.",
    content: "행복기동대는 읍·면 단위의 민간 돌봄조직으로, 전문기술을 가진 주민이 수도 수리, 방충망 교체 등 소규모 주거환경 개선과 생활불편 해소를 지원합니다. 위기가구를 발굴하고 필요한 복지정보와 지역자원을 연계하는 역할도 수행합니다.",
    eligibility: "주거 안전이나 일상생활 불편 개선이 필요한 취약계층 가구",
    sourceTitle: "2024년 도정 주요업무계획 - 행복기동대",
    publisher: "경상북도",
    url: "https://seed.gb.go.kr/Main/open_contents/ko/inc/download.jsp?FILE=dojeong_2024.pdf",
    verifiedOn: "2026-09-21",
  },
  {
    serviceIds: ["0085:1489614:1:1:5"],
    overview: "회복기 재활환자에게 집중 재활치료와 지역사회 복귀 연계를 제공하는 재활의료기관 사업입니다.",
    content: "뇌졸중, 척수손상 등으로 급성기 치료를 받은 재활환자가 기능 회복 시기에 집중 재활치료를 받아 장애를 최소화하고 조기에 일상생활로 복귀하도록 지원합니다. 지정 재활의료기관이 재활의료 서비스를 제공하고 재활복지서비스와 연계합니다.",
    eligibility: "뇌졸중, 척수손상 등 급성기 치료 후 기능 회복기에 집중 재활이 필요한 재활환자",
    sourceTitle: "재활의료기관 지정 및 운영사업 안내",
    publisher: "건강보험심사평가원",
    url: "https://www.hira.or.kr/bbsDummy.do?brdBltNo=22&brdScnBltNo=4&pgmid=HIRAA020049000100%2F",
    verifiedOn: "2026-09-20",
  },
  {
    serviceIds: ["0085:1489614:1:2:12"],
    overview: "고령자의 낙상 등 가정 내 안전사고를 줄이기 위해 노인친화적으로 주택을 개조하는 사업입니다.",
    content: "고령자 주택의 미끄럼방지 바닥재, 안전손잡이, 가드레일, 경사로, 문턱 제거·낮춤, 좌식싱크대, 조명 개선, 욕조 철거 등 안전시설을 보강하고 주거환경을 개선합니다.",
    eligibility: "경기도에 거주하는 만 65세 이상 기초연금 수급자. 직전 3개년 내 경기도 주택개조사업 또는 민·관 유사사업 수혜자, 수선유지급여 수급자, 비주택 거주자 등은 제외",
    sourceTitle: "어르신 안전 하우징 사업",
    publisher: "경기도청",
    url: "https://www.gg.go.kr/contents/contents.do?ciIdx=1524&menuId=3448",
    verifiedOn: "2026-09-20",
  },
  {
    serviceIds: ["0085:1489600:1:2:7", "0085:1489600:1:2:11"],
    overview: "돌봄이 필요한 청·중장년과 가족돌봄청년에게 재가돌봄·가사와 특화서비스를 제공하는 사업입니다.",
    content: "재가 돌봄·가사 서비스를 기본으로 제공하고 병원동행, 심리지원 등 특화서비스를 필요에 따라 조합해 지원합니다. 기본서비스는 돌봄·가사 월 36시간 또는 72시간, 가사 월 24시간 유형으로 구성되며 특화서비스는 병원동행과 심리지원 등을 포함합니다.",
    eligibility: "질병·부상·고립 등으로 일상생활에 돌봄이 필요한 청·중장년(19~64세) 또는 질병을 앓는 가족을 돌보거나 그로 인해 생계를 책임지는 가족돌봄청년(13~39세)",
    sourceTitle: "일상돌봄 서비스 사업",
    publisher: "김포시청",
    url: "https://m.gimpo.go.kr/portal/contents.do?key=12145",
    verifiedOn: "2026-09-20",
  },
  {
    serviceIds: ["0085:1489600:1:2:15"],
    overview: "저소득 재가노인에게 정기적으로 밑반찬을 무료 배달해 식생활과 건강을 지원하는 사업입니다.",
    content: "김포시노인종합복지관과 김포시북부노인복지관이 기초생활수급 또는 차상위계층 재가노인에게 매주 수요일 주 1회 밑반찬을 무료로 제공합니다.",
    eligibility: "만 65세 이상 기초생활수급 노인 및 차상위계층 노인(독거노인 포함)",
    sourceTitle: "노인무료급식 지원 - 저소득재가노인 식사배달",
    publisher: "김포시청",
    url: "https://m.gimpo.go.kr/portal/contents.do?key=1370",
    verifiedOn: "2026-09-20",
  },  {
    serviceIds: ["0076:1489559:1:2:9"],
    overview: "질병을 조기에 발견하고 치료·사후관리로 연계하기 위해 국가가 시행하는 건강검진 사업입니다.",
    content: "일반건강검진은 문진과 진찰, 신체계측, 시력·청력, 혈압, 소변·혈액검사, 흉부방사선촬영, 구강검진 등을 실시하고 성별·연령별 위험에 따라 추가 검사항목을 제공합니다. 검진 결과 질환이 의심되면 고혈압·당뇨병·폐결핵 등 확진검사와 사후관리로 연계합니다.",
    sourceTitle: "건강검진 실시기준",
    publisher: "국민건강보험공단",
    url: "https://www.nhis.or.kr/lm/lmxsrv/law/lawFullContent.do?SEQ=80&SEQ_HISTORY=613138",
    verifiedOn: "2026-09-20",
  },
];

const BY_SERVICE_ID = new Map(
  VERIFIED_SUPPLEMENTS.flatMap((supplement) =>
    supplement.serviceIds.map((serviceId) => [serviceId, supplement] as const),
  ),
);

export function getVerifiedWikiSupplement(serviceId: string): VerifiedWikiSupplement | null {
  return BY_SERVICE_ID.get(serviceId) ?? null;
}

export function listVerifiedWikiSupplements(): readonly VerifiedWikiSupplement[] {
  return VERIFIED_SUPPLEMENTS;
}
