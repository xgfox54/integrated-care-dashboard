// 보건복지부·지표누리 공식 공개 표에서 확인한 값. 원문 단위·결측 기호 보존.
// 확인시각은 관측연도가 아니다. docs/statistics/README.md 참조.
export const VERIFIED_AT = "2026-10-10T05:49:57.000Z";
export const STATISTICS_REVISION = "mohw-statistics-2026-10-10-v1";
export const VERIFIED_DATASETS = [
  {
    "id": "stat:2760",
    "indicator_code": "2760",
    "table_code": "276001",
    "category": "사회보장",
    "title": "국민기초생활보장 수급 현황",
    "highlight": 0,
    "description": "기초생활보장 수급자 수와 전국 인구 대비 수급률",
    "note": "수급자 수는 천명 단위입니다. 선정기준 변화가 있으므로 증가를 빈곤 증가로 단정할 수 없습니다.",
    "highlight_series_id": "row-1",
    "original_unit": "천명, %",
    "table_title": "기초생활보장 수급 현황",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=2760&period=N&stts_cd=276001",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2760",
    "source_name": "보건복지부 (내부행정자료)",
    "source_notes": "* 전국민 대비 기초생활보장수급자 수와 비율",
    "periods": [
      "2016",
      "2017",
      "2018",
      "2019",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
      "2025"
    ],
    "series": [
      {
        "id": "row-1",
        "label": "수급자 수",
        "source_label": "수급자 수",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "value": 1630,
            "raw": "1,630",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 1582,
            "raw": "1,582",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 1744,
            "raw": "1,744",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 1881,
            "raw": "1,881",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 2134,
            "raw": "2,134",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 2360,
            "raw": "2,360",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 2451,
            "raw": "2,451",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 2555,
            "raw": "2,555",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 2673,
            "raw": "2,673",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 2837,
            "raw": "2,837",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-2",
        "label": "수급률",
        "source_label": "수급률",
        "unit": "%",
        "points": [
          {
            "period": "2016",
            "value": 3.2,
            "raw": "3.2",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 3.1,
            "raw": "3.1",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 3.4,
            "raw": "3.4",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 3.6,
            "raw": "3.6",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 4.1,
            "raw": "4.1",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 4.6,
            "raw": "4.6",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 4.8,
            "raw": "4.8",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 4.9,
            "raw": "4.9",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 5.2,
            "raw": "5.2",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 5.5,
            "raw": "5.5",
            "status": "VALUE"
          }
        ]
      }
    ]
  },
  {
    "id": "stat:1406",
    "indicator_code": "1406",
    "table_code": "140601",
    "category": "보건·의료",
    "title": "의료급여 수급 현황",
    "highlight": 0,
    "description": "연도말 의료급여 수급자 수와 수급률",
    "note": "연도말 기준입니다. 원문이 명시한 전산관리 잠정수치 여부와 확정 공표 시기를 함께 확인하세요.",
    "highlight_series_id": "row-1",
    "original_unit": "천명, %",
    "table_title": "의료급여 수급현황",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=1406&period=N&stts_cd=140601",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1406",
    "source_name": "국민건강보험공단「의료급여통계」",
    "source_notes": "수급률 : 총인구 대비 의료급여 수급자수 (총인구 : 통계청 인구추계) 수급자수: 의료급여법에 따라 의료급여를 받을 수 있는 자격을 가진자로 연도말기준이며 국민건강보험공단 전산관리 잠정수치임 (매년 10월 확정자료 공표)",
    "periods": [
      "2015",
      "2016",
      "2017",
      "2018",
      "2019",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024"
    ],
    "series": [
      {
        "id": "row-1",
        "label": "의료급여 수급자수",
        "source_label": "의료급여 수급자수",
        "unit": "천명",
        "points": [
          {
            "period": "2015",
            "value": 1534,
            "raw": "1,534",
            "status": "VALUE"
          },
          {
            "period": "2016",
            "value": 1506,
            "raw": "1,506",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 1486,
            "raw": "1,486",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 1485,
            "raw": "1,485",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 1489,
            "raw": "1,489",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 1527,
            "raw": "1,527",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 1516,
            "raw": "1,516",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 1522,
            "raw": "1,522",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 1517,
            "raw": "1,517",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 1560,
            "raw": "1,560",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-2",
        "label": "수급률",
        "source_label": "수급률",
        "unit": "%",
        "points": [
          {
            "period": "2015",
            "value": 3,
            "raw": "3.0",
            "status": "VALUE"
          },
          {
            "period": "2016",
            "value": 2.9,
            "raw": "2.9",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 2.9,
            "raw": "2.9",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 2.9,
            "raw": "2.9",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 2.9,
            "raw": "2.9",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 3,
            "raw": "3.0",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 3,
            "raw": "3.0",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 3,
            "raw": "3.0",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 2.9,
            "raw": "2.9",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 3,
            "raw": "3.0",
            "status": "VALUE"
          }
        ]
      }
    ]
  },
  {
    "id": "stat:3053",
    "indicator_code": "3053",
    "table_code": "305301",
    "category": "아동",
    "title": "아동 인구 현황",
    "highlight": 1,
    "description": "주민등록인구 기준 0~17세 아동 인구와 구성비",
    "note": "주민등록인구 기준입니다. 구성비는 원문이 제공하는 반올림 값을 그대로 보존합니다.",
    "highlight_series_id": "row-2",
    "original_unit": "명, %",
    "table_title": "총인구중 아동(0~17세) 인구 구성비",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=3053&period=N&stts_cd=305301",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=3053",
    "source_name": "주민등록인구통계",
    "source_notes": "본 지표의 아동인구는 주민등록인구통계 자료를 기초로 작성 되었음",
    "periods": [
      "2021",
      "2022",
      "2023",
      "2024",
      "2025"
    ],
    "series": [
      {
        "id": "row-1",
        "label": "총 인구수",
        "source_label": "총 인구수",
        "unit": "명",
        "points": [
          {
            "period": "2021",
            "value": 51638109,
            "raw": "51,638,109",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 51439038,
            "raw": "51,439,038",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 51325329,
            "raw": "51,325,329",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 51217221,
            "raw": "51,217,221",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 51117378,
            "raw": "51,117,378",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-2",
        "label": "아동 인구수",
        "source_label": "아동 인구수",
        "unit": "명",
        "points": [
          {
            "period": "2021",
            "value": 7483944,
            "raw": "7,483,944",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 7271460,
            "raw": "7,271,460",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 7077206,
            "raw": "7,077,206",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 6876330,
            "raw": "6,876,330",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 6644957,
            "raw": "6,644,957",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-3",
        "label": "비율(구성비)",
        "source_label": "비율(구성비)",
        "unit": "%",
        "points": [
          {
            "period": "2021",
            "value": 15,
            "raw": "15",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 14,
            "raw": "14",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 14,
            "raw": "14",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 13,
            "raw": "13",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 13,
            "raw": "13",
            "status": "VALUE"
          }
        ]
      }
    ]
  },
  {
    "id": "stat:2709",
    "indicator_code": "2709",
    "table_code": "270903",
    "category": "노인",
    "title": "국민연금 수급자 현황",
    "highlight": 0,
    "description": "노령·장애·유족연금 수급자의 연도말 누계",
    "note": "각 연도말 누계이며 일시금 수급자는 제외합니다. 여러 해의 누계값을 더하지 마세요.",
    "highlight_series_id": "row-1",
    "original_unit": "명",
    "table_title": "국민연금 수급자 현황(누적)",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=2709&period=N&stts_cd=270903",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2709",
    "source_name": "국민연금공단 전산시스템(NPiS)",
    "source_notes": "* 각 연도말 누계수치임 * 일시금(반환, 사망, 장애) 수급자는 제외",
    "periods": [
      "2016",
      "2017",
      "2018",
      "2019",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
      "2025"
    ],
    "series": [
      {
        "id": "row-1",
        "label": "계",
        "source_label": "계",
        "unit": "명",
        "points": [
          {
            "period": "2016",
            "value": 4135292,
            "raw": "4,135,292",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 4475143,
            "raw": "4,475,143",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 4596690,
            "raw": "4,596,690",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 4961143,
            "raw": "4,961,143",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 5388022,
            "raw": "5,388,022",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 5864373,
            "raw": "5,864,373",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 6424917,
            "raw": "6,424,917",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 6626552,
            "raw": "6,626,552",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 7155257,
            "raw": "7,155,257",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 7682622,
            "raw": "7,682,622",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-2",
        "label": "노령연금수급자",
        "source_label": "노령연금수급자",
        "unit": "명",
        "points": [
          {
            "period": "2016",
            "value": 3412350,
            "raw": "3,412,350",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 3706516,
            "raw": "3,706,516",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 3778824,
            "raw": "3,778,824",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 4090497,
            "raw": "4,090,497",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 4468126,
            "raw": "4,468,126",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 4894452,
            "raw": "4,894,452",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 5396729,
            "raw": "5,396,729",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 5543769,
            "raw": "5,543,769",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 6015091,
            "raw": "6,015,091",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 6486471,
            "raw": "6,486,471",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-3",
        "label": "장애연금수급자",
        "source_label": "장애연금수급자",
        "unit": "명",
        "points": [
          {
            "period": "2016",
            "value": 75497,
            "raw": "75,497",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 75486,
            "raw": "75,486",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 75734,
            "raw": "75,734",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 77872,
            "raw": "77,872",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 78079,
            "raw": "78,079",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 77726,
            "raw": "77,726",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 76718,
            "raw": "76,718",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 75616,
            "raw": "75,616",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 76865,
            "raw": "76,865",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 75787,
            "raw": "75,787",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-4",
        "label": "유족연금수급자",
        "source_label": "유족연금수급자",
        "unit": "명",
        "points": [
          {
            "period": "2016",
            "value": 647445,
            "raw": "647,445",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 693141,
            "raw": "693,141",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 742132,
            "raw": "742,132",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 792774,
            "raw": "792,774",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 841817,
            "raw": "841,817",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 892195,
            "raw": "892,195",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 951470,
            "raw": "951,470",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 1007167,
            "raw": "1,007,167",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 1063301,
            "raw": "1,063,301",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 1120364,
            "raw": "1,120,364",
            "status": "VALUE"
          }
        ]
      }
    ]
  },
  {
    "id": "stat:2766",
    "indicator_code": "2766",
    "table_code": "276602",
    "category": "노인",
    "title": "노인복지시설 현황",
    "highlight": 22,
    "description": "노인 주거·의료·여가·재가복지시설의 유형별 시설 수",
    "note": "이 연결표의 항목은 시설 수(개소)입니다. 소계·합계와 하위 시설을 중복 합산하지 마세요.",
    "highlight_series_id": "row-23",
    "original_unit": "개소, 명",
    "table_title": "노인복지시설 현황",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=2766&period=N&stts_cd=276602",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2766",
    "source_name": "보건복지부「노인복지시설 현황」",
    "source_notes": "노인복지시설의 명칭이 노인복지법 시행규칙의 개정,시행으로 다음과 같이 변경되었습니다. * 재가노인지원서비스(재가노인복지시설) 신설('10.2.24) * 노인전문병원(노인의료복지시설), 노인휴양소(노인여가복지시설) 삭제('11.12.8) * 노인일자리지원기관 신설('13.12.5) * 학대피해노인 전용쉼터 신설('17.19.15.) * 복지용구지원서비스(재가노인복지시설) 신설('19.12.12) (시설 종류) - 노인주거복지시설 : 양로시설, 노인공동생활가정, 노인복지주택 - 노인의료복지시설 : 노인요양시설, 노인요양공동생활가정 - 노인여가복지시설 : 노인복지관, 경로당, 노인교실 - 재가노인복지시설 : 방문요양서비스, 방문목욕서비스, 방문간호 서비스, 주야간보호서비스, 단기보호서비스, 재가노인지원서비스, 복지용구지원서비스 - 노인보호전문기관 : 노인보호전문기관 - 노인일자리지원기관 : 노인일자리지원기관 - 학대피해노인 전용쉼터",
    "periods": [
      "2021",
      "2022",
      "2023",
      "2024",
      "2025"
    ],
    "series": [
      {
        "id": "row-1",
        "label": "노인주거복지시설 / 소계",
        "source_label": "노인주거복지시설 / 소계",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 337,
            "raw": "337",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 308,
            "raw": "308",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 297,
            "raw": "297",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 281,
            "raw": "281",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 283,
            "raw": "283",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-2",
        "label": "노인주거복지시설 / 양로시설",
        "source_label": "노인주거복지시설 / 양로시설",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 192,
            "raw": "192",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 180,
            "raw": "180",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 175,
            "raw": "175",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 166,
            "raw": "166",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 171,
            "raw": "171",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-3",
        "label": "노인주거복지시설 / 노인공동생활가정",
        "source_label": "노인주거복지시설 / 노인공동생활가정",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 107,
            "raw": "107",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 89,
            "raw": "89",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 82,
            "raw": "82",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 72,
            "raw": "72",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 65,
            "raw": "65",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-4",
        "label": "노인주거복지시설 / 노인복지주택",
        "source_label": "노인주거복지시설 / 노인복지주택",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 38,
            "raw": "38",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 39,
            "raw": "39",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 40,
            "raw": "40",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 43,
            "raw": "43",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 47,
            "raw": "47",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-5",
        "label": "노인의료복지시설 / 소계",
        "source_label": "노인의료복지시설 / 소계",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 5821,
            "raw": "5,821",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 6069,
            "raw": "6,069",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 6139,
            "raw": "6,139",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 6195,
            "raw": "6,195",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 6211,
            "raw": "6,211",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-6",
        "label": "노인의료복지시설 / 노인요양시설",
        "source_label": "노인의료복지시설 / 노인요양시설",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 4057,
            "raw": "4,057",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 4346,
            "raw": "4,346",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 4525,
            "raw": "4,525",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 4640,
            "raw": "4,640",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 4758,
            "raw": "4,758",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-7",
        "label": "노인의료복지시설 / 노인요양공동생활가정",
        "source_label": "노인의료복지시설 / 노인요양공동생활가정",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 1764,
            "raw": "1,764",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 1723,
            "raw": "1,723",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 1614,
            "raw": "1,614",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 1555,
            "raw": "1,555",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 1453,
            "raw": "1,453",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-8",
        "label": "노인여가복지시설 / 소계",
        "source_label": "노인여가복지시설 / 소계",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 69273,
            "raw": "69,273",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 69786,
            "raw": "69,786",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 70455,
            "raw": "70,455",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 70935,
            "raw": "70,935",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 71309,
            "raw": "71,309",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-9",
        "label": "노인여가복지시설 / 노인복지관",
        "source_label": "노인여가복지시설 / 노인복지관",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 357,
            "raw": "357",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 366,
            "raw": "366",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 438,
            "raw": "438",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 454,
            "raw": "454",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 459,
            "raw": "459",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-10",
        "label": "노인여가복지시설 / 경로당",
        "source_label": "노인여가복지시설 / 경로당",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 67655,
            "raw": "67,655",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 68180,
            "raw": "68,180",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 68792,
            "raw": "68,792",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 69260,
            "raw": "69,260",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 69687,
            "raw": "69,687",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-11",
        "label": "노인여가복지시설 / 노인교실",
        "source_label": "노인여가복지시설 / 노인교실",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 1261,
            "raw": "1,261",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 1240,
            "raw": "1,240",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 1225,
            "raw": "1,225",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 1221,
            "raw": "1,221",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 1163,
            "raw": "1,163",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-12",
        "label": "재가노인복지시설 / 소계",
        "source_label": "재가노인복지시설 / 소계",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 9984,
            "raw": "9,984",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 13272,
            "raw": "13,272",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 15896,
            "raw": "15,896",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 18745,
            "raw": "18,745",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 19146,
            "raw": "19,146",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-13",
        "label": "재가노인복지시설 / 방문요양서비스",
        "source_label": "재가노인복지시설 / 방문요양서비스",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 4156,
            "raw": "4,156",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 5808,
            "raw": "5,808",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 7192,
            "raw": "7,192",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 8668,
            "raw": "8,668",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 9266,
            "raw": "9,266",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-14",
        "label": "재가노인복지시설 / 주야간보호서비스",
        "source_label": "재가노인복지시설 / 주야간보호서비스",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 2618,
            "raw": "2,618",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 3035,
            "raw": "3,035",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 3397,
            "raw": "3,397",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 3790,
            "raw": "3,790",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 4056,
            "raw": "4,056",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-15",
        "label": "재가노인복지시설 / 단기보호서비스",
        "source_label": "재가노인복지시설 / 단기보호서비스",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 69,
            "raw": "69",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 70,
            "raw": "70",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 60,
            "raw": "60",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 60,
            "raw": "60",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 51,
            "raw": "51",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-16",
        "label": "재가노인복지시설 / 방문목욕서비스",
        "source_label": "재가노인복지시설 / 방문목욕서비스",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 2415,
            "raw": "2,415",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 3394,
            "raw": "3,394",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 4070,
            "raw": "4,070",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 4794,
            "raw": "4,794",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 4135,
            "raw": "4,135",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-17",
        "label": "재가노인복지시설 / 방문간호서비스",
        "source_label": "재가노인복지시설 / 방문간호서비스",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 158,
            "raw": "158",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 234,
            "raw": "234",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 295,
            "raw": "295",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 376,
            "raw": "376",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 435,
            "raw": "435",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-18",
        "label": "재가노인복지시설 / 복지용구지원서비스",
        "source_label": "재가노인복지시설 / 복지용구지원서비스",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 208,
            "raw": "208",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 368,
            "raw": "368",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 540,
            "raw": "540",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 718,
            "raw": "718",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 789,
            "raw": "789",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-19",
        "label": "재가노인복지시설 / 재가지원서비스",
        "source_label": "재가노인복지시설 / 재가지원서비스",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 360,
            "raw": "360",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 363,
            "raw": "363",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 342,
            "raw": "342",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 339,
            "raw": "339",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 414,
            "raw": "414",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-20",
        "label": "노인보호전문기관",
        "source_label": "노인보호전문기관",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 37,
            "raw": "37",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 37,
            "raw": "37",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 38,
            "raw": "38",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 39,
            "raw": "39",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 40,
            "raw": "40",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-21",
        "label": "노인일자리지원기관",
        "source_label": "노인일자리지원기관",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 206,
            "raw": "206",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 206,
            "raw": "206",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 211,
            "raw": "211",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 215,
            "raw": "215",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 223,
            "raw": "223",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-22",
        "label": "학대피해노인 전용쉼터",
        "source_label": "학대피해노인 전용쉼터",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 20,
            "raw": "20",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 20,
            "raw": "20",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 20,
            "raw": "20",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 20,
            "raw": "20",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 20,
            "raw": "20",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-23",
        "label": "합계",
        "source_label": "합계",
        "unit": "개소",
        "points": [
          {
            "period": "2021",
            "value": 85228,
            "raw": "85,228",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 89698,
            "raw": "89,698",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 93056,
            "raw": "93,056",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 96430,
            "raw": "96,430",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 97232,
            "raw": "97,232",
            "status": "VALUE"
          }
        ]
      }
    ]
  },
  {
    "id": "stat:1431",
    "indicator_code": "1431",
    "table_code": "143101",
    "category": "보건·의료",
    "title": "GDP대비 경상의료비 추이",
    "highlight": 0,
    "description": "경상의료비와 GDP 대비 비율, 정부·민간 구성",
    "note": "원문이 표시한 잠정치를 구분합니다. 과거년도 수치도 개정되며, 조원과 %를 구분합니다.",
    "highlight_series_id": "row-1",
    "original_unit": "조원, %",
    "table_title": "GDP대비 경상의료비 추이",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=1431&period=N&stts_cd=143101",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1431",
    "source_name": "보건복지부 『2024년 국민보건계정』, OECD Health Statistics 2026(요약본) 소책자",
    "source_notes": "1 : 2011년 기준 추계부터 공급자 센서스 기반인 경제총조사 결과를 기본 자료원으로 활용하였고, 시계열 유지를 위해 과거년도 수치 수정으로 과거년도 발표수치와 차이 있음 2 : 2024년은 잠정치임",
    "periods": [
      "2015",
      "2016",
      "2017",
      "2018",
      "2019",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024"
    ],
    "series": [
      {
        "id": "row-1",
        "label": "경상의료비",
        "source_label": "◎ 경상의료비",
        "unit": "조원",
        "points": [
          {
            "period": "2015",
            "value": 112.5,
            "raw": "112.5",
            "status": "VALUE"
          },
          {
            "period": "2016",
            "value": 121.6,
            "raw": "121.6",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 131.4,
            "raw": "131.4",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 143.3,
            "raw": "143.3",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 157,
            "raw": "157.0",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 165.2,
            "raw": "165.2",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 185,
            "raw": "185.0",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 205.5,
            "raw": "205.5",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 203.4,
            "raw": "203.4",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 216.6,
            "raw": "216.6",
            "status": "PROVISIONAL"
          }
        ]
      },
      {
        "id": "row-2",
        "label": "경상의료비 / GDP 대비",
        "source_label": "- (GDP대비, %)",
        "unit": "%",
        "points": [
          {
            "period": "2015",
            "value": 6.5,
            "raw": "6.5",
            "status": "VALUE"
          },
          {
            "period": "2016",
            "value": 6.6,
            "raw": "6.6",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 6.8,
            "raw": "6.8",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 7.1,
            "raw": "7.1",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 7.7,
            "raw": "7.7",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 8,
            "raw": "8.0",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 8.3,
            "raw": "8.3",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 8.8,
            "raw": "8.8",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 8.5,
            "raw": "8.5",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 8.5,
            "raw": "8.5",
            "status": "PROVISIONAL"
          }
        ]
      },
      {
        "id": "row-3",
        "label": "정부·의무가입제도 의료비",
        "source_label": "ㅇ 정부,의무가입제도",
        "unit": "조원",
        "points": [
          {
            "period": "2015",
            "value": 62.7,
            "raw": "62.7",
            "status": "VALUE"
          },
          {
            "period": "2016",
            "value": 68.7,
            "raw": "68.7",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 75.2,
            "raw": "75.2",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 83.1,
            "raw": "83.1",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 92.8,
            "raw": "92.8",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 98.6,
            "raw": "98.6",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 115,
            "raw": "115.0",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 130.6,
            "raw": "130.6",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 122.9,
            "raw": "122.9",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 129.4,
            "raw": "129.4",
            "status": "PROVISIONAL"
          }
        ]
      },
      {
        "id": "row-4",
        "label": "정부·의무가입제도 / 구성비",
        "source_label": "- (구성비, %)",
        "unit": "%",
        "points": [
          {
            "period": "2015",
            "value": 55.8,
            "raw": "55.8",
            "status": "VALUE"
          },
          {
            "period": "2016",
            "value": 56.5,
            "raw": "56.5",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 57.2,
            "raw": "57.2",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 58,
            "raw": "58.0",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 59.1,
            "raw": "59.1",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 59.7,
            "raw": "59.7",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 62.1,
            "raw": "62.1",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 63.6,
            "raw": "63.6",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 60.4,
            "raw": "60.4",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 59.7,
            "raw": "59.7",
            "status": "PROVISIONAL"
          }
        ]
      },
      {
        "id": "row-5",
        "label": "민간의료비",
        "source_label": "ㅇ 민간의료비",
        "unit": "조원",
        "points": [
          {
            "period": "2015",
            "value": 49.7,
            "raw": "49.7",
            "status": "VALUE"
          },
          {
            "period": "2016",
            "value": 52.9,
            "raw": "52.9",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 56.3,
            "raw": "56.3",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 60.2,
            "raw": "60.2",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 64.2,
            "raw": "64.2",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 66.6,
            "raw": "66.6",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 70,
            "raw": "70.0",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 74.9,
            "raw": "74.9",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 80.5,
            "raw": "80.5",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 87.2,
            "raw": "87.2",
            "status": "PROVISIONAL"
          }
        ]
      },
      {
        "id": "row-6",
        "label": "민간의료비 / 구성비",
        "source_label": "- (구성비, %)",
        "unit": "%",
        "points": [
          {
            "period": "2015",
            "value": 44.2,
            "raw": "44.2",
            "status": "VALUE"
          },
          {
            "period": "2016",
            "value": 43.5,
            "raw": "43.5",
            "status": "VALUE"
          },
          {
            "period": "2017",
            "value": 42.8,
            "raw": "42.8",
            "status": "VALUE"
          },
          {
            "period": "2018",
            "value": 42,
            "raw": "42.0",
            "status": "VALUE"
          },
          {
            "period": "2019",
            "value": 40.9,
            "raw": "40.9",
            "status": "VALUE"
          },
          {
            "period": "2020",
            "value": 40.3,
            "raw": "40.3",
            "status": "VALUE"
          },
          {
            "period": "2021",
            "value": 37.9,
            "raw": "37.9",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 36.4,
            "raw": "36.4",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 39.6,
            "raw": "39.6",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 40.3,
            "raw": "40.3",
            "status": "PROVISIONAL"
          }
        ]
      }
    ]
  },
  {
    "id": "stat:2767",
    "indicator_code": "2767",
    "table_code": "276701",
    "category": "노인",
    "title": "노인일자리 및 노후생활 현황",
    "highlight": 0,
    "description": "유형별 노인일자리 창출 추진실적",
    "note": "이 연결표는 일자리 창출 건수(개)입니다. 원문의 ‘-’는 0으로 바꾸지 않습니다. 소득·생활만족도 표는 포함하지 않습니다.",
    "highlight_series_id": "row-1",
    "original_unit": "개",
    "table_title": "노인일자리 창출 건수(추진실적)",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=2767&period=N&stts_cd=276701",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2767",
    "source_name": "보건복지부(한국노인인력개발원) (내부행정자료_노인일자리 업무시스템)",
    "source_notes": "보건복지부(한국노인인력개발원) (내부행정자료_노인일자리 업무시스템)",
    "periods": [
      "2021",
      "2022",
      "2023",
      "2024",
      "2025"
    ],
    "series": [
      {
        "id": "row-1",
        "label": "공익활동",
        "source_label": "공익활동",
        "unit": "개",
        "points": [
          {
            "period": "2021",
            "value": 610656,
            "raw": "610,656",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 626391,
            "raw": "626,391",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 629937,
            "raw": "629,937",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 669956,
            "raw": "669,956",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 701215,
            "raw": "701,215",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-2",
        "label": "사회서비스형",
        "source_label": "사회서비스형",
        "unit": "개",
        "points": [
          {
            "period": "2021",
            "value": 63058,
            "raw": "63,058",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 79992,
            "raw": "79,992",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 98977,
            "raw": "98,977",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 169249,
            "raw": "169,249",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 193703,
            "raw": "193,703",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-3",
        "label": "시장형사업단",
        "source_label": "시장형사업단",
        "unit": "개",
        "points": [
          {
            "period": "2021",
            "value": 40539,
            "raw": "40,539",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 42803,
            "raw": "42,803",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 50899,
            "raw": "50,899",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 61913,
            "raw": "61,913",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 69634,
            "raw": "69,634",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-4",
        "label": "취업알선형",
        "source_label": "취업알선형",
        "unit": "개",
        "points": [
          {
            "period": "2021",
            "value": 70334,
            "raw": "70,334",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 83290,
            "raw": "83,290",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 88460,
            "raw": "88,460",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 100097,
            "raw": "100,097",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 116285,
            "raw": "116,285",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-5",
        "label": "시니어인턴십",
        "source_label": "시니어인턴십",
        "unit": "개",
        "points": [
          {
            "period": "2021",
            "value": 34434,
            "raw": "34,434",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 46570,
            "raw": "46,570",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 53364,
            "raw": "53,364",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 69719,
            "raw": "69,719",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 78805,
            "raw": "78,805",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-6",
        "label": "고령자친화기업",
        "source_label": "고령자친화기업",
        "unit": "개",
        "points": [
          {
            "period": "2021",
            "value": 1986,
            "raw": "1,986",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": 2489,
            "raw": "2,489",
            "status": "VALUE"
          },
          {
            "period": "2023",
            "value": 2916,
            "raw": "2,916",
            "status": "VALUE"
          },
          {
            "period": "2024",
            "value": 2624,
            "raw": "2,624",
            "status": "VALUE"
          },
          {
            "period": "2025",
            "value": 2626,
            "raw": "2,626",
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "row-7",
        "label": "기업연계형",
        "source_label": "기업연계형",
        "unit": "개",
        "points": [
          {
            "period": "2021",
            "value": null,
            "raw": "-",
            "status": "MISSING"
          },
          {
            "period": "2022",
            "value": null,
            "raw": "-",
            "status": "MISSING"
          },
          {
            "period": "2023",
            "value": null,
            "raw": "-",
            "status": "MISSING"
          },
          {
            "period": "2024",
            "value": null,
            "raw": "-",
            "status": "MISSING"
          },
          {
            "period": "2025",
            "value": null,
            "raw": "-",
            "status": "MISSING"
          }
        ]
      },
      {
        "id": "row-8",
        "label": "재능나눔",
        "source_label": "재능나눔",
        "unit": "개",
        "points": [
          {
            "period": "2021",
            "value": 15152,
            "raw": "15,152",
            "status": "VALUE"
          },
          {
            "period": "2022",
            "value": null,
            "raw": "-",
            "status": "MISSING"
          },
          {
            "period": "2023",
            "value": null,
            "raw": "-",
            "status": "MISSING"
          },
          {
            "period": "2024",
            "value": null,
            "raw": "-",
            "status": "MISSING"
          },
          {
            "period": "2025",
            "value": null,
            "raw": "-",
            "status": "MISSING"
          }
        ]
      }
    ]
  }
];
export const APPROVED_STATISTICS = [
  {
    "title": "노인복지시설현황",
    "department": "요양보험운영과",
    "category": "노인",
    "method": "보고통계",
    "publication_schedule": "2026년 06월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "장애인건강보건통계",
    "department": "건강보건연구과",
    "category": "질병/건강",
    "method": "가공통계",
    "publication_schedule": "2026년 06월",
    "anniversary": "장애인의 날(04.20)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "국민기초생활보장수급자현황",
    "department": "기초생활보장과",
    "category": "사회",
    "method": "보고통계",
    "publication_schedule": "2026년 07월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "보건소및보건지소운영현황",
    "department": "건강정책과",
    "category": "보건/의료",
    "method": "보고통계",
    "publication_schedule": "2026년 07월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "장기요양실태조사",
    "department": "요양보험제도과",
    "category": "노인",
    "method": "조사통계",
    "publication_schedule": "2026년 08월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "국가정신건강현황",
    "department": "정신건강사업과",
    "category": "질병/건강",
    "method": "보고통계",
    "publication_schedule": "2026년 10월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "보건의료인력실태조사",
    "department": "의료자원정책과",
    "category": "보건/의료",
    "method": "가공통계",
    "publication_schedule": "2026년 10월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "장기등기증및이식통계",
    "department": "장기기증지원과",
    "category": "보건/의료",
    "method": "보고통계",
    "publication_schedule": "2026년 10월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "장애인학대현황",
    "department": "장애인권익지원과",
    "category": "장애인",
    "method": "보고통계",
    "publication_schedule": "2026년 10월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "고독사 발생 현황",
    "department": "지역복지과",
    "category": "사회",
    "method": "가공통계",
    "publication_schedule": "2026년 12월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "국민생활실태조사",
    "department": "기초생활보장과",
    "category": "사회",
    "method": "조사통계",
    "publication_schedule": "2026년 12월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "사회서비스수요공급실태조사",
    "department": "사회서비스정책과",
    "category": "사회",
    "method": "조사통계",
    "publication_schedule": "2026년 12월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "아동복지시설보호아동및종사자현황보고",
    "department": "아동보호자립과",
    "category": "아동",
    "method": "보고통계",
    "publication_schedule": "2026년 12월",
    "anniversary": "어린이날(05.05)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "암등록통계",
    "department": "질병정책과",
    "category": "질병/건강",
    "method": "보고통계",
    "publication_schedule": "2026년 12월",
    "anniversary": "암예방의 날(03.21)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "정신건강실태조사",
    "department": "연구기획과",
    "category": "질병/건강",
    "method": "조사통계",
    "publication_schedule": "2027년 02월",
    "anniversary": "정신건강의 날(10.10)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL"
  },
  {
    "title": "공중위생영업소실태보고",
    "department": "건강정책과",
    "category": "질병/건강",
    "method": "보고통계",
    "publication_schedule": "2027년 03월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "보건의료질통계",
    "department": "정보통계담당관",
    "category": "보건/의료",
    "method": "가공통계",
    "publication_schedule": "2027년 03월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "의료서비스경험조사",
    "department": "정보통계담당관",
    "category": "보건/의료",
    "method": "조사통계",
    "publication_schedule": "2027년 03월",
    "anniversary": "보건의 날(04.07)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "의료서비스이용현황",
    "department": "정보통계담당관",
    "category": "보건/의료",
    "method": "가공통계",
    "publication_schedule": "2027년 03월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "의약품소비량및판매액통계",
    "department": "정보통계담당관",
    "category": "보건/의료",
    "method": "가공통계",
    "publication_schedule": "2027년 03월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "장애인현황",
    "department": "장애인정책과",
    "category": "장애인",
    "method": "보고통계",
    "publication_schedule": "2027년 04월",
    "anniversary": "장애인의 날(04.20)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "한방의료이용및한약소비실태조사",
    "department": "한의약정책과",
    "category": "보건/의료",
    "method": "조사통계",
    "publication_schedule": "2027년 04월",
    "anniversary": "한방의 날(10.10)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "가정위탁국내입양현황",
    "department": "아동보호자립과",
    "category": "아동",
    "method": "보고통계",
    "publication_schedule": "2027년 05월",
    "anniversary": "입양의 날(05.11)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "보호대상아동 현황보고",
    "department": "아동정책과",
    "category": "아동",
    "method": "보고통계",
    "publication_schedule": "2027년 05월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "장애인실태조사 (지정통계)",
    "department": "장애인정책과",
    "category": "장애인",
    "method": "조사통계",
    "publication_schedule": "2027년 05월",
    "anniversary": "장애인의 날(04.20)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "노인실태조사",
    "department": "노인정책과",
    "category": "노인",
    "method": "조사통계",
    "publication_schedule": "2027년 06월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "노인학대현황",
    "department": "노인정책과",
    "category": "노인",
    "method": "보고통계",
    "publication_schedule": "2027년 06월",
    "anniversary": "노인학대 예방의 날(06.15)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "아동종합실태조사",
    "department": "아동정책과",
    "category": "아동",
    "method": "조사통계",
    "publication_schedule": "2027년 06월",
    "anniversary": "어린이날(05.05)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "국민보건계정",
    "department": "정보통계담당관",
    "category": "보건/의료",
    "method": "가공통계",
    "publication_schedule": "2027년 08월",
    "anniversary": "보건의 날(04.07)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "학대피해아동보호현황",
    "department": "아동학대대응과",
    "category": "아동",
    "method": "보고통계",
    "publication_schedule": "2027년 09월",
    "anniversary": "세계아동학대 예방의 날(11.19)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=2"
  },
  {
    "title": "국민보건의료실태통계",
    "department": "의료자원정책과",
    "category": "보건/의료",
    "method": "보고통계",
    "publication_schedule": "2027년 12월",
    "anniversary": "보건의 날(04.07)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=3"
  },
  {
    "title": "산후조리실태조사",
    "department": "출산정책과",
    "category": "아동",
    "method": "조사통계",
    "publication_schedule": "2028년 02월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=3"
  },
  {
    "title": "한국의 사회복지지출",
    "department": "사회보장총괄과",
    "category": "사회",
    "method": "가공통계",
    "publication_schedule": "2028년 04월",
    "anniversary": "사회복지의 날(09.07)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=3"
  },
  {
    "title": "자살실태조사",
    "department": "자살예방정책과",
    "category": "보건/의료",
    "method": "조사통계",
    "publication_schedule": "2029년 03월",
    "anniversary": "세계 자살예방의 날(09.10)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=3"
  },
  {
    "title": "장애인편의시설설치현황조사",
    "department": "장애인권익지원과",
    "category": "장애인",
    "method": "조사통계",
    "publication_schedule": "2029년 04월",
    "anniversary": "장애인의 날(04.20)",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=3"
  },
  {
    "title": "중증장애인생산품생산시설실태조사",
    "department": "장애인자립기반과",
    "category": "장애인",
    "method": "조사통계",
    "publication_schedule": "2029년 06월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=3"
  },
  {
    "title": "노숙인등의실태조사",
    "department": "자활정책과",
    "category": "사회",
    "method": "조사통계",
    "publication_schedule": "2030년 08월",
    "anniversary": "",
    "source_url": "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL&nPage=3"
  }
];

