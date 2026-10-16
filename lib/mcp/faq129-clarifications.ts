export interface Faq129Clarification {
  readonly revision: string;
  readonly reviewed_at: string;
  readonly review_due_at: string;
  readonly verification_scope: 'listed_guidance_only';
  readonly status: 'RESOLVED' | 'PARTIALLY_RESOLVED';
  readonly original_content_sha256: string;
  readonly guidance: readonly string[];
  readonly derived_calculations: readonly string[];
  readonly remaining_uncertainties: readonly string[];
  readonly sources: readonly {
    readonly title: string;
    readonly publisher: string;
    readonly url: string;
    readonly published_at: string | null;
    readonly source_dates?: { readonly published_at: string | null; readonly effective_at: string | null; readonly posted_at: string | null; readonly updated_at: string | null };
    readonly verified_snapshot?: {
      readonly excerpt: string;
      readonly checked_at: string;
      readonly source_snapshot_sha256: string;
      readonly retrieval_method: 'direct_public_page_body';
      readonly verification_scope: 'listed_excerpt_only';
    };
    readonly location: string;
  }[];
}

const maternalSource = {
  title: '2026년 모자보건사업 안내', publisher: '보건복지부 (법제처 제공 사본)',
  url: 'https://www.easylaw.go.kr/CSP/FlDownload.laf?flSeq=1769406083842', published_at: null,
};
const disabilitySource = {
  title: '2026년 장애인복지시설 사업안내', publisher: '보건복지부 (경상남도 공식 게시)',
  url: 'https://welfare.gyeongnam.go.kr/board/atchDown.do?no=295', published_at: '2026-07-24',
};
type Entry = Omit<Faq129Clarification, 'revision' | 'reviewed_at' | 'review_due_at' | 'verification_scope'> & Partial<Pick<Faq129Clarification, 'revision' | 'reviewed_at' | 'review_due_at'>>;

const pensionSource = {
  title: '2026년 기초연금 사업안내', publisher: '보건복지부 (강남구 공식 공개본)',
  url: 'https://bokji.gangnam.go.kr/file/1/get/017ed301-1937-4722-8396-bcebd422fca4/download.do', published_at: null,
};
const pensionReview = { revision: 'official-clarifications-20261014-v5', reviewed_at: '2026-10-14', review_due_at: '2026-11-13' };
const pensionProxyGuidance = [
  '기초연금 지급 신청의 대리서류를 설명할 때 일반 원칙과 예외를 함께 안내한다. 배우자(만 65세 미만 포함)는 위임장을 제출하지 않아도 되며 부부관계 및 배우자 신분 확인은 필요하다. 사실혼 배우자는 사실혼 인정 또는 확인조사 전제이다. 위임장 면제를 모든 신청서류·신분증 면제로 확대하지 않는다.',
  '자녀·형제자매·친족(8촌 이내 혈족, 4촌 이내 인척)·시설장은 일반 위임장 대상이다. 배우자·자녀의 관계 증명 생략은 주민등록세대원 조회로 관계가 확인되는 경우에 한정한다.',
  '후견인은 후견등기사항증명서로 대리권 범위를 확인한다. 기초연금 신청 등 공법상 법률행위의 대리권이 있으면 위임장 불필요이며, 모든 후견인에게 일률적으로 위임장을 필수 또는 면제라고 안내하지 않는다. 지자체 소속 공무원의 대신 신청에는 수급희망자의 동의가 필요하다.',
  '이 보충은 기초연금 지급 신청에 한정된다. 찾아뵙는 서비스의 방문 요청과 실제 지급 신청을 구분하고, 미지급 연금 청구·수급 포기·다른 복지사업의 위임장에 같은 예외를 자동 적용하지 않는다. 질문에 필요 없는 대리신청 서류를 추가하면서 위임장을 무조건 필수라고 단정하지 않는다.',
];
const pensionExclusionGuidance = [
  '직역연금 수급권자와 그 배우자는 원칙적으로 제외되지만, 예외를 추가 설명하면 지급 종류·재직기간·경과기간과 각주를 함께 제시한다. 연계퇴직연금 또는 연계퇴직유족연금의 직역재직기간 10년 미만은 별도의 예외이다.',
  '공무원·사학의 장해일시금, 비공무상 장해일시금, 비직무상 장해일시금, 퇴직유족연금일시금 또는 퇴직유족일시금, 군인의 퇴역유족연금일시금·순직유족연금일시금, 별정우체국 유족연금일시금은 해당 지급 이후 5년 경과 조건을 확인한다. 퇴직유족일시금의 경우 순직유족연금(사학 직무상유족연금 포함) 또는 위험직무순직유족연금을 갈음하여 선택한 경우에 한정한다. 모든 퇴직·유족 일시금이 5년 후 예외라는 뜻이 아니다.',
  '특례를 설명하는 경우 1949년 6월 30일 이전 출생 AND 종전 기초노령연금 수급권자 AND 선정기준액 이하 조건을 함께 제시한다. 장애인연금 특례는 중증장애인 AND 1996년 6월 30일 이전 출생 AND 65세 도달 당시 장애인연금법 부칙 제4조 특례 수급자 AND 당시 선정기준액 이하이며, 선정기준액·특례요건을 65세까지 유지해야 한다. 출생연도만으로 특례를 인정하지 않는다. 지침의 1996년을 추정으로 다른 연도로 고치지 않는다.',
  '위 예외·특례의 확인은 해당 공개 지침의 조건에 한정되며, 최종 지급 여부·금액 및 최신 개정 전체를 인증한 것은 아니다.',
];
function pensionProxyEntry(originalHash: string, includeExclusions = false): Entry {
  return {
    ...pensionReview, status: 'RESOLVED', original_content_sha256: originalHash,
    guidance: [...pensionProxyGuidance, ...(includeExclusions ? pensionExclusionGuidance : [])],
    derived_calculations: [], remaining_uncertainties: [],
    sources: [{ ...pensionSource, location: '인쇄 19~20쪽 / PDF 37~38쪽, 대리신청 자격 및 신청자별 구비서류 표·각주' },
      ...(includeExclusions ? [{ ...pensionSource, location: '인쇄 43쪽 / PDF 61쪽, 직역연금 제외 예외·특례 및 퇴직유족일시금 각주' }] : [])],
  };
}

const sourceDateReview = { revision: 'official-clarifications-20261014-v9', reviewed_at: '2026-10-14', review_due_at: '2026-11-13' } as const;
const pensionDateSources = [
  { title: '기초연금 대상자 안내', publisher: '보건복지부 기초연금', url: 'https://basicpension.mohw.go.kr/menu.es?mid=a10102010000', published_at: null, location: '직접 본문의 2026년 선정기준액 표: 단독가구2,470,000원·부부가구3,952,000원; 하단 2026년 기준연금액 표시',
    verified_snapshot: { excerpt: '2026년 선정기준액 - 구분, 단독가구, 부부가구. 선정기준액 2,470,000원 3,952,000원', checked_at: '2026-10-14', source_snapshot_sha256: '2214b1f9a8d6c1d99dd080fc012c142a778094f2bf2053fd48ef1e11e2b22874', retrieval_method: 'direct_public_page_body', verification_scope: 'listed_excerpt_only' } },
  { title: '기초연금액 산정', publisher: '보건복지부 기초연금', url: 'https://basicpension.mohw.go.kr/menu.es?mid=a10103010000', published_at: null, location: '본문 2026년1월~12월 월349,700원 및 산정표의 26년 기간·금액 열; 표 설명의 25년 표현과 구분',
    verified_snapshot: { excerpt: '※ 2026년 1월 ~ 2026년 12월: 월 349,700원', checked_at: '2026-10-14', source_snapshot_sha256: '449ea3f4cf45b58cd25b8dc747e13b2ed281d69d11b6da490e8d541515526dd0', retrieval_method: 'direct_public_page_body', verification_scope: 'listed_excerpt_only' } },
] as const;
function pensionDateEntry(originalHash: string, includeExclusions = false): Entry {
  return {
    ...sourceDateReview, revision: includeExclusions ? 'official-clarifications-20261014-v11' : 'official-clarifications-20261014-v10', status: 'RESOLVED', original_content_sha256: originalHash,
    guidance: [
      '2026-10-14 직접 확인한 보건복지부 기초연금 대상자 안내 본문은 2026년 선정기준액을 단독가구 월2,470,000원·부부가구 월3,952,000원으로 표시한다. 같은 URL을 검색 요약만으로 2025년228만원·364만8천원이 남은 자료라고 설명하지 않는다.',
      '기초연금액 산정 페이지 본문과 표의 기간 열은 2026년1월~12월, 기준연금액 월349,700원을 표시한다. 표의 설명·접근성 제목 일부에는 25년 표현이 남아 있지만 이를 표 전체의 적용연도가2025년이라는 뜻으로 확대하지 않는다. 월349,700원은 기준연금액이며 실제 지급액은 해당 산정·감액 조건을 별도로 확인한다.',
      '기준연도와 원문 작성일·게시일·페이지 수정일을 구분한다. 이 두 페이지에서 작성일·게시일·최종수정일은 확인되지 않았다. 2026년은 금액의 적용연도이고2026-10-14는 추가 검수일이며 이를 자료 공표일로 기재하지 않는다. 웹 본문을 직접 읽지 못했다면 읽었다고 주장하지 않고 MCP 보충 근거와 실제 웹 확인 범위를 구분한다.',
      '아래 verified_snapshot은 공식 공개 본문을 직접 검수한 시점의 발췌와 응답 해시이다. 검색 도구가2025년 내용을 반환하면 반환 자료와 검수한2026년 본문 사이의 시점 불일치로 구분하고 해당 URL의 현행 본문이2025년이라고 확정하지 않는다. 제공자의 원시 반환 내용을 확인하지 못하면 캐시·색인·생성 중 어느 원인인지 단정하지 않는다. 검수 이후 공식 변경을 직접 확인한 근거가 있으면 그 날짜·본문을 함께 밝혀 최신 근거로 재확인한다.',
          ...(includeExclusions ? pensionExclusionGuidance : []),
    ], derived_calculations: [], remaining_uncertainties: [], sources: [
      ...pensionDateSources,
      ...(includeExclusions ? [{ ...pensionSource, location: '인쇄43쪽 / PDF61쪽, 직역연금 제외 예외·특례 및 필수 결합 조건·각주' }] : []),
    ],
  };
}

const conditionReview = { revision: 'official-clarifications-20261014-v8', reviewed_at: '2026-10-14', review_due_at: '2026-11-13' } as const;
const ambulanceGuidance = [
  '구급차 대기료를 설명할 때 병원 도착 후 모든 외래진료 대기를 청구 가능하다고 안내하지 않는다. 2026-08-14 시행 응급의료에 관한 법률 시행규칙 별표3 비고3은 의료기관 도착부터 환자 인계 전까지의 대기로 한정하고, 도착시간부터 이송종료시간까지의 기록으로 산정하도록 규정한다.',
  '별표3의 대기료는 의료기관에 도착 후 30분을 초과하는 경우 매10분당 6,000원이다. 30분 초과 조건과 환자 인계 전 범위를 함께 보존한다. FAQ의 병원 대기 표현과 법령의 범위가 다름을 밝히고 실제 환자 인계·이송종료 시점을 확인한다.',
  '동일 환자를 연속 이송하는 왕복의 기본요금, 실제 이송거리, 통행료 처리와 환자 인계 전 대기료는 서로 다른 항목이다. 이 보충은 대기료 비고 확인이며 모든 이송 사례의 요금 전체나 이송 후 진료 대기 시간을 인증하는 것은 아니다.',
] as const;
const ambulanceSources = [
  { title: '응급의료에 관한 법률 시행규칙 별표3 이송처치료의 기준', publisher: '국가법령정보센터', url: 'https://www.law.go.kr/LSW/flDownload.do?gubun=&flSeq=167218505&bylClsCd=110201', published_at: null, source_dates: { published_at: null, effective_at: '2026-08-14', posted_at: null, updated_at: null }, location: '별표3 대기료 행·비고3, 2026-07-13 개정 표시; 기관 도착~환자 인계 전 범위' },
  { title: '구급차 이송처치료 기준 변경 안내', publisher: '천안시', url: 'https://www.cheonan.go.kr/bbs/BBSMSTR_000000000159/view.do?nttId=B000000511541Bt8wF7', published_at: null, source_dates: { published_at: null, effective_at: '2026-08-14', posted_at: '2026-08-03', updated_at: null }, location: '본문 변경 기준 시행일 2026-08-14 및 공식 별표 첨부' },
] as const;

