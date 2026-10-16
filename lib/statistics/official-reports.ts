import type { StatisticsDataset } from "./types.ts";

export const OFFICIAL_REPORT_DATASETS: readonly StatisticsDataset[] = [
  {
    "id": "report:lonely-death",
    "indicator_code": "",
    "table_code": "official-report:lonely-death",
    "category": "사회보장",
    "title": "고독사 발생 현황",
    "description": "경찰청 형사사법정보를 분석한 고독사 발생 실태조사. 법령 정의·조사 방식 변경에 유의하세요.",
    "note": "공식 발표 자료의 대표 수치를 연결한 확인본입니다. 조사 실시 연도를 기준으로 표시하며 자동 API 갱신 대상이 아닙니다.",
    "highlight_series_id": "deaths",
    "original_unit": "명, 인구 10만 명당 명",
    "table_title": "고독사 사망자 수 · 인구 10만 명당 고독사 사망자 수",
    "source_url": "https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&list_no=1488039&act=view",
    "indicator_url": "https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&list_no=1488039&act=view",
    "source_name": "보건복지부",
    "source_notes": "경찰청 형사사법정보를 분석한 고독사 발생 실태조사. 법령 정의·조사 방식 변경에 유의하세요.",
    "periods": [
      "2020",
      "2021",
      "2022",
      "2023",
      "2024"
    ],
    "series": [
      {
        "id": "deaths",
        "label": "고독사 사망자 수",
        "source_label": "고독사 사망자 수",
        "unit": "명",
        "points": [
          {
            "period": "2020",
            "value": 3279,
            "raw": "3279",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 3378,
            "raw": "3378",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 3559,
            "raw": "3559",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 3661,
            "raw": "3661",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 3924,
            "raw": "3924",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "rate",
        "label": "인구 10만 명당 고독사 사망자 수",
        "source_label": "인구 10만 명당 고독사 사망자 수",
        "unit": "인구 10만 명당 명",
        "points": [
          {
            "period": "2020",
            "value": 6.4,
            "raw": "6.4",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 6.6,
            "raw": "6.6",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 6.9,
            "raw": "6.9",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 7.2,
            "raw": "7.2",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 7.7,
            "raw": "7.7",
            "status": "VALUE"
          }
        ]
      }
    ],
    "official_report": {
      "checked_at": "2026-10-11T12:27:39.525Z",
      "published_at": "2025-11-27",
      "scope": "경찰청 형사사법정보를 분석한 고독사 발생 실태조사. 법령 정의·조사 방식 변경에 유의하세요."
    }
  },
  {
    "id": "report:korean-medicine",
    "indicator_code": "",
    "table_code": "official-report:korean-medicine",
    "category": "보건·의료",
    "title": "한방의료이용및한약소비실태조사",
    "description": "전국 19세 이상 성인 일반국민의 한방의료 이용 경험·만족도 대표 항목입니다. 한약 소비량 전체 표와는 다릅니다.",
    "note": "공식 발표 자료의 대표 수치를 연결한 확인본입니다. 조사 실시 연도를 기준으로 표시하며 자동 API 갱신 대상이 아닙니다.",
    "highlight_series_id": "experience",
    "original_unit": "%",
    "table_title": "한방의료 이용 경험률 · 한방의료 이용 만족도 (일반국민)",
    "source_url": "https://nikom.or.kr/koms/board/view.do?board_idx=565847&manage_idx=141&menu_idx=24",
    "indicator_url": "https://nikom.or.kr/koms/board/view.do?board_idx=565847&manage_idx=141&menu_idx=24",
    "source_name": "한국한의약진흥원 · 보건복지부",
    "source_notes": "전국 19세 이상 성인 일반국민의 한방의료 이용 경험·만족도 대표 항목입니다. 한약 소비량 전체 표와는 다릅니다.",
    "periods": [
      "2020",
      "2022",
      "2024"
    ],
    "series": [
      {
        "id": "experience",
        "label": "한방의료 이용 경험률",
        "source_label": "한방의료 이용 경험률",
        "unit": "%",
        "points": [
          {
            "period": "2020",
            "value": null,
            "raw": "",
            "status": "MISSING"
          },
          {
            "period": "2022",
            "value": 71,
            "raw": "71",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 67.3,
            "raw": "67.3",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "satisfaction",
        "label": "한방의료 이용 만족도 (일반국민)",
        "source_label": "한방의료 이용 만족도 (일반국민)",
        "unit": "%",
        "points": [
          {
            "period": "2020",
            "value": 74.5,
            "raw": "74.5",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 76.6,
            "raw": "76.6",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 79.5,
            "raw": "79.5",
            "status": "VALUE"
          }
        ]
      }
    ],
    "official_report": {
      "checked_at": "2026-10-11T12:27:39.525Z",
      "published_at": "2025-04-04",
      "scope": "전국 19세 이상 성인 일반국민의 한방의료 이용 경험·만족도 대표 항목입니다. 한약 소비량 전체 표와는 다릅니다."
    }
  },
  {
    "id": "report:elder-abuse",
    "indicator_code": "",
    "table_code": "official-report:elder-abuse",
    "category": "노인",
    "title": "노인학대현황",
    "description": "전국 39개 노인보호전문기관의 2025년 접수·판정 결과입니다. 신고와 학대 판정 건수는 별개입니다.",
    "note": "공식 발표 자료의 대표 수치를 연결한 확인본입니다. 조사 실시 연도를 기준으로 표시하며 자동 API 갱신 대상이 아닙니다.",
    "highlight_series_id": "reports",
    "original_unit": "건",
    "table_title": "노인학대 신고접수 건수 · 학대 판정 건수 · 재학대 건수",
    "source_url": "https://www.korea.kr/news/policyNewsView.do?newsId=148966437",
    "indicator_url": "https://www.korea.kr/news/policyNewsView.do?newsId=148966437",
    "source_name": "보건복지부",
    "source_notes": "전국 39개 노인보호전문기관의 2025년 접수·판정 결과입니다. 신고와 학대 판정 건수는 별개입니다.",
    "periods": [
      "2025"
    ],
    "series": [
      {
        "id": "reports",
        "label": "노인학대 신고접수 건수",
        "source_label": "노인학대 신고접수 건수",
        "unit": "건",
        "points": [
          {
            "period": "2025",
            "value": 26578,
            "raw": "26578",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "confirmed",
        "label": "학대 판정 건수",
        "source_label": "학대 판정 건수",
        "unit": "건",
        "points": [
          {
            "period": "2025",
            "value": 7973,
            "raw": "7973",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "repeated",
        "label": "재학대 건수",
        "source_label": "재학대 건수",
        "unit": "건",
        "points": [
          {
            "period": "2025",
            "value": 884,
            "raw": "884",
            "status": "VALUE"
          }
        ]
      }
    ],
    "official_report": {
      "checked_at": "2026-10-11T12:27:39.525Z",
      "published_at": "2026-06-12",
      "scope": "전국 39개 노인보호전문기관의 2025년 접수·판정 결과입니다. 신고와 학대 판정 건수는 별개입니다."
    }
  },
  {
    "id": "report:child-survey",
    "indicator_code": "",
    "table_code": "official-report:child-survey",
    "category": "아동",
    "title": "아동종합실태조사",
    "description": "2023년 18세 미만 아동 양육 5,753가구 실태조사의 주관적 웰빙 대표 지표입니다. 전체 조사표·연령별 응답 범위는 원문 보고서를 확인하세요.",
    "note": "공식 발표 자료의 대표 수치를 연결한 확인본입니다. 조사 실시 연도를 기준으로 표시하며 자동 API 갱신 대상이 아닙니다.",
    "highlight_series_id": "satisfaction",
    "original_unit": "점 (10점 만점)",
    "table_title": "아동의 전반적 삶의 만족도",
    "source_url": "https://www.mohw.go.kr/board.es?act=view&bid=0027&list_no=1481860&mid=a10503010100",
    "indicator_url": "https://www.mohw.go.kr/board.es?act=view&bid=0027&list_no=1481860&mid=a10503010100",
    "source_name": "보건복지부",
    "source_notes": "2023년 18세 미만 아동 양육 5,753가구 실태조사의 주관적 웰빙 대표 지표입니다. 전체 조사표·연령별 응답 범위는 원문 보고서를 확인하세요.",
    "periods": [
      "2013",
      "2018",
      "2023"
    ],
    "series": [
      {
        "id": "satisfaction",
        "label": "아동의 전반적 삶의 만족도",
        "source_label": "아동의 전반적 삶의 만족도",
        "unit": "점 (10점 만점)",
        "points": [
          {
            "period": "2013",
            "value": 6.1,
            "raw": "6.1",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 6.57,
            "raw": "6.57",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 7.14,
            "raw": "7.14",
            "status": "VALUE"
          }
        ]
      }
    ],
    "official_report": {
      "checked_at": "2026-10-11T12:27:39.525Z",
      "published_at": "2024-06-06",
      "scope": "2023년 18세 미만 아동 양육 5,753가구 실태조사의 주관적 웰빙 대표 지표입니다. 전체 조사표·연령별 응답 범위는 원문 보고서를 확인하세요."
    }
  },
  {
    "id": "report:child-abuse",
    "indicator_code": "",
    "table_code": "official-report:child-abuse",
    "category": "아동",
    "title": "학대피해아동보호현황",
    "description": "아동학대 연차보고서의 신고접수와 학대판단 사례입니다. 보호시설 수나 보호 인원 수와 다르며 중복 신고 제외 전·후 분모를 구분해야 합니다.",
    "note": "공식 발표 자료의 대표 수치를 연결한 확인본입니다. 조사 실시 연도를 기준으로 표시하며 자동 API 갱신 대상이 아닙니다.",
    "highlight_series_id": "confirmed",
    "original_unit": "건",
    "table_title": "아동학대 판단 건수 · 아동학대 신고접수 건수",
    "source_url": "https://m.korea.kr/briefing/pressReleaseView.do?newsId=156780038",
    "indicator_url": "https://m.korea.kr/briefing/pressReleaseView.do?newsId=156780038",
    "source_name": "보건복지부",
    "source_notes": "아동학대 연차보고서의 신고접수와 학대판단 사례입니다. 보호시설 수나 보호 인원 수와 다르며 중복 신고 제외 전·후 분모를 구분해야 합니다.",
    "periods": [
      "2021",
      "2022",
      "2023",
      "2024",
      "2025"
    ],
    "series": [
      {
        "id": "confirmed",
        "label": "아동학대 판단 건수",
        "source_label": "아동학대 판단 건수",
        "unit": "건",
        "points": [
          {
            "period": "2021",
            "value": 37605,
            "raw": "37605",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 27971,
            "raw": "27971",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 25739,
            "raw": "25739",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 24492,
            "raw": "24492",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 23648,
            "raw": "23648",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "reports",
        "label": "아동학대 신고접수 건수",
        "source_label": "아동학대 신고접수 건수",
        "unit": "건",
        "points": [
          {
            "period": "2021",
            "value": 53932,
            "raw": "53932",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 46103,
            "raw": "46103",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 48522,
            "raw": "48522",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 50242,
            "raw": "50242",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 63166,
            "raw": "63166",
            "status": "VALUE"
          }
        ]
      }
    ],
    "official_report": {
      "checked_at": "2026-10-11T12:27:39.525Z",
      "published_at": "2026-09-03",
      "scope": "아동학대 연차보고서의 신고접수와 학대판단 사례입니다. 보호시설 수나 보호 인원 수와 다르며 중복 신고 제외 전·후 분모를 구분해야 합니다."
    }
  },
  {
    "id": "report:health-resources",
    "indicator_code": "",
    "table_code": "official-report:health-resources",
    "category": "보건·의료",
    "title": "국민보건의료실태통계",
    "description": "제5차 국민보건의료실태조사 수정 시도편의 전국 보건의료기관 활동 의사·간호사 수(2016–2020)입니다. 최신 연도 자료로 오인하지 않도록 수록연도를 표시합니다.",
    "note": "공식 발표 자료의 대표 수치를 연결한 확인본입니다. 조사 실시 연도를 기준으로 표시하며 자동 API 갱신 대상이 아닙니다.",
    "highlight_series_id": "doctors",
    "original_unit": "명",
    "table_title": "보건의료기관 활동 의사 수 (전국·상근) · 보건의료기관 활동 간호사 수 (전국)",
    "source_url": "https://www.mohw.go.kr/board.es?act=view&bid=0019&list_no=372195&mid=a10411010100",
    "indicator_url": "https://www.mohw.go.kr/board.es?act=view&bid=0019&list_no=372195&mid=a10411010100",
    "source_name": "보건복지부",
    "source_notes": "제5차 국민보건의료실태조사 수정 시도편의 전국 보건의료기관 활동 의사·간호사 수(2016–2020)입니다. 최신 연도 자료로 오인하지 않도록 수록연도를 표시합니다. 원문 첨부 1. 국민보건의료실태통계_(시도편)_1209(수정).xlsx, Ⅰ.C.3. a)·d), 전국 / 전체 행.",
    "periods": [
      "2016",
      "2017",
      "2018",
      "2019",
      "2020"
    ],
    "series": [
      {
        "id": "doctors",
        "label": "보건의료기관 활동 의사 수 (전국·상근)",
        "source_label": "보건의료기관 활동 의사 수 (전국·상근)",
        "unit": "명",
        "points": [
          {
            "period": "2016",
            "value": 97573,
            "raw": "97573",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 99681,
            "raw": "99681",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 102166,
            "raw": "102166",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 104919,
            "raw": "104919",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 107031,
            "raw": "107031",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "nurses",
        "label": "보건의료기관 활동 간호사 수 (전국)",
        "source_label": "보건의료기관 활동 간호사 수 (전국)",
        "unit": "명",
        "points": [
          {
            "period": "2016",
            "value": 179989,
            "raw": "179989",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 185853,
            "raw": "185853",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 195314,
            "raw": "195314",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 215293,
            "raw": "215293",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 225462,
            "raw": "225462",
            "status": "VALUE"
          }
        ]
      }
    ],
    "official_report": {
      "checked_at": "2026-10-11T12:27:39.525Z",
      "published_at": "2022-07-15",
      "scope": "제5차 국민보건의료실태조사 수정 시도편의 전국 보건의료기관 활동 의사·간호사 수(2016–2020)입니다. 최신 연도 자료로 오인하지 않도록 수록연도를 표시합니다."
    }
  },
  {
    "id": "report:postpartum",
    "indicator_code": "",
    "table_code": "official-report:postpartum",
    "category": "보건·의료",
    "title": "산후조리실태조사",
    "description": "2023년에 출산한 산모 3,221명을 대상으로 실시한 2024년 조사입니다. 산후조리원 비용과 재가 비용은 각각의 평균으로 합산하지 않습니다.",
    "note": "공식 발표 자료의 대표 수치를 연결한 확인본입니다. 조사 실시 연도를 기준으로 표시하며 자동 API 갱신 대상이 아닙니다.",
    "highlight_series_id": "days",
    "original_unit": "일, 만원",
    "table_title": "평균 산후조리 기간 (집 포함) · 산후조리원 평균 지출 비용 · 재가 평균 지출 비용",
    "source_url": "https://www.mohw.go.kr/board.es?act=view&bid=0027&list_no=1484525&mid=a10503010200",
    "indicator_url": "https://www.mohw.go.kr/board.es?act=view&bid=0027&list_no=1484525&mid=a10503010200",
    "source_name": "보건복지부",
    "source_notes": "2023년에 출산한 산모 3,221명을 대상으로 실시한 2024년 조사입니다. 산후조리원 비용과 재가 비용은 각각의 평균으로 합산하지 않습니다.",
    "periods": [
      "2024"
    ],
    "series": [
      {
        "id": "days",
        "label": "평균 산후조리 기간 (집 포함)",
        "source_label": "평균 산후조리 기간 (집 포함)",
        "unit": "일",
        "points": [
          {
            "period": "2024",
            "value": 30.7,
            "raw": "30.7",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "facility-cost",
        "label": "산후조리원 평균 지출 비용",
        "source_label": "산후조리원 평균 지출 비용",
        "unit": "만원",
        "points": [
          {
            "period": "2024",
            "value": 286.5,
            "raw": "286.5",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "home-cost",
        "label": "재가 평균 지출 비용",
        "source_label": "재가 평균 지출 비용",
        "unit": "만원",
        "points": [
          {
            "period": "2024",
            "value": 125.5,
            "raw": "125.5",
            "status": "VALUE"
          }
        ]
      }
    ],
    "official_report": {
      "checked_at": "2026-10-11T12:27:39.525Z",
      "published_at": "2025-02-05",
      "scope": "2023년에 출산한 산모 3,221명을 대상으로 실시한 2024년 조사입니다. 산후조리원 비용과 재가 비용은 각각의 평균으로 합산하지 않습니다."
    }
  },
  {
    "id": "report:suicide-survey",
    "indicator_code": "",
    "table_code": "official-report:suicide-survey",
    "category": "보건·의료",
    "title": "자살실태조사",
    "description": "19–75세 성인 2,807명을 대상으로 한 2023년 자살에 대한 국민인식조사의 평생 자살생각 경험률입니다. 사망 통계와 다릅니다.",
    "note": "공식 발표 자료의 대표 수치를 연결한 확인본입니다. 조사 실시 연도를 기준으로 표시하며 자동 API 갱신 대상이 아닙니다.",
    "highlight_series_id": "lifetime",
    "original_unit": "%",
    "table_title": "평생 자살생각 경험률",
    "source_url": "https://www.mohw.go.kr/board.es?act=view&bid=0027&list_no=1480826&mid=a10503010100",
    "indicator_url": "https://www.mohw.go.kr/board.es?act=view&bid=0027&list_no=1480826&mid=a10503010100",
    "source_name": "보건복지부",
    "source_notes": "19–75세 성인 2,807명을 대상으로 한 2023년 자살에 대한 국민인식조사의 평생 자살생각 경험률입니다. 사망 통계와 다릅니다.",
    "periods": [
      "2018",
      "2023"
    ],
    "series": [
      {
        "id": "lifetime",
        "label": "평생 자살생각 경험률",
        "source_label": "평생 자살생각 경험률",
        "unit": "%",
        "points": [
          {
            "period": "2018",
            "value": 18.5,
            "raw": "18.5",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 14.7,
            "raw": "14.7",
            "status": "VALUE"
          }
        ]
      }
    ],
    "official_report": {
      "checked_at": "2026-10-11T12:27:39.525Z",
      "published_at": "2024-03-28",
      "scope": "19–75세 성인 2,807명을 대상으로 한 2023년 자살에 대한 국민인식조사의 평생 자살생각 경험률입니다. 사망 통계와 다릅니다."
    }
  }
];