const ambulanceRecordGuidance = [
  '출동 및 처치기록지 교부에 관한 현행 제40조제2항은 환자를 인수한 응급의료종사자의 서명을 규정한다. 실제 읽은 법령 링크가 현행 본문을 반환하는지 확인하고, 검색 요약의 의사 서명 또는2025년 시행일을 해당 링크의 날짜·내용으로 단정하지 않는다.',
  '3부 작성 후 환자인수 응급의료종사자의 서명을 받아1부는 보관,1부는 진료의사 제출,1부는 환자 또는 보호자 발급이다. 출동 및 처치기록지와 이송처치료 영수증은 별개이며 환자와 보호자 모두에게 각각 발급하는 조건으로 바꾸지 않는다.',
  '공식 조문 링크별 시행일 표기가2026-07-13과2026-08-14로 다를 수 있다. 아래 현행 연계조문은2026-08-14 시행·2026-07-13 개정으로 표시된다. 개정일, 시행일, 협회 게시일2026-10-02, 근거 공문일2026-09-30을 구분하고 법령의 원문 작성일로 혼합하지 않는다.',
  '의료기관 이송 시 실제 인수자의 면허번호·성명·서명과 직종을 기록한다. 의사·간호사·응급구조사 모두의 서명을 요구하는 의미가 아니다. FAQ9715의 자택 등 비의료기관 이송 시 인수자 공란 예외를 의료기관에서의 서명 거부나 기록지 교부의 일반 면제로 확대하지 않는다.',
] as const;
const ambulanceRecordSources = [
  { title: '응급의료에 관한 법률 시행규칙 제40조 현행 연계조문', publisher: '국가법령정보센터', url: 'https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lspttninfSeq=79752', published_at: null, source_dates: { published_at: null, effective_at: '2026-08-14', posted_at: null, updated_at: null }, location: '제40조제1항·제2항, 2026-07-13 개정 표시; 서명·기록·3부 배부' },
  { title: '구급차 출동및처치기록지 작성 시 환자 인계·인수 응급의료종사자의 적극 협조 요청', publisher: '대한병원협회 (보건복지부 공문 전달)', url: 'https://www.kha.or.kr/kha_home/notice_list.do?mode=view&articleNo=47610', published_at: null, source_dates: { published_at: null, effective_at: null, posted_at: '2026-10-02', updated_at: null }, location: '본문 근거 공문 보건복지부 재난의료정책과-925(2026-09-30), 서명·면허번호·성명·직종 및 제40조제2항 인용' },
] as const;


const pancreasGuidance = [
  "췌장이식 받은 사람의 서류 간소화는 심하지 않은 장애로 등록하는 경우이다. 장애정도 심사용 진단서 AND수술기록지만 제출하며, 모든 췌장이식환자의 검사·진료기록이 면제되는 것은 아니다.",
  "췌장이식 후에도 심한 장애 기준을 충족하여 심한 장애로 등록하려면, 진단서·수술기록지에 검사결과지·진료기록지를 추가 제출해야 한다. 가이드라인 인쇄3쪽 표·인쇄9쪽 구비서류 표의 각주를 함께 보존하고 이식 여부만으로 심한 장애를 배제하지 않는다.",
  "일반 심한 장애의 필수서류는 장애정도 심사용 진단서 AND검사결과지 AND진료기록지(진단일 전6개월 이상)이다. 단순 당뇨병 진단과 췌장장애 진단·등록을 구분하며 서류 제출만으로 등록이 확정된다고 안내하지 않는다.",
  "진단하는 의사는 장애진단 직전3개월 이상 지속적으로 진료한 내과 내분비대사분과 OR소아청소년과 내분비분과 전문의이다. 전체췌장절제·자가항체2종이상 양성에 따른6개월 치료기간 예외를 이3개월 이상 진료 요건의 면제로 확대하지 않는다. 이식 후 심하지 않은 장애의 진단은 이식을 시술했거나 진료 중인 의료기관의 외과 OR내과 전문의가 담당한다.",
  "가이드라인 표지의2026-06-29는 문서 작성일이고2026-07-01은 제도 시행일이다. 이 공개 사본을 호스팅한 페이지의 게시일·최종수정일은 미확인이며2026-10-14는 추가 검수일이다. 서류·장애정도·진료기간의 위 검수 범위 외 모든 등록 자격이나 개인별 판정을 인증한 것은 아니다."
] as const;
function pancreasEntry(originalHash: string): Entry {
  return {
    revision: 'official-clarifications-20261014-v12', reviewed_at: '2026-10-14', review_due_at: '2026-11-13',
    status: 'RESOLVED', original_content_sha256: originalHash,
    guidance: [...pancreasGuidance], derived_calculations: [], remaining_uncertainties: [],
    sources: [{ title: '췌장장애 진단 및 등록 가이드라인', publisher: '보건복지부 (대한당뇨병학회 공개 사본)',
      url: 'https://diabetes.or.kr/bbs/download.php?code=insurance&number=3139', published_at: null,
      source_dates: { published_at: null, effective_at: '2026-07-01', posted_at: null, updated_at: null },
      location: '표지 작성일2026-06-29; 인쇄3쪽 진단요약·구비서류 표 각주, 인쇄4~5쪽 치료기간 및 진료기간 예외, 인쇄9쪽 구비서류 표 각주' }],
  };
}

const reviewed: Readonly<Record<string, Entry>> = {
  '12357': {
    revision: 'official-clarifications-20261014-v22', reviewed_at: '2026-10-14', review_due_at: '2026-11-13',
    status: 'RESOLVED', original_content_sha256: '9a419891a792075e4757b74c68ce817c91432792a139ad1b8eb7d9c552a4fa72',
    guidance: [
      '언어발달지원의 연령은 신청일 기준으로 판정하며, 대상자로 선정된 달의 다음 달부터 수급 아동이 12세가 되는 달까지 지원한다. 익월 바우처 생성은 매월 27일 18:00까지 시·군·구에서 한국사회보장정보원으로 대상자 선정 결과가 전송된 경우에 한한다. 선정됐다는 사실만으로 마감 이후에도 자동으로 다음 달 바우처가 생성된다고 안내하지 않는다.',
      '계속 이용은 연령 상한만으로 보장되지 않는다. 기존 이용자는 매년 반기별(매년 2회) 소득기준 조사 후 적합한 경우 계속 이용 가능하다. 12세가 되는 달까지는 최대 지원 연령의 안내이며, 대상 적격 재판정 조건을 면제하는 뜻이 아니다.',
      '대상은 12세 미만 비장애 아동 AND 부모 중 한쪽 또는 조손가정의 조부모 중 한쪽이 시각·청각·언어·지적·자폐성·뇌병변 등록장애인 AND 기준 중위소득 120% 이하이다. 양쪽 부모 또는 양쪽 조부모가 해당 등록장애인이면 우선 지원하며, 양쪽 장애를 일반 자격의 필수 조건으로 바꾸지 않는다.',
      '공식 전자바우처 안내의 원문 작성일·게시일·최종수정일은 본문에서 확인되지 않았다. 2026년 지침 링크는 연결 자료의 연도이며, 2026-10-14는 검수일이다. 이를 해당 페이지의 공표일로 표시하지 않는다.',
    ], derived_calculations: [], remaining_uncertainties: [],
    sources: [{
      title: '언어발달지원사업', publisher: '한국사회보장정보원 사회서비스 전자바우처',
      url: 'https://www.socialservice.or.kr:444/user/htmlEditor/view2.do?p_sn=12', published_at: null,
      location: '서비스 대상의 신청일 연령 판정·선정 다음달~12세 도달월, 대상적격 재판정, 서비스 신청의 매월27일18시 선정결과 전송 조건',
      verified_snapshot: {
        excerpt: '연령은 신청일을 기준으로 판정하되, 대상자로 선정된 달의 다음 달부터 수급 대상아동이 12세가 되는 달까지 지원. 기존 이용자의 경우 매년 반기별(매년 2회) 소득기준 조사 후 적합한 경우 계속 이용 가능. 매월 27일 18:00까지 시·군·구에서 한국사회보장정보원으로 대상자 선정 결과가 전송된 경우에 한해, 익월 바우처 생성.',
        checked_at: '2026-10-14', source_snapshot_sha256: '4cd718d78b0517704aa97aa4ae0a7675893ae50926d547a2a40810f66b79cf49',
        retrieval_method: 'direct_public_page_body', verification_scope: 'listed_excerpt_only',
      },
    }],
  },
  '970': {
    revision: 'official-clarifications-20261014-v20', reviewed_at: '2026-10-14', review_due_at: '2026-11-13',
    status: 'RESOLVED', original_content_sha256: '2a0b9c987097bb0e3b509e3972d6ca4d6ba87a47924895bf1e0eb6ba99362634',
    guidance: [
      '난임시술비 지급 범위·본인부담금90%·비급여 항목별 한도·합산 상한은 FAQ 원문을 보존한다. 체외수정 신선·동결 합산20회, 인공수정5회는 출산당 기준이며, 신선110만원·동결50만원·인공30만원은 회당 최대액이다. 청구액 전부나 상한액을 정액 지급하는 뜻이 아니다.',
      '2026-10-14 직접 확인한 e보건소 본문은 출산당25회(체외수정 최대20회, 인공수정 최대5회)를 표시한다. 아래 확인본을 신선9회·동결7회가 남은 현행 자료라고 설명하지 않는다. 검색 도구가 다른 시점 자료를 반환하면 실제 반환 내용과 직접 검수한 본문 사이의 차이로 한정하고, 원시 반환값을 확인하지 못한 상태에서 캐시·색인 등 원인을 단정하지 않는다.',
      'e보건소 지급 조건은 지원결정통지서 발급 이후 발생 비용만 지원하고 종료된 시술은 소급지원 불가이다. 단, 시작일이 공휴일(토요일 포함)이면 공휴일 다음 날, 연휴이면 연휴 마지막 날 다음 날까지 통지서를 교부받은 경우 인정한다. 이 예외를 모든 사후 신청이나 통지서 없는 시술의 소급 지원으로 확대하지 않는다.',
      '지자체 추가 지원과 지역별 서류·횟수는 구분한다. 서울시 안내는 시술별 칸막이 없이 출산당25회로 별도 표시하므로 이를 다른 지역에 자동 적용하지 않는다. 지역 적용은 관할 보건소에서 확인한다. 법적 혼인 또는1년 이상 사실혼, 진단서, 국적·건강보험 조건을 추가 설명하면 공식 근거의 AND/OR 및 사실혼 서류 예외를 함께 확인한다.',
      'e보건소 페이지 작성일·게시일·수정일은 미확인이다. 생활법령정보의2026-09-15는 작성 기준일이며, FAQ작성일2026-02-20 및 추가 검수일2026-10-14와 구분한다. 아래 검수는 명시 발췌에 한정되며 현행 사업 전체나 개인별 지급 결정을 인증하지 않는다.',
    ], derived_calculations: [], remaining_uncertainties: [],
    sources: [
      { title: '난임부부 시술비 지원신청', publisher: '공공보건포털 e보건소', url: 'https://www.e-health.go.kr/gh/caSrvcGud/selectMdclSupGudInfo.do?heBiz=PG00001&menuId=200009', published_at: null,
        location: '지원내용의 출산당25회·체외20회·인공5회 및 지원결정통지서 발급 이후 비용·공휴일 예외',
        verified_snapshot: { excerpt: '지원시술횟수：출산당25회(체외수정 최대20회, 인공수정 최대5회). 시술 시작일이 공휴일(토요일 포함)이면 다음 날, 연휴이면 마지막 날 다음 날까지 지원결정통지서 교부 시 인정.', checked_at: '2026-10-14', source_snapshot_sha256: '8643672905bc154a1934b779e7d556ce93968bcc18b28e4ee874f6661ef3f4bc', retrieval_method: 'direct_public_page_body', verification_scope: 'listed_excerpt_only' } },
      { title: '난임부부 시술비', publisher: '법제처 찾기쉬운 생활법령정보', url: 'https://www.easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=1112&ccfNo=3&cciNo=2&cnpClsNo=1', published_at: null,
        location: '작성 기준일2026-09-15; 지원요건·2026 모자보건사업 안내 인용의 출산당 횟수 및 금액표' },
      { title: '서울시 난임부부 시술비 지원사업', publisher: '서울시 임신·출산 정보센터', url: 'https://seoul-agi.seoul.go.kr/ifc-csp', published_at: null,
        location: '서울시 시술별 칸막이 없는 출산당25회 및 기본·추가서류, 사실혼 진단서 제출 예외' },
    ],
  },
  '2399': {
    revision: 'official-clarifications-20261014-v19', reviewed_at: '2026-10-14', review_due_at: '2026-11-13',
    status: 'RESOLVED', original_content_sha256: 'f6fad54e07cc685b17aa9874d3f20f11190c5ae817ae66f07c9d657f5533fa4e',
    guidance: [
      '실내 흡연실의 연기를 실외로 배출하는 환기시설 의무에 관한 FAQ 원문을 보존한다. 법제처 안건25-0471을 보완근거로 사용하면2025-09-16은 회신일자이며 웹페이지 게시일이나 작성일이 아니라는 점을 밝힌다. 이 페이지의 작성일·게시일·수정일은 공개본문에서 확인되지 않는다.',
      '이 법령해석의 직접 질의는 실외 흡연실 지붕·바람막이의 설치 의무이다. 실내 흡연실 환기시설 의무의 보완근거는 관계법령 절에 인용된 국민건강증진법 시행규칙 별표2 제2호다목3)이며, 실외 자연환기나 지붕의 재량 규정을 실내 환기시설 면제로 확대하지 않는다.',
      '실내 차단·밀폐공간, 공동 사무실·화장실·복도·계단 사용금지 등 추가조건은 같은 관계법령의 해당 항목과 함께 안내한다. 회신일, 인용 법령의 공포·시행일, FAQ작성일2026-03-04, 추가검수일을 구분하고 법령해석 당시 자료만으로 현행 법령 전체를 인증하지 않는다.',
    ], derived_calculations: [], remaining_uncertainties: [],
    sources: [{ title: '법제처 법령해석 안건25-0471', publisher: '법제처 국민참여입법센터', url: 'https://opinion.lawmaking.go.kr/nl4li/lsItptEmp/447785?mode=all', published_at: null,
      source_dates: { published_at: null, effective_at: null, posted_at: null, updated_at: null },
      location: '안건정보 회신일자2025-09-16; 직접질의는실외지붕·바람막이, 관계법령절의별표2 제2호다목2)~3)은실내차단·환기시설 기준',
      verified_snapshot: { excerpt: '안건번호 법제처-25-0471. 회신일자2025.9.16. 건물 내 흡연실에는 연기를 실외로 배출할 수 있도록 환풍기 등 환기시설을 설치하여야 한다.', checked_at: '2026-10-14', source_snapshot_sha256: 'c84f95702eef7e00fedf098660c50e1adc0a34fbcd75b0d5767fd52e55349b18', retrieval_method: 'direct_public_page_body', verification_scope: 'listed_excerpt_only' } }],
  },
  '2881': {
    ...pensionProxyEntry('315720b342e596785a075fa5d0777dcbf79adbd65ec95c53c1820162a10c3076'),
    revision: 'official-clarifications-20261014-v18',
    guidance: [...pensionProxyGuidance,
      '기초연금 공식 신청안내의2015-01-22는 재외국민 주민등록 설명에 있는 주민등록법 일부개정 시행일이며 웹페이지 게시일이 아니다. 공개 본문에서 작성일·게시일·수정일은 확인되지 않는다. 검색 결과의 날짜도 원문 날짜로 검증되지 않았으면 미확인으로 안내하고, 법 시행일·FAQ작성일·사업안내 연도·검수일과 구분한다.',
    ],
    sources: [{ ...pensionSource, location: '인쇄19~20쪽 / PDF37~38쪽, 대리신청 자격·구비서류 표 및 각주' },
      { title: '기초연금 신청안내', publisher: '보건복지부', url: 'https://basicpension.mohw.go.kr/menu.es?mid=a10201000000', published_at: null,
        location: '재외국민 주민등록자 설명의2015.1.22.시행은 주민등록법 시행일; 페이지 작성일·게시일·수정일 미확인' }],
  },
  '17701': {
    revision: 'official-clarifications-20261014-v17', reviewed_at: '2026-10-14', review_due_at: '2026-11-13',
    status: 'RESOLVED', original_content_sha256: '1259c2fe0b8c78420fe6760a8118e2b8b98acea40abca99856db9b70bb35aedc',
    guidance: [
      '통합돌봄 신청처·방문/우편/팩스의 원문 안내에 사전조사 절차를 보완하면 접수일 기준5일 이내 수행 원칙과 면제 대상을 함께 안내한다. 의료기관 퇴원연계 대상자 등은 사전조사 면제이며, 지자체 자체조사 대상에는 직권신청과 의료기관 퇴원 연계 대상자 등이 포함된다. 사전조사 면제를 모든 조사·선정절차 면제나 자동 서비스 제공으로 확대하지 않는다.',
      '공식 사전개요의 직원신청 표기는 같은 본문의 신청자 및 지자체 자체조사 절에 있는 직권신청 표기와 구분하여 읽는다. 정확한 적용은 관할 담당자에게 확인하고, 단순히 기관이 신청한 모든 사람이 면제라고 확대하지 않는다.',
      '신청자 추가 안내는 대상자·8촌 이내 친족·후견인·긴급지원 필요 시 시군구 직권신청·본인 동의가 있는 기관 담당자를 구분한다. 신청방법과 제출서류의 상세 조건은 공식 신청서에 따라 확인하며, FAQ에 서류가 없다는 이유로 서류 불필요라고 단정하지 않는다.',
      '공식 안내에서 작성일·게시일은 확인되지 않는다. FAQ작성일과 신청서 개정표시, 추가 검수일을 원자료 작성일로 바꾸지 않는다. 이 보충은 신청 및 조사 경로의 해당 조건에 한정된다.',
    ], derived_calculations: [], remaining_uncertainties: ['공식 사전개요의 직원신청 표기와 다른 절의 직권신청 표기 차이는 관할 담당자에게 확인한다.'],
    sources: [{ title: '지역사회 통합돌봄 이용안내', publisher: '보건복지부', url: 'https://www.mohw.go.kr/menu.es?mid=a60200000000', published_at: null, location: '신청방법·사전개요 면제 각주·지자체 자체조사 대상자',
      verified_snapshot: { excerpt: '의료기관 퇴원연계 대상자 등은 사전조사 면제. 지자체 자체조사 대상: 직권신청, 의료기관 퇴원 연계 대상자 등.', checked_at: '2026-10-14', source_snapshot_sha256: '040e413dca299c0608f5635e0f992fac9852b2cb4807f03f5deb75a47db9b9c9', retrieval_method: 'direct_public_page_body', verification_scope: 'listed_excerpt_only' } }],
  },
  '7770': {
    revision: 'official-clarifications-20261014-v17', reviewed_at: '2026-10-14', review_due_at: '2026-11-13',
    status: 'RESOLVED', original_content_sha256: 'a292b0e8ba5cf032f046a5f918b9d4fc9dfaa64d162222105b9ebbfbbfadc642',
    guidance: [
      '장애인복지법 시행령 제36조의2의 아래 조문 링크를2026-10-14 직접 확인한 열람본은 대통령령제36559호,2026-08-04 일부개정,2026-09-01 시행이다. 해당 열람본을2025-12-30 개정·2026-01-02 시행으로 설명하지 않는다. 검수 이후 변경을 실제 확인하면 그 열람본의 법령번호·공포일·시행일을 함께 밝힌다.',
      '법령 전체의 개정·시행일, 조문별 개정 표시2021-06-29, FAQ작성일2026-04-17, 추가검수일은 서로 다른 날짜이다. 검색 요약이나 연혁본의 날짜를 현재 직접 읽은 조문 날짜라고 단정하지 않는다. 법령을 직접 읽지 못했으면 아래 MCP 검수 발췌와 실제 웹 확인 범위를 구분한다.',
      'FAQ의 기관 해당 여부·취업자 및 취업예정자 조회 의무를 보존한다. 추가한 조회 요청 주체별 서류·공동이용 대체·회신서 대체·점검 주기를 설명할 때에는 각각의 조문 범위를 확인한다. 이 날짜 검수가 모든 시설의 해당 여부나 법률 전체의 현행 검증을 뜻하지 않는다.',
    ], derived_calculations: [], remaining_uncertainties: [],
    sources: [{ title: '장애인복지법 시행령 제36조의2 현행 연계조문', publisher: '국가법령정보센터', url: 'http://www.law.go.kr/LSW/lsLawLinkInfo.do?lsJoLnkSeq=1000572473&chrClsCd=010202', published_at: null,
      source_dates: { published_at: '2026-08-04', effective_at: '2026-09-01', posted_at: null, updated_at: null }, location: '조문정보 상단 현행 시행본 번호 및 공포·시행일; 조문 내부2021-06-29 개정 표시와 구분',
      verified_snapshot: { excerpt: '장애인복지법 시행령 [시행 2026. 9. 1.] [대통령령 제36559호, 2026. 8. 4., 일부개정]', checked_at: '2026-10-14', source_snapshot_sha256: '2a1bd42725c4adbf9844e15a92b1c3199d169d0e4167b692db40fedf8bda9661', retrieval_method: 'direct_public_page_body', verification_scope: 'listed_excerpt_only' } }],
  },
  '13976': {
    revision: 'official-clarifications-20261014-v18', reviewed_at: '2026-10-14', review_due_at: '2026-11-13',
    status: 'RESOLVED', original_content_sha256: 'd8acee8e8d19bc9ab1788deb8cce374c3e99603d1162f9dcb2c4b8a87347d245',
    guidance: [
      'e보건소 임신 사전건강관리 페이지를2026-10-14 직접 검수한 본문에는2024.12.1.기준 표기가 없다. HTML 주석의 의료기관 목록2026.2.1.기준은 공개 본문에 표시된 작성일이나 사업 적용일이 아니므로 자료 날짜로 제시하지 않는다. 페이지의 작성일·게시일·수정일은 미확인이다.',
      'FAQ작성일2026-03-13, 검수일, 의료기관 목록 기준일을 분리한다. 검색 반환이나 연혁 자료에 다른 날짜가 있으면 그 자료의 날짜로 한정하고, 현재 본문을 직접 읽지 못했으면 현행 페이지에 표시된 날짜라고 단정하지 않는다.',
      '한 검사만 받더라도 해당 검사료와 진찰료 실비를 지원한다는 원문을 보존한다. 금액·연령주기·신청절차·서류를 추가하면 실제 읽은 공식 안내의 범위를 밝힌다. 온라인 제출서류 없음은 내국인 신청 안내이며 외국인의 배우자·혼인증빙 예외를 모든 신청자 서류 면제로 바꾸지 않는다.',
      '연령을 추가 설명할 때20~49세 검사희망자 원칙(결혼·자녀 여부 불문)과15~19세 남녀 중 부부(예비부부·사실혼 포함) 예외를 함께 안내한다. 이 예외는 공식 신청대상 절의 실제 공개 각주이다. 연령주기별1회·최대3회는29세 이하,30~34세,35~49세 주기로 구분하며 모든 미성년자에게 혼인 조건 없이 확대하지 않는다.',
      '이번에 직접 읽은 e보건소 제출방법에는 관할 보건소 방문과 온라인 첨부가 명시되어 있으나 배우자 대리제출 허용 문구는 없다. 과거 리플릿·검색 요약의 배우자 대리제출을 이 현행 페이지의 확인 내용으로 단정하지 말고, 현행 적용과 대리인 구비서류는 관할 보건소에 확인한다.',
    ], derived_calculations: [], remaining_uncertainties: [],
    sources: [{ title: '임신 사전건강관리 지원', publisher: '공공보건포털 e보건소', url: 'https://www.e-health.go.kr/gh/caSrvcGud/selectMdclSupGudInfo.do?heBiz=PG00003&menuId=200097', published_at: null, location: '신청대상 공개 각주의15~19세 부부 예외; 공개본문과 의료기관 목록 HTML 주석 구분; 신청서류 및 온라인 제출 각주',
      verified_snapshot: { excerpt: '20~49세 남녀 중 검사희망자. 15~19세 남녀 중 부부(예비부부, 사실혼 포함). 여성 최대13만원. 내국인 온라인 신청 시 제출서류 없음; 외국인 온라인 신청은 배우자·혼인 증빙 해당 서류 제출.', checked_at: '2026-10-14', source_snapshot_sha256: '8b7c167b577b03358d54d7b441f1cb0b99abb9ce10ba592529dda98392003e1d', retrieval_method: 'direct_public_page_body', verification_scope: 'listed_excerpt_only' } }],
  },
  '14054': {
    revision: 'official-clarifications-20261014-v18', reviewed_at: '2026-10-14', review_due_at: '2026-11-13',
    status: 'RESOLVED', original_content_sha256: '90d7469d8b20081af6b1eb8e270740c9be581b8c1da18433c29cf55763057d8f',
    guidance: [
      '차상위 본인부담경감의 원문 대상·6개월 치료조건·18세 미만 조건을 보존한다. 만성질환 신청서류를 추가하면2026 사업안내 인쇄53쪽 / PDF65쪽의 진단서 인정기준과 예외를 함께 설명한다. 신규신청·확인조사·종별변경의 만성질환 진단은 최종진단과 임상적 추정에 의한 진단 모두 인정하며, 지자체 접수일 기준 최근3개월 이내 발급 진단서1부가 원칙이다.',
      '2026-04-01 지자체 접수 건부터 진단서에6개월 이상·치료가 필요한·만성질환임을 기재하는 기준이 적용되며,6개월 이상임을 추정할 수 있는 경우도 인정한다. 기간 추정 인정 예외를 누락하여 반드시 실제6개월 치료를 마쳤어야 한다고 제한하지 않는다. 성형·미용 목적 치료와 급성기 질환은 인정하지 않는다.',
      '의료급여에서 정하는11개 고시질환은 만성질환임이 명시되지 않아도 인정 가능하나6개월 이상·치료 필요는 기재되어야 한다. 갑상선의 장애, 당뇨병, 정신장애·행동장애, 신경계질환, 고혈압, 심장질환, 뇌혈관질환, 만성간질환, 기타 만성폐쇄성폐질환, 두개내손상, 뇌전증이다. 이 예외를 모든 진단서 서류·기간 조건 면제로 확대하지 않는다.',
      '희귀질환·중증난치질환·중증질환자의 산정특례 등록과 HIV 신규신청 최종진단 조건은 만성질환의 임상적 추정 인정과 구분한다. 인쇄53쪽의 HIV(B20~B24) 신규신청은 진단서 제출 대상이며 최종진단만 인정하고 임상적 추정진단은 인정하지 않는다.',
      '2026-04-01은 진단서 기준의 지자체 접수 적용일이다. PDF 작성·공표일, FAQ작성일2026-03-04, 추가 검수일을 이 적용일로 바꾸지 않는다. 이 보충 검수는 해당 진단서 조건에 한정되며 사업 전체 최신 규정이나 최종 선정결정을 인증하지 않는다.',
    ], derived_calculations: [], remaining_uncertainties: [],
    sources: [{ title: '2026년 차상위 본인부담경감대상자 지원사업 안내', publisher: '보건복지부 (복지로 공식 공개본)',
      url: 'https://www.bokjiro.go.kr/ssis-tbu/CmmFileUtil/getDownload.do?atcflId=20260325UUWBM1341280182121949&atcflSn=1', published_at: null,
      location: '인쇄53쪽 / PDF65쪽, 제출서류 만성질환자 및 진단서 인정기준 질의답변 박스·11개 고시질환 각주;2026-04-01 지자체 접수 건부터 적용' }],
  },
  '18021': {
    revision: 'official-clarifications-20261014-v16', reviewed_at: '2026-10-14', review_due_at: '2026-11-13',
    status: 'PARTIALLY_RESOLVED', original_content_sha256: '6232c4300f4af8db29e1ebfdda903a6aae02030fc34c4d9e8e25968cfcc31ae7',
    guidance: [
      '개인주택 마당 산분 가능 여부는 원문 FAQ의 장사시설 신고·허가 AND산분 장소 마련, 표지 없는 개인·가족 자연장지의 용도지역 및 관할 지자체 확인 조건을 함께 보존한다. 자연장지 일반 신고서류를 추가 설명해도 해당 마당의 조성·산분이 자동 허용된다고 단정하지 않는다.',
      '정부24의 개인 자연장지 조성신고는 조성 후30일 이내이고 가족 자연장지는 사전신고이다. 개인 자연장지의 변경신고에는 변경도면이 추가로 필요하며 가족 자연장지의 변경신고에는 변경계획과 변경도면이 추가로 필요하다. 변경서류를 신규 조성에 무조건 요구하거나 개인 변경도면을 생략하지 않는다.',
      '정부24는 개인·가족 자연장지의 토지(임야)대장, 토지등기부등본, 토지이용계획확인서, 지적도 또는 임야도를 담당공무원 확인서류로 안내한다. 다만 해당 페이지 가족 구분은 지적도 및 임야도로 표기되어 있으므로 개인·가족의 원문 표현을 구분하여 접수기관에 확인한다. 본인이 행정정보공동이용에 동의하지 않는 경우 이 확인서류를 민원인이 직접 제출해야 한다. 항상 불필요한 서류 또는 항상 직접제출 서류로 바꾸지 않는다.',
      '개인은 평면도 AND(위치도·약도 OR사진) AND(토지 소유 증명 OR타인 소유 토지인 경우 사용승낙서), 가족은 평면도 AND(위치도·약도 OR사진) AND조성자의 토지 소유 증명 AND가족관계증명서를 구분한다. 정부24의 일반 자연장지 신고절차를 산분만의 별도 신청서류나 모든 장사시설의 동일 기준으로 확대하지 않는다.',
      '정부24의 최근 내용 변경일·확인일2025-07-31은 최초 작성일이나 법령 시행일이 아니다. 보건복지부 장사제도 페이지의 최종수정일2026-06-30, FAQ작성일2026-05-29, 추가검수일2026-10-14도 각각 구분한다. 아래 안내는 직접 확인한 정부24 공개 본문의 범위이며 특정 토지의 적법성이나 모든 설치제한을 인증하지 않는다.',
    ], derived_calculations: [], remaining_uncertainties: ['정부24 가족 구분의 지적도 및 임야도와 개인 구분의 지적도 또는 임야도 표현 차이는 접수기관에 추가 확인한다.'],
    sources: [{
      title: '개인·가족·종중·문중자연장지 조성(변경) 신고', publisher: '정부24 (보건복지부 담당 민원)',
      url: 'https://www.gov.kr/mw/AA020InfoCappView.do?HighCtgCD=A09006&CappBizCD=13510000008', published_at: null,
      source_dates: { published_at: null, effective_at: null, posted_at: null, updated_at: '2025-07-31' },
      location: '개인·가족 제출서류 및 변경신고 도면; 담당공무원 확인서류·공동이용미동의 예외; 최근 내용 변경·확인일',
    }, {
      title: '장사제도', publisher: '보건복지부', url: 'https://www.mohw.go.kr/menu.es?mid=a10712020300', published_at: null,
      source_dates: { published_at: null, effective_at: null, posted_at: null, updated_at: '2026-06-30' },
      location: '자연장지 면적·행정절차 표 및 본문 최종수정일',
    }],
  },
  '18040': {
    revision: 'official-clarifications-20261014-v15', reviewed_at: '2026-10-14', review_due_at: '2026-11-13',
    status: 'RESOLVED', original_content_sha256: '35db12198245bdbf171b65174c84f1215f940bf2dc63161e3a109311f3633fb0',
    guidance: [
      '장기요양등급자의 진료 시 본인확인 예외는 원문 FAQ의 신분증 추가 제출 없이 수진자 조회 화면으로 확인한다는 범위로 안내한다. 등급 만료 후에도 예외가 유지되거나 모든 진료 관련 신원확인 절차가 면제된다고 확대하지 않는다.',
      '대한병원협회 articleNo=43057의 직접 본문 게시일과 article:published_time은2024-08-06이다. 검색 결과의2025-06-09를 이 글의 게시일로 단정하지 않는다. 본문2024-07-31 08:00은 예외대상 여부 표출 기능의 제공일시이고 관련 공문은2024-08-05이며, 서로 다른 날짜이다. FAQ작성일2026-06-02 및 추가검수일2026-10-14와도 구분한다.',
      '협회 안내의 심한 장애인 OR장기요양등급자 OR임산부 중 어느 하나에 해당하면 Y표시이며 세 조건을 모두 요구하지 않는다. 해당 사유는 민감정보여서 별도 구분하여 표시하지 않는다. 이 안내는 기존 공단 공문을 전달한 공개 자료이며 현재 예외대상 전체 목록이나 모든 신원확인 절차를 인증하는 것은 아니다.',
      '공식 공개 본문을 직접 읽지 못했다면 읽었다고 주장하지 않는다. 검색 요약과 아래 검수 발췌의 날짜가 다르면 확인한 자료 범위를 구분하며, 실제 후속 개정 근거가 있으면 그 원문과 날짜를 추가 확인한다.',
    ], derived_calculations: [], remaining_uncertainties: [],
    sources: [{
      title: '[보험 2024-331] 요양기관 본인확인 예외대상 여부 표출 안내', publisher: '대한병원협회 (국민건강보험공단 공문 전달)',
      url: 'https://www.kha.or.kr/kha_home/notice_list.do?mode=view&articleNo=43057', published_at: null,
      source_dates: { published_at: null, effective_at: null, posted_at: '2024-08-06', updated_at: null },
      location: '게시일2024-08-06 및 본문 기능제공일시2024-07-31 08:00; OR 예외대상 Y표출·민감정보 사유 비공개',
      verified_snapshot: { excerpt: '[보험 2024-331] 요양기관 본인확인 예외대상 여부 표출 안내. 게시일2024-08-06. 제공일시2024-07-31 08:00. 심한 장애인, 장기요양 등급자 또는 임산부 중 어느 하나에 해당하는 경우 본인확인 예외대상 항목에 Y표출. 예외 대상자 사유는 민감정보로 별도 구분하지 않음.', checked_at: '2026-10-14', source_snapshot_sha256: '2beb35580f191629d2136b318fc3a71b7cb81e00c61f316f7b491c0f50b9eb88', retrieval_method: 'direct_public_page_body', verification_scope: 'listed_excerpt_only' },
    }],
  },
  '15179': {
    revision: 'official-clarifications-20261014-v14', reviewed_at: '2026-10-14', review_due_at: '2026-11-13',
    status: 'RESOLVED', original_content_sha256: '584dca1a7d516d19aead02a19fe1b31f0ba3d9332c6054a7ddfcfb98c8dd93ca',
    guidance: [
      '일상돌봄의 세부 대상 요건을 추가 설명하는 경우 사회서비스전자바우처 대상기준 표의 대한민국 국적을 가진 자 조건도 함께 제시한다. 돌봄필요 청·중장년과 가족돌봄청년의 연령·돌봄 필요성·돌봄자 부재·가족돌봄 증빙을 구분하며, 가족돌봄청년 유형의 자녀 돌봄 제외를 보존한다.',
      '일상돌봄 신청은 본인이 원칙이다. 본인 신청이 어려워 공무원이 직권 신청할 때에는 신청자의 동의(신청서)를 받아 신청서를 대리 작성·신청해야 한다. 공무원 직권신청 가능이라는 사실을 동의 없이 신청 가능으로 요약하지 않는다.',
      '사회서비스전자바우처는 전화·우편·팩스 신청을 부득이한 사유로 직접 방문이 불가능한 경우로 안내한다. 같은 페이지에 우편·팩스 제출사실 확인 의무는 별도로 명시되어 있지 않으므로 긴급돌봄의 그 조건을 일상돌봄에 자동 복사하지 않는다. 친족·이해관계인 대리신청의 상세 서류는 개별 일상돌봄 접수기관에 확인한다.',
      '이 보강은 일상돌봄 서비스의 대상 및 신청조건에 한정된다. 긴급돌봄의 90일 바우처·추가72시간 규칙 또는 발달장애인 긴급돌봄 조건과 혼합하지 않는다. 지역별 연령 조정·제공 서비스와 예외 심의는 별도 확인하며 이 검수가 개인별 선정이나 FAQ 전체 현행 기준을 인증한 것은 아니다.',
      '보건복지부 본문 최종수정일은2026-06-30이고 전자바우처 본문에는2026년 사업안내가 연결되어 있다. 원문 FAQ작성일2026-06-16·웹수정일·추가검수일을 구분한다. 전자바우처의 작성일·수정일은 미확인이다.',
    ], derived_calculations: [], remaining_uncertainties: ['소득구간·가격표의 일부 오기 및 지역별 운영조건 전체는 이 추가 검수의 확정 범위가 아니다.'],
    sources: [
      { title: '일상돌봄 서비스 사업', publisher: '한국사회보장정보원 사회서비스 전자바우처', url: 'https://www.socialservice.or.kr:444/user/htmlEditor/view2.do?p_sn=82', published_at: null, location: '서비스 대상기준 국적 행 및 서비스 신청·이용 직권신청동의·전화우편팩스 단서;2026년 사업안내 연결' },
      { title: '일상돌봄 서비스 사업', publisher: '보건복지부', url: 'https://www.mohw.go.kr/menu.es?mid=a10709020900', published_at: null, source_dates: {published_at:null,effective_at:null,posted_at:null,updated_at:'2026-06-30'}, location: '신청권자·제출서류·동거/비동거 증빙 및 최종수정일' },
    ],
  },
  '14156': {
    revision: 'official-clarifications-20261014-v13', reviewed_at: '2026-10-14', review_due_at: '2026-11-13',
    status: 'RESOLVED', original_content_sha256: '6729882b5301e3412e3749cdea73e315d624a568c28d9feaccaeeb7d78b7370e',
    guidance: [
      '긴급돌봄의 서비스 정의에 신청방법을 추가하면 조건도 함께 안내한다. 본인 신청이 어려운 경우의 친족·법정대리인·이해관계인·담당 공무원 직권신청을 무조건 허용으로 일반화하지 않는다. 읍·면·동 공무원이 직권 신청하는 경우 신청자의 동의(신청서)를 받아 신청서를 대리 작성한다.',
      '전화·우편·팩스 신청은 부득이한 사유로 직접 방문이 불가능할 때의 예외이다. 우편·팩스 신청자는 읍·면·동에 제출 사실을 확인해야 한다. 보건복지부의 복지로 온라인 신청 안내는 친족에 한하며, 일반 방문·대리신청 자격과 온라인 신청 자격을 혼합하지 않는다.',
      '추가지원을 설명하면 필요시 긴급돌봄실무위원회의 결정, 기존 바우처를 먼저 사용, 추가지원 여부와 관계없이 최초 생성일부터90일이 되는 날24:00에 소멸 조건을 함께 제시한다. 추가지원일부터90일로 기한을 다시 계산하지 않는다. 동일 위기상황 종료 후 재지원은 불가하고 새로운 사유 발생 시 연간1회 재지원 가능 조건도 보존한다.',
      '이 보충은 일반 긴급돌봄 지원사업의 위 신청·추가지원 조건에 한정된다. 발달장애인 긴급돌봄의 입소서비스·신청경로·보호자 기준에 자동 적용하지 않는다. 서울·경기는 지역에 문의하라는 원문을 전국 미시행으로 해석하지 않고 지역 시행·단가·제공기관은 별도 확인한다.',
      '전자바우처 페이지 본문과 하단 첨부파일의2025년 지침명을 구분한다. 보건복지부 페이지의2026-10-06은 최종수정일이며 FAQ작성일2026-06-16 또는 보충 검수일2026-10-14를 원자료 게시일로 바꾸지 않는다. 아래 보충조건 확인을 전체 사업 현행기준 인증으로 확대하지 않는다.',
    ], derived_calculations: [], remaining_uncertainties: ['지역별 시행 여부·제공기관·본인부담률 및 전체 최신 지침은 별도 확인이 필요하다.'],
    sources: [
      { title: '긴급돌봄 지원사업', publisher: '한국사회보장정보원 사회서비스전자바우처', url: 'https://www.socialservice.or.kr:444/user/htmlEditor/view2.do?p_sn=83', published_at: null, location: '서비스 신청 및 이용의 우편·팩스 제출확인·직권신청 동의, 지원시간의 기존바우처 우선사용·최초생성90일 소멸' },
      { title: '긴급돌봄 지원사업', publisher: '보건복지부', url: 'https://www.mohw.go.kr/menu.es?mid=a10709020800', published_at: null, source_dates: { published_at: null, effective_at: null, posted_at: null, updated_at: '2026-10-06' }, location: '신청권자 본인신청 어려움 예외·복지로 친족 한정·방문불가 시 전화우편팩스; 페이지 하단 최종수정일' },
    ],
  },
  '18082': pancreasEntry('f07313040cd4603afce1f1f3ccf16df022b26fc2a7c25608234698e7bac73094'),
  '18083': pancreasEntry('1724cfc0474814d7a6f3bed4a58ce033cddb1a979bdc821d5c02890f8ad15ce1'),
  '18085': pancreasEntry('e5996e68f06de8cae120b37b854d8d3d20a738288ccd6c68a45aa624ea3f8674'),
  '15259': {
    ...sourceDateReview, status: 'RESOLVED', original_content_sha256: 'a82b65218f7a28d90b55a7543de69b180f680d67c18eb9355c2ae59b752b7e51',
    guidance: [
      '근로능력평가 신청서의 간소화 예외를 설명하면 유효한 장애인등록 심사이력 또는 영구고착 질환 평가이력과 신청인의 자료 재활용 희망·동의를 함께 안내한다. 앞쪽 의학적 평가 주석은 장애심사자료 또는 기존 영구고착 평가결과 활용을 희망하고 동의하는 경우를 각각 규정한다. 이력만 있으면 자동으로 모든 서류가 면제된다는 뜻이 아니다.',
      '공식 서식 앞쪽 개인정보 수집 및 활용 동의서는 평가 제출서류 간소화를 위한 것이다. 담당 공무원 확인사항은 간소화를 희망하는 대상의 동의서를 요구하고, 동의를 거부하면 신청인 본인이 직접 관련 서류를 제출하도록 명시한다. 신청서만 제출 가능하다는 뒤쪽 주석을 앞쪽 동의 조건과 분리하지 않는다.',
      '일반 제출서류인 신청서·근로능력평가용 진단서·최근2개월 진료기록을 보존한다. 국민연금공단 추가 안내의 진단서 발급일2개월 이내와 진료기록2개월분은 다른 기준이다. 정신신경계 누적치료3개월이 진단서 등에서 확인되지 않으면 추가자료, 복용약물이 있으면 처방·투약기록, 평가부위 수술 또는 최근1년 입원치료 이력이 있으면 입퇴원요약지를 확인한다. 서류 간소화·평가유예·근로능력 없음 판정을 같은 결정으로 취급하지 않는다.',
    ], derived_calculations: [], remaining_uncertainties: [],
    sources: [
      { title: '근로능력평가 신청서 별지 제1호 서식', publisher: '국가법령정보센터', url: 'https://www.law.go.kr/LSW/flDownload.do?flSeq=149443583', published_at: null, location: '앞쪽 의학적 평가 활용 희망·동의 주석 및 개인정보 활용 동의서·동의거부 안내·담당공무원 확인사항; 뒤쪽 제출서류 간소화 주석' },
      { title: '근로능력평가란?', publisher: '국민연금공단', url: 'https://www.nps.or.kr/comm/pop/getOHAH0015P0.do', published_at: null, location: '제출서류: 진단서 발급일·진료기록 기간 및 정신신경계·약물·수술/입원 이력 조건' },
    ],
  },
  '1515': {
    ...pensionDateEntry('cd68969af68e2ac19fbb3aa6e98068ebb0e0eace8495a4161574b93ddf3a342e', true),
    revision: 'official-clarifications-20261014-v21',
  },
  '1590': pensionDateEntry('3b9ec0e369dacdc48763780784d07859c905d406a07cdf5ab48f31a92a4f38c2'),
  '1601': pensionDateEntry('7e37f7bb87e8218aa6edba3048a0f0db190b9f135986120a97de1953e1fe8425'),
  '10235': pensionDateEntry('c8dc5d26b63df09b2041c6f503920c0ca41a59cfe4a8211ec0727830fa05e7fa'),
  '13958': pensionDateEntry('d855193b4867f9a19ff7ad91600a2c6da1a34b64ba3c24e120dd043a94a0bfb1', true),
  '16320': {
    ...sourceDateReview, status: 'RESOLVED', original_content_sha256: 'bdcaaaf8553bf0d61caa1666348b9c7ef526e479d7f81fb8f9bb1debe7fc3566',
    guidance: [
      '국민건강보험공단 재난적의료비 지원사업 리플릿의2026-07-01은 지원제외항목 변경의 진료건 적용일이다. 입원은 입원시작일이2026-07-01 이후인 건부터 적용한다고 원문에 명시되어 있다. 이 적용일을 리플릿 작성일·게시일로 기재하지 않는다.',
      '리플릿 본문에 게시일·작성일은 표시되지 않는다. URL의20260701 파일명과 HTTP Last-Modified는 자료 게시일의 근거가 아니므로 게시일은 미확인으로 표시한다. 본문의2026년도 보험료 기준표, 진료건 적용일, 129 FAQ 작성일, 추가 검수일은 서로 다른 날짜 유형이다.',
      '이 보충은 날짜 유형 확인에 한정된다. FAQ의 기준중위소득100% 이하 및100% 초과200% 이하 개별심사, 수급자·차상위 소득기준 미적용과 의료급여법상 예외를 보존하고 지원 자격 전체가 새로 검증된 것처럼 안내하지 않는다.',
    ], derived_calculations: [], remaining_uncertainties: [],
    sources: [{ title: '재난적의료비 지원사업 리플릿', publisher: '국민건강보험공단', url: 'https://www.nhis.or.kr/renewal_popup/poster/20260701_poster_longdesc_1.html', published_at: null, source_dates: { published_at: null, effective_at: '2026-07-01', posted_at: null, updated_at: null }, location: '지원제외항목 표·2026.7.1.진료건부터 적용 주석, 입원시작일 예외; 게시일 미표시' }],
  },
  '9715': {
    ...conditionReview, status: 'RESOLVED', original_content_sha256: 'fac18579b41ef14aa693f4c6631f7eca668d1204d21f203470955c05e556f36c',
    guidance: ambulanceRecordGuidance, derived_calculations: [], remaining_uncertainties: [], sources: ambulanceRecordSources,
  },
  '9718': {
    ...conditionReview, status: 'RESOLVED', original_content_sha256: 'aeec306e5b6831e482e6d87f4f4781cce7a72ae69b402cfecd2c85d2cf69bb65',
    guidance: ambulanceRecordGuidance, derived_calculations: [], remaining_uncertainties: [], sources: ambulanceRecordSources,
  },
  '1003': {
    ...conditionReview, status: 'RESOLVED', original_content_sha256: 'b253c093c2b5a0a8bca2af73751e33c5c595392bf52d97530886267305e36621',
    guidance: [
      '기저귀·조제분유 신청경로에 휴직자의 추가 소득·서류 설명을 붙이는 경우, 휴직기간1개월(30일) 미만과 이상을 구분한다. 소득 판정이 필요한 직장가입자의 휴직기간1개월 미만은 휴직 직전 월 건강보험료 본인부담금 부과액을 확인하여 판정한다. 모든 유급휴직자에게 최근월 급여명세서가 반드시 필요하다고 일반화하지 않는다.',
      '휴직기간1개월(30일) 이상은 무급휴직자의 휴직기간 소득을 없는 것으로 처리하고, 유급휴직자는 신청일 기준 최근월 급여액과 지침의 건강보험료 본인부담률로 판정한다. 휴직수당은 무급으로 처리한다. 최신 본인부담률을 임의로 추정하거나 해당 소득판정 규정을 모든 수급유형의 추가요건으로 확대하지 않는다.',
      '휴직 여부·기간을 확인할 수 있는 공문서로 휴직증명서를 대체할 수 있다. 휴직기간 중 재신청은 최초 제출 휴직증명서로 갈음할 수 있으나 유급휴직자의 신청일 기준 최근월 급여명세서 징구 각주를 함께 안내한다. 이는 재신청 각주이며 최초 신청의1개월 미만 판정과 혼합하지 않는다.',
    ], derived_calculations: [], remaining_uncertainties: [],
    sources: [{ title: '2026년 모자보건사업 안내 제Ⅶ장 저소득층 기저귀·조제분유 지원사업', publisher: '보건복지부 (사회서비스 전자바우처 공개본)', url: 'https://www.socialservice.or.kr:444/upload/etc/2026_GH01.pdf', published_at: null, location: '인쇄359쪽 / PDF17쪽 건강보험료 적용 유의사항⑤, 휴직기간 표 및 재신청 각주' }],
  },
  '9692': {
    ...conditionReview, status: 'RESOLVED', original_content_sha256: '918ec266f315308458816b29bab2ee33b877506943dce366d948da74a13cee6c',
    guidance: ambulanceGuidance, derived_calculations: [], remaining_uncertainties: [], sources: ambulanceSources,
  },
  '9710': {
    ...conditionReview, status: 'RESOLVED', original_content_sha256: '626505b28a2fd4f6b49c35cdb26165f9ed9ecef8fb485f93ecde582569bd210c',
    guidance: ambulanceGuidance, derived_calculations: [], remaining_uncertainties: [], sources: ambulanceSources,
  },
  '18363': {
    ...conditionReview, status: 'RESOLVED', original_content_sha256: 'c05f9cc80e8e98f3d5af539247bcab72eaa4698d01af2ca7fcc37917c214e5f8',
    guidance: [
      '퇴원환자 단기집중서비스의 확인 후7일 안내와 대상자 심의 전 긴급 서비스 제공을 구분한다. 통합돌봄 의뢰가 있다는 사실만으로 누구나 먼저 제공하고 사후승인하는 것은 아니다. 일반 대상자 선정은 통합돌봄체계의 신청·조사·지원계획·통합지원회의 절차를 따른다.',
      '2026년 사업안내 인쇄126쪽은 수행기관이 대상자 선정 절차를 생략하여 군변경·서비스 제공을 자체 처리하는 것은 불가하다고 명시한다. 긴급 돌봄이 필요한 경우에는 대상자 심의 전부터 제공하고 사후 대상자 심의를 진행할 수 있다.',
      '사후심의 예외는 즉시 미제공 시 이용자에게 중대하고 회복하기 어려운 신체적·정신적 건강악화가 예상되는 경우이다. 그 외 긴급 돌봄은 수행기관과 지자체가 협의하여 사전 제공할 수 있다. 긴급성 또는 필요한 지자체 협의 조건을 생략한 일반 사후승인으로 확대하지 않는다.',
      'FAQ의 대상자 요건 AND퇴원후14일 이내 주소지 신청, 확인절차후7일 제공,1개월 이내44시간 안내를 보존한다. 사업안내의 월44시간 이하와 실제 돌봄필요도·기관 제공여력에 따른 조정을 구분하며 모든 대상자에게44시간을 일률 보장하지 않는다.',
    ], derived_calculations: [], remaining_uncertainties: [],
    sources: [{ title: '2026년 노인맞춤돌봄서비스 사업안내', publisher: '보건복지부 (독거노인종합지원센터 공개본)', url: 'https://www.1661-2129.or.kr/download/2026%EB%85%84%20%EB%85%B8%EC%9D%B8%EB%A7%9E%EC%B6%A4%EB%8F%8C%EB%B4%84%EC%84%9C%EB%B9%84%EC%8A%A4%20%EC%82%AC%EC%97%85%EC%95%88%EB%82%B4.pdf', published_at: null, location: '인쇄126쪽 / PDF132쪽, 퇴원환자 대상자 선정·사후심의 조건; 인쇄6쪽 / PDF12쪽, 월44시간 이하와 제공량 조정' }],
  },
  '6850': {
  "revision": "official-clarifications-20261014-v7",
  "reviewed_at": "2026-10-14",
  "review_due_at": "2026-11-13",
  "status": "RESOLVED",
  "original_content_sha256": "6b041deb3d0e3b0a8c33150dd4be829a5bfc3f80f915c71aa09f65e9ba5422a9",
  "guidance": [
    "시술과 직접 관련된 원외처방 약제비는 의료기관 지급액과 개인 약제비의 합계가 정부지원금 상한을 넘지 않는 잔액 범위에서 지원한다. 원외약제비에 별도 추가 한도가 생기는 것이 아니다. 일부 본인부담금과 비급여(전액본인부담금 포함)를 구분하며 모든 약을 지원한다고 확대하지 않는다.",
    "2026년 보건복지부 지침에서 비급여 착상유도제·유산방지제는 의약품안전나라에서 주성분이 프로게스테론이고 황체기 결함·호르몬 이상·면역학적 요인 보조 용도로 확인된 약제이며, 각 약제용도당 최대 20만원도 전체 지원 상한 안에서 적용한다. 이 범위를 모든 급여 원외약에 일률적으로 적용하지 않는다.",
    "청구는 시술 완료 후 1개월 이내 관할 보건소 또는 e보건소 공공보건포털로 하는 것이 원칙이다. 1개월을 넘기면 청구서의 지연 사유 확인 AND 보건소장이 타당하다고 판단한 경우에만 6개월 범위 내 지연청구 가능하다. 누구나 6개월 이내 청구할 수 있는 것으로 안내하지 않는다.",
    "청구서(서식 8), 체외수정 또는 인공수정 시술확인서 1매, 원외약 처방전 및 약제비 영수증, 시술자 본인 계좌 통장 사본을 제출한다. 의료기관 청구액 확인 후 개인에게 지급하므로 즉시 지급이나 확정된 지급 날짜를 약속하지 않는다.",
    "종로구 보건소의 지역 집행 안내는 소염제·항생제 등을 제외하고 약품명이 있는 약제비 계산서·영수증을 요구하며 단순 카드전표는 인정하지 않는다. 이 조건을 추가 설명할 때 종로구 안내임을 명시하고 다른 지역의 개별 약제와 영수증 인정은 관할 보건소에 확인한다. 지역 안내만으로 전국 모든 약제를 판정하지 않는다."
  ],
  "derived_calculations": [],
  "remaining_uncertainties": [],
  "sources": [
    {
      "title": "2026년 모자보건사업 안내",
      "publisher": "보건복지부 (법제처 제공 사본)",
      "url": "https://www.easylaw.go.kr/CSP/FlDownload.laf?flSeq=1769406083842",
      "published_at": null,
      "location": "인쇄 141~144쪽 / PDF 171~174쪽, 원외약제비 청구·지연청구 각주 및 비급여 착상유도제·유산방지제 지원 범위"
    },
    {
      "title": "난임부부 시술비 지원",
      "publisher": "종로구 보건소",
      "url": "https://www.jongno.go.kr/Health.do?menuId=401277&menuNo=401277",
      "published_at": null,
      "source_dates": {
        "published_at": null,
        "effective_at": null,
        "posted_at": null,
        "updated_at": "2026-08-04"
      },
      "location": "원외(약국)약제비 지원: 소염제·항생제 제외 및 약품명 있는 영수증(단순 카드전표 불가); 종로구 집행 안내"
    }
  ]
},
  '2889': {
    revision: 'official-clarifications-20261014-v6', reviewed_at: '2026-10-14', review_due_at: '2026-11-13',
    status: 'RESOLVED', original_content_sha256: '213d3ae7867aa9b415735e7b95cfcbeec56f0fbb6bb949138286d400db6222d2',
    guidance: [
      '2026년 모자보건사업 안내의 기저귀 지원대상 각주는 장애인·다자녀(2인 이상) 가구의 기준중위소득 요건을 2026년 7월부터 80%에서 100%로 완화한다고 명시한다. 2026-09-22 작성 129 FAQ의 100% 이하와 일치한다. 웹 소개에 남은 80%나 연초 기준표를 7월 이후의 기준으로 적용하지 않는다. 7월 전 기간을 묻는 질문에 100%를 소급 적용하지 않는다.',
      '만 2세 미만 영아 AND 다음 가구 유형 중 하나(OR)가 대상이며 영아별로 지원한다. 기초생활보장·차상위계층·한부모가족 수급 가구에는 별도 100% 요건을 추가하지 않는다. 장애인 가구는 기준중위소득 100% 이하 AND 부 또는 모 또는 영아가 일반장애인으로 등록된 경우이며, 다자녀 가구는 100% 이하 AND 자녀 2인 이상이다. 가구의 모든 자녀가 만 2세 미만이어야 한다는 뜻이 아니다.',
      '추가 금액·기간·신청서류를 안내하려면 해당 공식 지침의 관련 절을 읽고 조건부 서류 및 행정정보 공동이용에 따른 생략을 구분한다. 닫히거나 이전된 지역 웹주소의 검색 요약만으로 최신 서류·게시일·수정일을 확인했다고 표현하지 않는다. 이 확인은 지원대상과 소득기준 변경 각주에 한정하며 지침 전체의 현행성을 인증하지 않는다.',
    ], derived_calculations: [], remaining_uncertainties: [],
    sources: [{ title: '2026년 모자보건사업 안내 제Ⅶ장 저소득층 기저귀·조제분유 지원사업', publisher: '보건복지부 (한국사회보장정보원 사회서비스 전자바우처 공개본)', url: 'https://www.socialservice.or.kr:444/upload/etc/2026_GH01.pdf', published_at: null, location: '인쇄 344·347~348·356~357쪽 / PDF 2·5~6·14~15쪽, 지원대상과 2026년 7월 소득기준 변경 각주; 추가 서류는 인쇄 352쪽 / PDF 10쪽 별도 확인' }],
  },
  '15081': pensionProxyEntry('3c7256c0461ab95ae79acaf3489175cfed75f24841e96108c114b74959914ee3'),
  '10557': pensionProxyEntry('18df46763344a37bb5768e51964c97ba0daabfd2fde4f3a5a9a02b9aff7fb3af'),
  '11394': pensionProxyEntry('850d3e4ca4adf5fb88a21e235d2298127b097bf6e60bf540f785e7935df193cc'),
  '18624': pensionProxyEntry('7e45af966261bb678908b59d1be672f8017663c059545f184b112019d69302da'),
  '1518': pensionProxyEntry('d65e04391b3eb054dba6510552d0cb23f7dcffb89627b095d56934caa4469beb'),
  '1520': pensionProxyEntry('5761b2d5e67e561cec05dd0320aba1faf6b821a2f74acee3b48e56ee33b54c96', true),
  '1579': pensionProxyEntry('de2cda7e96c9815865045452910503ec3ed685b2aca5311a5d8339a8ef7c2e06'),
  '13959': {
    ...pensionReview, status: 'RESOLVED', original_content_sha256: '456bd30552291b75c096699e80f3e0b01d4c429671237d4a99e04771552d73f3',
    guidance: pensionExclusionGuidance, derived_calculations: [], remaining_uncertainties: [],
    sources: [{ ...pensionSource, location: '인쇄 43쪽 / PDF 61쪽, 직역연금 제외 예외·특례 및 퇴직유족일시금 각주' }],
  },
  '15099': {
    ...pensionReview, status: 'PARTIALLY_RESOLVED', original_content_sha256: '34252cbfde664283a95e767180f8925e67fd52bdc08fd8fe40633f08cadded1b',
    guidance: [
      '2026년 지침의 신청자격 표(인쇄 19쪽)는 대한민국 국민과 혼인신고 후 국내 체류기간 2년 미경과인 외국국적 배우자를 신청 가능으로 표시한다. 129 FAQ의 예외와 일치하므로 일반적인 대한민국 국적 원칙만 인용해 이 예외를 뒤집지 않는다. 혼인신고·대한민국 국민의 배우자·체류기간 조건을 모두 확인한다.',
      '같은 표는 대한민국 국민과 혼인하지 않은 외국국적자의 충족요건을 대한민국 귀화로, 혼인신고 후 국내 체류 2년이 경과한 경우의 충족요건을 대한민국 귀화 또는 귀화허가 신청 중으로 구분한다. 신청 가능 표시는 최종 수급·자동 지급 보장이 아니다.',
      '가구유형 확정 표(인쇄 108쪽)의 고유식별번호, 혼인신고 후 국내 체류기간, 국적취득 신청 여부는 별도 조사 조건이다. 배우자의 소득·재산 조사 포함과 외국국적 배우자 본인의 신청자격을 혼합하지 않는다.',
    ], derived_calculations: [],
    remaining_uncertainties: ['신청자격 표는 2년 미경과, 가구유형 표는 2년 이하라는 문구를 사용한다. 정확히 2년인 경계 및 2년 경과 후 1개월 내 국적취득 신청 조건의 개별 적용을 추정으로 확정하지 말고 담당기관에 확인한다.'],
    sources: [{ ...pensionSource, location: '인쇄 19쪽 / PDF 37쪽, 신청자격 여부 확인 표; 인쇄 108쪽 / PDF 126쪽, 수급가구 유형 확정' }],
  },
  '12023': {
    status: 'PARTIALLY_RESOLVED', original_content_sha256: '811989225a6faf22c74d02d84f82b43263b63194019a2e55e7b745aaf4c0f25c',
    guidance: [
      '사회서비스 전자바우처 사업 소개도 최대 24개월 지원 및 3개월 주기 생성을 명시한다. 이 페이지는 지급 주기를 보충 확인하는 근거이며, 지원기간별 지급표의 병합 셀을 확정 복원하는 근거로 사용하지 않는다.',
      '공식 지침의 명문 지급규칙은 지원대상 결정 통보일 익일부터 3개월 단위 지급이다. 지원기간이 4개월 이상이면 첫 3개월분을 지급하고 3개월 후 다음 3개월분을 지급한다. 지원기간 1~2개월은 월 지원액에 해당 개월 수를 곱하여 지급한다.',
      '광주시 공식 신청일별 지원기간 표는 출생일부터 60일 이내 신청 시 24개월, 61일째부터 출생일 기준 3개월째 되는 날의 전날까지 신청 시 22개월로 안내한다. 23개월 항목을 누락으로 단정하거나 임의로 만들어서는 안 된다.',
      '지급시기는 1회차 결정 통보일 익일, 이후 1회차 지급 후 4·7·10·13·16·19·22개월째 날 중 지원기간 안에 해당하는 회차이다. 지원기간별 회차를 설명할 때 아래 계산임을 명시하고 표의 병합 셀을 확정 복원했다고 표현하지 않는다.',
    ],
    derived_calculations: ['3개월 단위 규칙 적용 계산: 24개월·22개월=8회, 21~19개월=7회, 18~16개월=6회, 15~13개월=5회, 12~10개월=4회, 9~7개월=3회, 6~4개월=2회, 3~1개월=1회. 마지막 회차는 잔여기간 범위의 금액이며 모든 회차가 3개월분이라는 뜻이 아니다.'],
    remaining_uncertainties: ['129 원문 및 2026 지침 표의 21개월 행과 8회차 병합 셀 경계는 불명확하다. 회차 계산은 명문 지급규칙에서 도출한 것이며 표 자체의 공식 정정이 아니다.'],
    sources: [
      { title: '기저귀/조제분유지원사업', publisher: '한국사회보장정보원 사회서비스 전자바우처', url: 'https://www.socialservice.or.kr:444/user/htmlEditor/view2.do?p_sn=39', published_at: null, location: '지원 기간: 최대 24개월 및 3개월 주기 생성' },
      { ...maternalSource, location: '인쇄 367쪽 / PDF 397쪽, 지원기간에 따른 바우처 지급 시기 및 지급규칙' },
      { title: '저소득층 기저귀·조제분유 지원', publisher: '광주시', url: 'https://www.gjcity.go.kr/depart/contents.do?mId=0805070700', published_at: null, location: '신청일별 지원기간 표, 60일 이내 및 61일~3개월 구간' },
    ],
  },
  '921': {
    status: 'PARTIALLY_RESOLVED', original_content_sha256: 'a0c45ec905eb2bc7663a43d6f04ccec80fc83f314b45111f113d4fd67e03bba6',
    guidance: [
      '2026 모자보건사업 안내는 카드 수령일부터 사용 가능하며, 기존 국민행복카드 소지자는 서비스 신청 승인 익일부터 사용 가능하다고 명시한다.',
      '사용 종료 기준은 분만예정일(유산진단일 또는 출산 이후 서비스 신청 시 출산일) 이후 2년이며, 기간 내 미사용 지원금은 소멸한다.',
      '129 FAQ의 분만예정일 2026-05-01, 사용종료 2026-04-30 예시는 2년 규칙과 모순되므로 종료일 안내에 재사용하지 않는다. 공식 기준일 이후 2년이라는 규칙을 안내하고 실제 카드 종료일을 확인한다.',
    ], derived_calculations: [],
    remaining_uncertainties: ['확인한 공식 지침에는 이 사례의 정확한 종료일 및 말일 포함 여부 예시가 없다. 2028년 특정 날짜를 공식 확인된 날짜처럼 단정하지 않는다.'],
    sources: [
      { ...maternalSource, location: '인쇄 254쪽 / PDF 284쪽, 청소년산모 임신·출산 의료비 지원 사용기간' },
      { title: '청소년산모임신출산의료비 지원사업', publisher: '한국사회보장정보원 사회서비스 전자바우처', url: 'https://www.socialservice.or.kr:444/user/htmlEditor/view2.do?p_sn=24', published_at: null, location: '사용 기간 및 미사용 지원금 소멸; 분만예정일 이후 2년' },
    ],
  },
  '12339': {
    status: 'PARTIALLY_RESOLVED', original_content_sha256: '0858db2a8e066b354be155fc9ccd0528ae97c2bf7ffceca6804320142e27d2de',
    guidance: [
      '현행 장사 등에 관한 법률 시행규칙 제20조의5제2항제1호는 해외체류·휴업 또는 폐업·군복무 등으로 해당 연도에 6개월 이상 관련 업무에 종사하지 않은 사람에 대해 해당 연도 교육을 면제할 수 있도록 정한다. 자동 면제로 단정하지 않는다.',
      '129 FAQ 및 2025 장사업무안내의 12월 31일 기준 근로 6개월 미만 주석은 법령의 미종사 6개월 이상 표현과 경계가 다르다. 정확히 6개월 근무한 사례를 자동 면제 또는 교육 의무라고 확정하지 않고 관할 교육담당에게 적용을 확인하도록 안내한다.',
      '2026-04-03 시행 제20조의5제2항제2호는 본인의 질병, 임신·출산으로 교육이 어려운 사람 중 보건복지부장관이 인정한 사람을 명시한다. 이는 2026-02-25 작성 FAQ 이후의 현행 법령 확인이며 원문 작성일과 구분한다.',
      '제2항제3호는 장례지도사 교육기관·대학·전문대학·대학원 재학생을 규정한다. FAQ의 식당·매점·미화·주차 전담자 안내는 이 조문에 열거된 법정 면제 사유로 혼합하지 않고 별도 지침 및 관할 교육담당에게 적용을 확인한다.',
    ], derived_calculations: [],
    remaining_uncertainties: ['정확히 6개월 근로한 경계 사례의 행정 적용은 확인한 공식 자료만으로 확정되지 않았다.'],
    sources: [
      { title: '장사 등에 관한 법률 시행규칙 제20조의5', publisher: '국가법령정보센터', url: 'https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=1014367307', published_at: null, source_dates: { published_at: '2026-04-03', effective_at: '2026-04-03', posted_at: null, updated_at: null }, location: '제20조의5제2항제1호~제3호; 사용자 제공 lsId=007132 법령의 조문 직접 링크' },
      { title: '장사 등에 관한 법률 시행규칙', publisher: '국가법령정보센터', url: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=285427', published_at: '2026-04-03', location: '제20조의5제2항제1호~제3호, 보건복지부령 제1170호' },
      { title: '2025 장사업무안내', publisher: '보건복지부 (한국장례문화진흥원 제공)', url: 'https://www.kfcpi.or.kr/link/2025/10/01/de065eab-8172-44fa-a366-af15855e56ab.pdf', published_at: null, location: '제3장 교육 대상자 / 당해 연도 교육 면제자, 검색 색인 확인(쪽수 미확정)' },
    ],
  },
  '16860': {
    status: 'RESOLVED', original_content_sha256: '2e5b63942a75eaf82ab63cd65405cf78ef8919f4896f899ca2b0e8b083641a67',
    guidance: [
      '외래 대상 범위는 부산광역시 공식 안내 지원내용 ③에서 만 18세 미만 외국인근로자 자녀, 국적취득 전 여성결혼이민자 자녀, 난민자녀로 각각 명시한다. 세 유형 모두 자녀이며 결혼이민자 본인에게 일반 외래를 전면 지원한다는 뜻으로 확대하지 않는다.',
      '외국인근로자의 외국인 배우자에 대한 임신 관련 산전진찰·출산 지원은 별도 항목이다. 부산시 자료는 외래 대상 문구의 보충 확인에만 사용하며 지역별 금액·조건을 전국 기준으로 전파하지 않는다.',
      '건강보험심사평가원 지원원칙은 기존 의료보장제도의 지원을 받지 못하는 대상자의 입원·수술 등을 지원하며, 일반 외래는 원칙적으로 제외하되 산전진찰 및 만 18세 미만 자녀의 외래를 예외로 안내한다. 입원·수술 연계 외래는 사전 1회와 사후 2회로 제한한다. 모든 외국인의 모든 외래진료로 확대하지 않는다.',
    ], derived_calculations: [], remaining_uncertainties: [],
    sources: [
      { title: '외국인 근로자 의료서비스', publisher: '부산광역시', url: 'https://www.busan.go.kr/depart/ahmedical', published_at: '2026-06-18', location: '지원내용 ③·④, 페이지 최근 업데이트일' },
      { title: '외국인 근로자 등 의료지원 사업', publisher: '건강보험심사평가원', url: 'https://www.hira.or.kr/dummy.do?pgmid=HIRAA020020000003', published_at: null, location: '지원대상자, 진료비 심사·지급절차 / 지원원칙; 일반 외래 제외와 예외 및 연계 외래 횟수' },
    ],
  },
  '14234': {
    status: 'RESOLVED', original_content_sha256: '24c839c044dd72dcf961d6400a9459838c99c82c184785b21f9b018d40ec836b',
    guidance: [
      '내국인 혼인 증빙 추가 조건은 15~19세 부부 대상자이면서 신청자의 주민등록등본상 혼인관계가 확인되지 않는 경우이다. 두 조건의 AND이며, 모든 20~49세 미혼 내국인에게 혼인 증빙을 요구하는 조건으로 해석하지 않는다.',
      '혼인 증빙은 혼인관계증명서, 청첩장, 예식장 영수증 또는 사실혼 확인보증서 등 해당 관계의 증빙이다. 기본 신청서·동의서·등본 및 온라인 신청 조건, 외국인 별도 구비서류는 원문과 지침을 구분하여 함께 안내한다.',
      '보건복지부 신청서류 표는 내국인 온라인 신청의 서류 제출 생략과 외국인 온라인 신청을 구분한다. 외국인은 온라인 신청 시 내국인 배우자 주민등록등본과 혼인 증빙서류를 첨부한다. 방문 신청의 신청서·동의서·외국인등록 또는 국내거소신고 증명, 내국인 배우자 등본 및 혼인관계 미확인 시 증빙 조건도 함께 안내한다. 신청 서류와 검사 후 청구 서류를 혼합하지 않는다.',
    ], derived_calculations: [], remaining_uncertainties: [],
    sources: [
      { title: '임신·출산 지원 / 임신 사전건강관리', publisher: '보건복지부', url: 'https://www.mohw.go.kr/menu.es?mid=a10711020100', published_at: null, source_dates: { published_at: null, effective_at: null, posted_at: null, updated_at: '2025-03-21' }, location: '임신 사전건강관리 / 신청서류 표: 내국인·외국인 및 온라인 신청 주석; 페이지 하단 최종수정일' },
      { ...maternalSource, location: '인쇄 45~46쪽 / PDF 75~76쪽, 임신 사전건강관리 지원 구비서류' },
      { title: '임신 사전건강관리 지원사업 신청 민원편람', publisher: '인천광역시 부평구', url: 'https://www.icbp.go.kr/petition/petitionDetail.do?peti_seq=1421&pgno=3', published_at: null, location: '구비서류, 15~19세 부부 대상자 혼인 증명 조건' },
    ],
  },
  '15339': {
    status: 'PARTIALLY_RESOLVED', original_content_sha256: '3ab85351d12a2bb3352f641b8ec26230bbb027ba09bb39bbaf21801a70fdf579',
    guidance: [
      '공동생활가정 입주자는 필요 시 장애인 주간이용시설을 이용할 수 있다. 2026 장애인복지시설 사업안내 인쇄 195쪽의 질병 등 특별한 사유 단서는 공동생활가정 이용자의 생활 중 낮 시간에 복지관·직장·학교 등 지역사회 활동에 참여하는 원칙 다음에 놓여 있다.',
      '따라서 질병 등 특별사유는 낮 시간 활동 원칙 적용의 예외 가능성이라는 문맥으로 설명한다. 질병이 있으면 주간이용시설 이용대상에서 일률적으로 제외된다는 조건을 추가하지 않는다. 인쇄 311쪽의 별도 주간이용시설 이용자 선정·계약 조항에도 그런 일률 제외 규정은 없다.',
      '개별 공동생활가정 입주자의 주간이용시설 이용 가능 여부는 해당 지자체 장애인복지 소관부서와 시설에 문의하도록 안내한다. 전국 공통 원칙만으로 개별 입소 승인·거절을 확정하지 않는다.',
    ], derived_calculations: [],
    remaining_uncertainties: ['특별사유 단서의 적용 범위에 대한 명시적 유권해석을 확보한 것은 아니다. 개별 이용 결정은 시설 및 관할 담당자에게 확인한다.'],
    sources: [{ ...disabilitySource, location: '인쇄 195쪽 / PDF 203쪽, 공동생활가정 이용자의 생활; 인쇄 311쪽 / PDF 319쪽, 주간이용시설 이용자 선정 및 계약' }],
  },
  '8131': {
    status: 'PARTIALLY_RESOLVED', original_content_sha256: 'c8b0871a1f6f133272e28a90111c6d3f82af924194ab15a7aee4e7b56f66ecf5',
    reviewed_at: '2026-10-13', review_due_at: '2026-11-12',
    guidance: [
      '129 원문의 묵시적 갱신 1개월 안내를 현재 계약 전체에 적용하지 않는다. 법제처의 2026-09-15 기준 안내는 2020-12-10 이후 최초 체결 또는 갱신한 임대차에는 종료 2개월 전 기준을 구분한다. 계약 체결·갱신 시점을 확인하고 원문의 작성일과 보충 근거를 함께 제시한다.',
      '기존 계약의 담당공무원 유선 확인에 관한 129 원문의 요건은 별도로 보존한다. 소유권 변동 없음, 계약기간 중 주민등록 주소 변동 없음 또는 임차권 등기, 담당공무원의 임대인 유선 확인이라는 적용 범위를 생략하지 않는다.',
    ], derived_calculations: [],
    remaining_uncertainties: ['묵시적 갱신의 법률상 기간 확인은 해당 복지사업의 계약서 인정 절차 전체를 검증한 것이 아니다. 개별 계약의 적용 시점과 증빙 인정은 담당기관에 확인한다.'],
    sources: [{ title: '주택임대차계약의 갱신', publisher: '법제처 찾기쉬운 생활법령정보', url: 'https://easylaw.go.kr/CSP/CnpClsMain.laf?ccfNo=4&cciNo=4&cnpClsNo=1&csmSeq=629&menuType=onhunqna&popMenu=ov', published_at: null, location: '묵시적 갱신의 요건 및 2020-12-10 이후 체결·갱신 계약 적용례; 2026-09-15 기준 안내' }],
  },
  '14303': {
    status: 'PARTIALLY_RESOLVED', original_content_sha256: '5e820576a72797e578ea5625d15ccad4c2f26919b501bb8bd0a757a6d585b4aa',
    reviewed_at: '2026-10-13', review_due_at: '2026-11-12',
    guidance: [
      '129 원문의 400만원 구간에 사용된 쉼표를 두 조건의 AND로 해석하지 않는다. 구리시보건소의 2026-09-21 수정 공식 표는 2.0kg 이상~2.5kg 미만 또는 재태기간 37주 미만을 400만원 구간으로 안내한다. 미숙아 정의도 임신 37주 미만 또는 출생체중 2500g 미만으로 구분한다.',
      '금액 구간만으로 지원 자격을 확정하지 않는다. 출생 후 24시간 이내 NICU 입원, 지원되는 진료비 항목과 제외 항목, 체중별 상한을 함께 확인한다. 낮은 체중 구간의 더 높은 상한을 400만원으로 일괄 제한하지 않는다.',
      '보건복지부 공식 표에서도 체중 구간별 상한 400·500·1,000·2,000만원을 확인했다. 지원대상 금액의 100만원까지는 전액, 초과분은 90%를 적용한 뒤 해당 상한을 적용한다. 선천성이상아의 별도 상한 700만원을 미숙아 체중 구간에 혼합하지 않는다.',
    ], derived_calculations: [],
    remaining_uncertainties: ['추가 확인은 구리시보건소가 공개한 표의 접속어와 지원 범위이다. 개별 사례 및 다른 지역의 집행 기준 전체를 검증한 것은 아니다.'],
    sources: [
      { title: '미숙아 및 선천성 이상아 의료비 지원사업', publisher: '구리시보건소', url: 'https://guri.go.kr/health/contents.do?key=7897', published_at: null, source_dates: { published_at: null, effective_at: null, posted_at: null, updated_at: '2026-09-21' }, location: '미숙아 정의, 지원대상, 1인당 지원한도 표' },
      { title: '모자보건지원 / 미숙아 및 선천성이상아 의료비 지원', publisher: '보건복지부', url: 'https://www.mohw.go.kr/menu.es?mid=a10711020200', published_at: null, source_dates: { published_at: null, effective_at: null, posted_at: null, updated_at: '2026-01-05' }, location: '지원대상·지원내용·지원금액 산정방법·지원한도 표; 페이지 하단 최종수정일' },
    ],
  },
  '14003': {
    status: 'PARTIALLY_RESOLVED', original_content_sha256: '091e65c12ee8331d006aafaa10492bb6bd7c04dae3aaebf0436e0341b401b1e7',
    reviewed_at: '2026-10-13', review_due_at: '2026-11-12',
    guidance: [
      '요양보호사 결격사유의 형 집행 종료·면제에 대한 부정을 각 분기로 나누어 종료된 사람까지 결격사유에 포함하지 않는다. 법제처 안내의 집행 종료 또는 면제와 부정의 적용 범위를 원문 그대로 읽는다.',
      '129 원문의 금고 이상의 형과 법제처 안내의 금고 이상의 실형을 구분한다. 집행유예는 별도 결격 항목이므로 실형 항목과 혼합하지 않는다. 다른 결격사유와 전문의 인정 예외도 각각 확인한다.',
      '국가법령정보센터의 노인복지법 제39조의13은 정신질환자의 전문의 적합 인정 예외, 약물 중독, 피성년후견, 실형의 집행 미종료·미면제, 집행유예 기간, 법원 판결에 의한 자격 정지·상실, 자격취소 후 1년 미경과를 각각 규정한다. 제6호의 1년 제한은 피성년후견에 해당하여 자격이 취소된 경우를 제외한다. 이 예외를 생략하지 않는다.',
    ], derived_calculations: [],
    remaining_uncertainties: ['추가 확인은 형 집행 문구와 실형·집행유예의 구분에 한정된다. 개별 범죄 경력에 대한 자격 발급 여부나 FAQ 전체의 현행 기준은 별도 확인이 필요하다.'],
    sources: [
      { title: '요양보호사 결격사유', publisher: '법제처 찾기쉬운 생활법령정보', url: 'https://www.easylaw.go.kr/CSP/CnpClsMain.laf?ccfNo=1&cciNo=1&cnpClsNo=1&csmSeq=2044&menuType=onhunqna&popMenu=ov', published_at: null, location: '노인복지법 제39조의13에 따른 결격사유 표; 조회한 본문의 기준일 2026-04-15' },
      { title: '노인복지법 제39조의13(요양보호사의 결격사유)', publisher: '국가법령정보센터', url: 'https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031828345', published_at: null, source_dates: { published_at: '2026-09-29', effective_at: '2026-10-02', posted_at: null, updated_at: null }, location: '제39조의13제1호~제6호, 법률 제22020호; 전문의 인정 및 제6호 피성년후견 자격취소 예외' },
    ],
  },
};

export function faq129Clarification(faqId: string, contentSha256: string): Faq129Clarification | null {
  const entry = reviewed[faqId];
  if (!entry || entry.original_content_sha256 !== contentSha256) return null;
  return {
    ...entry, revision: entry.revision ?? 'official-clarifications-20261013-v4', reviewed_at: entry.reviewed_at ?? '2026-10-13', review_due_at: entry.review_due_at ?? '2026-11-12', verification_scope: 'listed_guidance_only',
    sources: entry.sources.map((source) => {
      const effective = source.publisher === '국가법령정보센터';
      const updated = source.url === 'https://www.busan.go.kr/depart/ahmedical';
      const posted = source.url === disabilitySource.url;
      return { ...source, published_at: null, source_dates: source.source_dates ?? { published_at: null, effective_at: effective ? source.published_at : null, updated_at: updated ? source.published_at : null, posted_at: posted ? source.published_at : null } };
    }),
  };
}

export function faq129ClarificationCatalog(): readonly { readonly faq_id: string; readonly clarification: Faq129Clarification }[] {
  return Object.entries(reviewed).flatMap(([faq_id, entry]) => {
    const clarification = faq129Clarification(faq_id, entry.original_content_sha256);
    return clarification ? [{ faq_id, clarification }] : [];
  });
}

export function faq129ClarificationText(value: Faq129Clarification | null): string[] {
  if (!value) return [];
  return [
    '공식 추가 확인 (' + value.reviewed_at + ', ' + value.status + '): 원문 작성일의 답변과 별도로 읽고, 충돌하는 예시는 아래 근거에 따라 구분하세요.',
    ...value.guidance,
    ...value.derived_calculations.map((text) => '계산에 의한 보충: ' + text),
    ...value.remaining_uncertainties.map((text) => '남은 확인사항: ' + text),
    '재확인 예정: ' + value.review_due_at + '. 추가 확인 범위는 위 안내에 한정되며 FAQ 전체의 현행 기준 검증을 뜻하지 않습니다.',
    ...value.sources.map((source) => '보충 출처: ' + source.publisher + ' / ' + source.title + ' / ' + source.location + ' / 발행일: ' + (source.source_dates?.published_at ?? '미확인') + ' / 시행일: ' + (source.source_dates?.effective_at ?? '미확인') + ' / 게시일: ' + (source.source_dates?.posted_at ?? '미확인') + ' / 수정일: ' + (source.source_dates?.updated_at ?? '미확인') + ' / ' + source.url),
    ...value.sources.flatMap((source) => source.verified_snapshot ? ['VERIFIED_OFFICIAL_SOURCE_SNAPSHOT: ' + JSON.stringify({ url: source.url, snapshot: source.verified_snapshot })] : []),
  ];
}
