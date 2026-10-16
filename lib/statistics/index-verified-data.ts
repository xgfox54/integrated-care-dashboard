import type { StatisticsDataset } from "./types.ts";
import { INDEX_EXPANDED_DATASETS, INDEX_EXPANDED_SERIES } from "./index-expanded-data.ts";

export const INDEX_CHECKED_AT = "2026-10-11T10:23:29.000Z";
const INDEX_BASE_DATASETS: readonly StatisticsDataset[] = [
  {
    "id": "stat:2762",
    "indicator_code": "2762",
    "table_code": "276201",
    "category": "사회보장",
    "title": "기준 중위소득 추이",
    "description": "가구원 수별 월 기준 중위소득입니다. 공표된 다음 연도 기준도 포함하며 실제 가구소득과 다릅니다.",
    "note": "가구원 수별 월 기준 중위소득입니다. 공표된 다음 연도 기준도 포함하며 실제 가구소득과 다릅니다.",
    "highlight_series_id": "api-4",
    "original_unit": "원/월",
    "table_title": "기준 중위소득",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=2762&period=N&stts_cd=276201",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2762",
    "source_name": "연도별 기준 중위소득 및 생계·의료급여 선정기준과 최저보장수준(보건복지부 고시)",
    "source_notes": "『국민기초생활 보장법』개정에 따라 그간 수급자 선정 및 급여 기준으로 활용되어온 \"최저생계비\"를 \"기준 중위소득\"으로 개편하여 상대적 빈곤 개념 도입",
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
      "2025",
      "2026",
      "2027"
    ],
    "series": [
      {
        "id": "api-1",
        "label": "기준중위소득 / 1인가구",
        "source_label": "기준중위소득 / 1인가구",
        "unit": "원/월",
        "points": [
          {
            "period": "2016",
            "raw": "1624831",
            "value": 1624831,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "1652931",
            "value": 1652931,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "1672105",
            "value": 1672105,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "1707008",
            "value": 1707008,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "1757194",
            "value": 1757194,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1827831",
            "value": 1827831,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "1944812",
            "value": 1944812,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "2077892",
            "value": 2077892,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "2228445",
            "value": 2228445,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "2392013",
            "value": 2392013,
            "status": "VALUE"
          },
          {
            "period": "2026",
            "raw": "2564238",
            "value": 2564238,
            "status": "VALUE"
          },
          {
            "period": "2027",
            "raw": "2736042",
            "value": 2736042,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "기준중위소득 / 2인가구",
        "source_label": "기준중위소득 / 2인가구",
        "unit": "원/월",
        "points": [
          {
            "period": "2016",
            "raw": "2766603",
            "value": 2766603,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "2814449",
            "value": 2814449,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "2847097",
            "value": 2847097,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "2906528",
            "value": 2906528,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "2991980",
            "value": 2991980,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "3088079",
            "value": 3088079,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "3260085",
            "value": 3260085,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "3456155",
            "value": 3456155,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "3682609",
            "value": 3682609,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "3932658",
            "value": 3932658,
            "status": "VALUE"
          },
          {
            "period": "2026",
            "raw": "4199292",
            "value": 4199292,
            "status": "VALUE"
          },
          {
            "period": "2027",
            "raw": "4480645",
            "value": 4480645,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "기준중위소득 / 3인가구",
        "source_label": "기준중위소득 / 3인가구",
        "unit": "원/월",
        "points": [
          {
            "period": "2016",
            "raw": "3579019",
            "value": 3579019,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "3640915",
            "value": 3640915,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "3683150",
            "value": 3683150,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "3760032",
            "value": 3760032,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "3870577",
            "value": 3870577,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "3983950",
            "value": 3983950,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "4194701",
            "value": 4194701,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "4434816",
            "value": 4434816,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "4714657",
            "value": 4714657,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "5025353",
            "value": 5025353,
            "status": "VALUE"
          },
          {
            "period": "2026",
            "raw": "5359036",
            "value": 5359036,
            "status": "VALUE"
          },
          {
            "period": "2027",
            "raw": "5718091",
            "value": 5718091,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "기준중위소득 / 4인가구",
        "source_label": "기준중위소득 / 4인가구",
        "unit": "원/월",
        "points": [
          {
            "period": "2016",
            "raw": "4391434",
            "value": 4391434,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "4467380",
            "value": 4467380,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "4519202",
            "value": 4519202,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "4613536",
            "value": 4613536,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "4749174",
            "value": 4749174,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "4876290",
            "value": 4876290,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "5121080",
            "value": 5121080,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "5400964",
            "value": 5400964,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "5729913",
            "value": 5729913,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "6097773",
            "value": 6097773,
            "status": "VALUE"
          },
          {
            "period": "2026",
            "raw": "6494738",
            "value": 6494738,
            "status": "VALUE"
          },
          {
            "period": "2027",
            "raw": "6929885",
            "value": 6929885,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-5",
        "label": "기준중위소득 / 5인가구",
        "source_label": "기준중위소득 / 5인가구",
        "unit": "원/월",
        "points": [
          {
            "period": "2016",
            "raw": "5203849",
            "value": 5203849,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "5293845",
            "value": 5293845,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "5355254",
            "value": 5355254,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "5467040",
            "value": 5467040,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "5627771",
            "value": 5627771,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "5757373",
            "value": 5757373,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "6024515",
            "value": 6024515,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "6330688",
            "value": 6330688,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "6695735",
            "value": 6695735,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "7108192",
            "value": 7108192,
            "status": "VALUE"
          },
          {
            "period": "2026",
            "raw": "7556719",
            "value": 7556719,
            "status": "VALUE"
          },
          {
            "period": "2027",
            "raw": "8063019",
            "value": 8063019,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-6",
        "label": "기준중위소득 / 6인가구",
        "source_label": "기준중위소득 / 6인가구",
        "unit": "원/월",
        "points": [
          {
            "period": "2016",
            "raw": "6016265",
            "value": 6016265,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "6120311",
            "value": 6120311,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "6191307",
            "value": 6191307,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "6320544",
            "value": 6320544,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "6506368",
            "value": 6506368,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "6628603",
            "value": 6628603,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "6907004",
            "value": 6907004,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "7227981",
            "value": 7227981,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "7618369",
            "value": 7618369,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "8064805",
            "value": 8064805,
            "status": "VALUE"
          },
          {
            "period": "2026",
            "raw": "8555952",
            "value": 8555952,
            "status": "VALUE"
          },
          {
            "period": "2027",
            "raw": "9129201",
            "value": 9129201,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260821",
      "next_update": "20270831",
      "projection": false
    }
  },
  {
    "id": "stat:2759",
    "indicator_code": "2759",
    "table_code": "275901",
    "category": "사회보장",
    "title": "사회복지 지출규모",
    "description": "사회복지지출 단위는 10억원입니다. 2022년은 원문에 명시된 잠정치이며 지방자치단체 복지예산과 합산하지 않습니다.",
    "note": "사회복지지출 단위는 10억원입니다. 2022년은 원문에 명시된 잠정치이며 지방자치단체 복지예산과 합산하지 않습니다.",
    "highlight_series_id": "api-1",
    "original_unit": "10억원",
    "table_title": "사회복지 지출규모",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=2759&period=N&stts_cd=275901",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2759",
    "source_name": "OECD Social Expenditure Database.2026.03",
    "source_notes": "2022년 기준통계는 OECD에서 정식공표(2025.04월)된 결과이며, 2022년 자료는 잠정치임 - 본 통계는 OECD 요구 기준에 따른 우리나라의 사회복지 지출규모를 추계한 것으로서 OECD에서는 격년으로 자료를 요구(2년치 자료)하고 있으며, 각 회원국이 제출한 자료를 검토하여 OECD에서 격년으로 공표하고 있음 ※ 국민1인당 사회복지비용 : 사회복지지출액/총인구수",
    "periods": [
      "2016",
      "2017",
      "2018",
      "2019",
      "2020",
      "2021",
      "2022"
    ],
    "series": [
      {
        "id": "api-1",
        "label": "사회복지지출(C=A+B)",
        "source_label": "사회복지지출(C=A+B)",
        "unit": "10억원",
        "points": [
          {
            "period": "2016",
            "raw": "185507",
            "value": 185507,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "198616",
            "value": 198616,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "220552",
            "value": 220552,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "252375",
            "value": 252375,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "329162",
            "value": 329162,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "362025",
            "value": 362025,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "403194",
            "value": 403194,
            "status": "PROVISIONAL"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "공공부문(A)",
        "source_label": "공공부문(A)",
        "unit": "10억원",
        "points": [
          {
            "period": "2016",
            "raw": "169504",
            "value": 169504,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "183232",
            "value": 183232,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "204158",
            "value": 204158,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "233107",
            "value": 233107,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "306211",
            "value": 306211,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "338229",
            "value": 338229,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "377268",
            "value": 377268,
            "status": "PROVISIONAL"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "법정민간부문(B)",
        "source_label": "법정민간부문(B)",
        "unit": "10억원",
        "points": [
          {
            "period": "2016",
            "raw": "16002",
            "value": 16002,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "15384",
            "value": 15384,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "16394",
            "value": 16394,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "19268",
            "value": 19268,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "22951",
            "value": 22951,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "23796",
            "value": 23796,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "25926",
            "value": 25926,
            "status": "PROVISIONAL"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260721",
      "next_update": "20280429",
      "projection": false
    }
  },
  {
    "id": "stat:1430",
    "indicator_code": "1430",
    "table_code": "143001",
    "category": "노인",
    "title": "노년부양비",
    "description": "생산가능인구 100명당 65세 이상 인구입니다. 장래인구추계에 따른 값으로 미래 연도를 실측값으로 해석하지 마세요.",
    "note": "생산가능인구 100명당 65세 이상 인구입니다. 장래인구추계에 따른 값으로 미래 연도를 실측값으로 해석하지 마세요.",
    "highlight_series_id": "api-1",
    "original_unit": "15-64세 인구 100명당 65세 이상 인구",
    "table_title": "노년부양비",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=1430&period=N&stts_cd=143001",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1430",
    "source_name": "국가데이터처「장래인구추계(2017~2067), 국가승인통계 제10133호」, 2023.12.14. 공표 *장래인구추계는 5년 주기로 작성되어 2021년에 공표예정이었으나, 최근 초저출산 상황을 반영해 특별추계를 공표",
    "source_notes": "생산가능인구(15~64세) 100명에 대한 고령인구(65세 이상)의 비 * 노년부양비 = 고령인구(65세 이상) ÷ 생산가능인구(15~64세) ×100",
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
      "2025",
      "2026",
      "2027",
      "2028",
      "2029",
      "2030",
      "2031",
      "2032",
      "2033",
      "2034",
      "2035",
      "2036",
      "2037",
      "2038",
      "2039",
      "2040"
    ],
    "series": [
      {
        "id": "api-1",
        "label": "부양비",
        "source_label": "부양비",
        "unit": "15-64세 인구 100명당 65세 이상 인구",
        "points": [
          {
            "period": "2016",
            "raw": "18.0",
            "value": 18,
            "status": "ESTIMATE"
          },
          {
            "period": "2017",
            "raw": "18.8",
            "value": 18.8,
            "status": "ESTIMATE"
          },
          {
            "period": "2018",
            "raw": "19.6",
            "value": 19.6,
            "status": "ESTIMATE"
          },
          {
            "period": "2019",
            "raw": "20.4",
            "value": 20.4,
            "status": "ESTIMATE"
          },
          {
            "period": "2020",
            "raw": "21.8",
            "value": 21.8,
            "status": "ESTIMATE"
          },
          {
            "period": "2021",
            "raw": "23.1",
            "value": 23.1,
            "status": "ESTIMATE"
          },
          {
            "period": "2022",
            "raw": "24.6",
            "value": 24.6,
            "status": "ESTIMATE"
          },
          {
            "period": "2023",
            "raw": "26.1",
            "value": 26.1,
            "status": "ESTIMATE"
          },
          {
            "period": "2024",
            "raw": "27.8",
            "value": 27.8,
            "status": "ESTIMATE"
          },
          {
            "period": "2025",
            "raw": "29.3",
            "value": 29.3,
            "status": "ESTIMATE"
          },
          {
            "period": "2026",
            "raw": "31.3",
            "value": 31.3,
            "status": "ESTIMATE"
          },
          {
            "period": "2027",
            "raw": "33.0",
            "value": 33,
            "status": "ESTIMATE"
          },
          {
            "period": "2028",
            "raw": "34.8",
            "value": 34.8,
            "status": "ESTIMATE"
          },
          {
            "period": "2029",
            "raw": "36.3",
            "value": 36.3,
            "status": "ESTIMATE"
          },
          {
            "period": "2030",
            "raw": "38.0",
            "value": 38,
            "status": "ESTIMATE"
          },
          {
            "period": "2031",
            "raw": "39.7",
            "value": 39.7,
            "status": "ESTIMATE"
          },
          {
            "period": "2032",
            "raw": "41.4",
            "value": 41.4,
            "status": "ESTIMATE"
          },
          {
            "period": "2033",
            "raw": "43.2",
            "value": 43.2,
            "status": "ESTIMATE"
          },
          {
            "period": "2034",
            "raw": "45.5",
            "value": 45.5,
            "status": "ESTIMATE"
          },
          {
            "period": "2035",
            "raw": "47.7",
            "value": 47.7,
            "status": "ESTIMATE"
          },
          {
            "period": "2036",
            "raw": "50.1",
            "value": 50.1,
            "status": "ESTIMATE"
          },
          {
            "period": "2037",
            "raw": "52.4",
            "value": 52.4,
            "status": "ESTIMATE"
          },
          {
            "period": "2038",
            "raw": "54.7",
            "value": 54.7,
            "status": "ESTIMATE"
          },
          {
            "period": "2039",
            "raw": "57.1",
            "value": 57.1,
            "status": "ESTIMATE"
          },
          {
            "period": "2040",
            "raw": "59.1",
            "value": 59.1,
            "status": "ESTIMATE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260710",
      "next_update": "20270501",
      "projection": true
    }
  },
  {
    "id": "stat:2707",
    "indicator_code": "2707",
    "table_code": "270701",
    "category": "아동",
    "title": "아동급식지원 현황",
    "description": "18세 미만 아동급식 지원 인원입니다. 원문 기준에 따라 고등학교 재학 중인 18세 이상 아동도 포함합니다.",
    "note": "18세 미만 아동급식 지원 인원입니다. 원문 기준에 따라 고등학교 재학 중인 18세 이상 아동도 포함합니다.",
    "highlight_series_id": "api-1",
    "original_unit": "명",
    "table_title": "연도별 아동급식 지원 현황",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=2707&period=N&stts_cd=270701",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2707",
    "source_name": "사회보장통계정보시스템",
    "source_notes": "지원연령 : 18세 미만의 취학 및 미취학 아동 * 다만, 18세 이상인 경우에도 고등학교에 재학중인 아동 포함",
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
        "id": "api-1",
        "label": "인원",
        "source_label": "인원",
        "unit": "명",
        "points": [
          {
            "period": "2016",
            "raw": "332865",
            "value": 332865,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "317234",
            "value": 317234,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "357127",
            "value": 357127,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "330014",
            "value": 330014,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "308440",
            "value": 308440,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "302231",
            "value": 302231,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "283858",
            "value": 283858,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "277394",
            "value": 277394,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "272400",
            "value": 272400,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "272646",
            "value": 272646,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260202",
      "next_update": "20270203",
      "projection": false
    }
  },
  {
    "id": "stat:2768",
    "indicator_code": "2768",
    "table_code": "276801",
    "category": "장애인",
    "title": "장애인 현황",
    "description": "등록장애인 수는 천명 단위입니다. 장애유형별 분류와 제도 변경은 원문 주석을 확인하세요.",
    "note": "등록장애인 수는 천명 단위입니다. 장애유형별 분류와 제도 변경은 원문 주석을 확인하세요.",
    "highlight_series_id": "api-1",
    "original_unit": "천명",
    "table_title": "등록장애인 수",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=2768&period=N&stts_cd=276801",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2768",
    "source_name": "보건복지부 (시.도 장애인등록현황 자료)",
    "source_notes": "* 1차 장애범주 확대(2000. 1): 뇌병변장애, 발달장애, 정신장애, 신장장애, 심장장애 포함* 2차 장애범주 확대(2003. 7): 호흡기장애, 간장애, 안면장애, 장루.요루장애, 간질장애 포함 ※ 발달장애는 자폐성장애, 정신지체는 지적장애로 명칭 변경(2007.4), 간질장애는 뇌전증장애로 명칭 변경(2015.11) *현재 장애유형은 지체,뇌병변,시각,청각,언어,지적,정신,자폐성,신장,심장,호흡기,간,안면,장루요루,뇌전증의 15가지 유형임 * 장애등급제 폐지(2019.7)",
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
        "id": "api-1",
        "label": "등록 장애인수 / 계",
        "source_label": "등록 장애인수 / 계",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "2511",
            "value": 2511,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "2546",
            "value": 2546,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "2585",
            "value": 2585,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "2618",
            "value": 2618,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "2632",
            "value": 2632,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "2642",
            "value": 2642,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "2643",
            "value": 2643,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "2633",
            "value": 2633,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "2631",
            "value": 2631,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "2628",
            "value": 2628,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "등록 장애인수 / 지체장애",
        "source_label": "등록 장애인수 / 지체장애",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "1267",
            "value": 1267,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "1254",
            "value": 1254,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "1238",
            "value": 1238,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "1223",
            "value": 1223,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "1207",
            "value": 1207,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1191",
            "value": 1191,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "1173",
            "value": 1173,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "1151",
            "value": 1151,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "1133",
            "value": 1133,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "1114",
            "value": 1114,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "등록 장애인수 / 시각장애",
        "source_label": "등록 장애인수 / 시각장애",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "252",
            "value": 252,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "253",
            "value": 253,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "252",
            "value": 252,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "253",
            "value": 253,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "252",
            "value": 252,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "251",
            "value": 251,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "250",
            "value": 250,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "247",
            "value": 247,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "246",
            "value": 246,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "245",
            "value": 245,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "등록 장애인수 / 청각,언어",
        "source_label": "등록 장애인수 / 청각,언어",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "291",
            "value": 291,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "322",
            "value": 322,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "363",
            "value": 363,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "398",
            "value": 398,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "418",
            "value": 418,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "434",
            "value": 434,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "446",
            "value": 446,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "454",
            "value": 454,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "464",
            "value": 464,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "471",
            "value": 471,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-5",
        "label": "등록 장애인수 / 지적장애",
        "source_label": "등록 장애인수 / 지적장애",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "195",
            "value": 195,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "201",
            "value": 201,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "206",
            "value": 206,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "212",
            "value": 212,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "217",
            "value": 217,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "221",
            "value": 221,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "225",
            "value": 225,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "229",
            "value": 229,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "233",
            "value": 233,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "237",
            "value": 237,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-6",
        "label": "등록 장애인수 / 뇌병변장애",
        "source_label": "등록 장애인수 / 뇌병변장애",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "251",
            "value": 251,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "253",
            "value": 253,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "253",
            "value": 253,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "252",
            "value": 252,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "250",
            "value": 250,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "247",
            "value": 247,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "242",
            "value": 242,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "237",
            "value": 237,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "235",
            "value": 235,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "233",
            "value": 233,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-7",
        "label": "등록 장애인수 / 자폐성장애",
        "source_label": "등록 장애인수 / 자폐성장애",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "23",
            "value": 23,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "24",
            "value": 24,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "26",
            "value": 26,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "28",
            "value": 28,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "30",
            "value": 30,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "33",
            "value": 33,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "37",
            "value": 37,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "42",
            "value": 42,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "47",
            "value": 47,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "52",
            "value": 52,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-8",
        "label": "등록 장애인수 / 정신장애",
        "source_label": "등록 장애인수 / 정신장애",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "100",
            "value": 100,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "101",
            "value": 101,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "102",
            "value": 102,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "102",
            "value": 102,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "103",
            "value": 103,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "104",
            "value": 104,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "104",
            "value": 104,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "103",
            "value": 103,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "103",
            "value": 103,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "103",
            "value": 103,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-9",
        "label": "등록 장애인수 / 신장장애",
        "source_label": "등록 장애인수 / 신장장애",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "79",
            "value": 79,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "84",
            "value": 84,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "87",
            "value": 87,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "92",
            "value": 92,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "97",
            "value": 97,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "102",
            "value": 102,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "105",
            "value": 105,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "107",
            "value": 107,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "111",
            "value": 111,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "115",
            "value": 115,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-10",
        "label": "등록 장애인수 / 심장장애",
        "source_label": "등록 장애인수 / 심장장애",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "6",
            "value": 6,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "6",
            "value": 6,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "5",
            "value": 5,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "5",
            "value": 5,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "5",
            "value": 5,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "5",
            "value": 5,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "5",
            "value": 5,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "4",
            "value": 4,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "5",
            "value": 5,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "5",
            "value": 5,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-11",
        "label": "등록 장애인수 / 호흡기장애",
        "source_label": "등록 장애인수 / 호흡기장애",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "12",
            "value": 12,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "12",
            "value": 12,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "11",
            "value": 11,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "11",
            "value": 11,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "11",
            "value": 11,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "11",
            "value": 11,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "11",
            "value": 11,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "10",
            "value": 10,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "11",
            "value": 11,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "10",
            "value": 10,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-12",
        "label": "등록 장애인수 / 간장애",
        "source_label": "등록 장애인수 / 간장애",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "11",
            "value": 11,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "11",
            "value": 11,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "12",
            "value": 12,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "13",
            "value": 13,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "13",
            "value": 13,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "14",
            "value": 14,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "15",
            "value": 15,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "15",
            "value": 15,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "16",
            "value": 16,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "16",
            "value": 16,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-13",
        "label": "등록 장애인수 / 안면장애",
        "source_label": "등록 장애인수 / 안면장애",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "3",
            "value": 3,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "3",
            "value": 3,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "2",
            "value": 2,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "2",
            "value": 2,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "2",
            "value": 2,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "2",
            "value": 2,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "2",
            "value": 2,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "2",
            "value": 2,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "3",
            "value": 3,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "3",
            "value": 3,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-14",
        "label": "등록 장애인수 / 장루,요루장애",
        "source_label": "등록 장애인수 / 장루,요루장애",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "14",
            "value": 14,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "15",
            "value": 15,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "15",
            "value": 15,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "15",
            "value": 15,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "15",
            "value": 15,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "16",
            "value": 16,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "16",
            "value": 16,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "17",
            "value": 17,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "17",
            "value": 17,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "18",
            "value": 18,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-15",
        "label": "등록 장애인수 / 뇌전증장애",
        "source_label": "등록 장애인수 / 뇌전증장애",
        "unit": "천명",
        "points": [
          {
            "period": "2016",
            "raw": "7",
            "value": 7,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "7",
            "value": 7,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "7",
            "value": 7,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "7",
            "value": 7,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "7",
            "value": 7,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "7",
            "value": 7,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "7",
            "value": 7,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "6",
            "value": 6,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "7",
            "value": 7,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "7",
            "value": 7,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260526",
      "next_update": "20270531",
      "projection": false
    }
  },
  {
    "id": "stat:2773",
    "indicator_code": "2773",
    "table_code": "277301",
    "category": "장애인",
    "title": "장애인복지시설 및 사업현황",
    "description": "장애인복지시설 수입니다. 시설 유형별 개소를 표시하며 이용자 수와 다릅니다.",
    "note": "장애인복지시설 수입니다. 시설 유형별 개소를 표시하며 이용자 수와 다릅니다.",
    "highlight_series_id": "api-1",
    "original_unit": "개소",
    "table_title": "장애인복지시설 현황",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=2773&period=N&stts_cd=277301",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2773",
    "source_name": "보건복지통계연보",
    "source_notes": "원문에 별도 주석이 제공되지 않습니다.",
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
        "id": "api-1",
        "label": "장애인거주시설",
        "source_label": "장애인거주시설",
        "unit": "개소",
        "points": [
          {
            "period": "2016",
            "raw": "1505",
            "value": 1505,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "1517",
            "value": 1517,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "1527",
            "value": 1527,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "1557",
            "value": 1557,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "1539",
            "value": 1539,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1535",
            "value": 1535,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "1532",
            "value": 1532,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "1529",
            "value": 1529,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "1524",
            "value": 1524,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "1516",
            "value": 1516,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "장애인직업재활시설",
        "source_label": "장애인직업재활시설",
        "unit": "개소",
        "points": [
          {
            "period": "2016",
            "raw": "582",
            "value": 582,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "625",
            "value": 625,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "651",
            "value": 651,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "683",
            "value": 683,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "720",
            "value": 720,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "773",
            "value": 773,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "792",
            "value": 792,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "811",
            "value": 811,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "815",
            "value": 815,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "장애인지역사회재활시설",
        "source_label": "장애인지역사회재활시설",
        "unit": "개소",
        "points": [
          {
            "period": "2016",
            "raw": "1303",
            "value": 1303,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "1333",
            "value": 1333,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "1373",
            "value": 1373,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "1486",
            "value": 1486,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "1519",
            "value": 1519,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1568",
            "value": 1568,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "1601",
            "value": 1601,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "1602",
            "value": 1602,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "1609",
            "value": 1609,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "장애인생산품판매시설",
        "source_label": "장애인생산품판매시설",
        "unit": "개소",
        "points": [
          {
            "period": "2016",
            "raw": "17",
            "value": 17,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "17",
            "value": 17,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "17",
            "value": 17,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "17",
            "value": 17,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "17",
            "value": 17,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "17",
            "value": 17,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "17",
            "value": 17,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "17",
            "value": 17,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "17",
            "value": 17,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-5",
        "label": "장애인의료재활시설",
        "source_label": "장애인의료재활시설",
        "unit": "개소",
        "points": [
          {
            "period": "2016",
            "raw": "20",
            "value": 20,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "19",
            "value": 19,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "19",
            "value": 19,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "18",
            "value": 18,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "18",
            "value": 18,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "18",
            "value": 18,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "18",
            "value": 18,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "19",
            "value": 19,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "19",
            "value": 19,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260519",
      "next_update": "20260630",
      "projection": false
    }
  },
  {
    "id": "stat:1404",
    "indicator_code": "1404",
    "table_code": "140401",
    "category": "사회보장",
    "title": "보건복지부 일반회계 예산현황",
    "description": "보건복지부 일반회계 예산 지표입니다. 연도별 업무 이관이 있으며 지방재정365 복지예산과 합산하지 않습니다.",
    "note": "보건복지부 일반회계 예산 지표입니다. 연도별 업무 이관이 있으며 지방재정365 복지예산과 합산하지 않습니다.",
    "highlight_series_id": "api-1",
    "original_unit": "조원, %",
    "table_title": "보건복지 예산 현황",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=1404&period=N&stts_cd=140401",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1404",
    "source_name": "보건복지부 (연도별 일반회계 예산자료)",
    "source_notes": "* 2005년 예산증가율 감소 원인 : 지방이양(67개 사업) 0.7조원, 보육사업 여성부 이관 등 0.5조원 * 2025년 예산증가율 감소 원인 : 보육 업무 교육부 이관('24.6.27)됨에 '25년 예산에서 제외('24년 예산에서 보육 예산 5.33조원 제외 시 전년 대비 7.2% 증가)",
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
      "2025",
      "2026"
    ],
    "series": [
      {
        "id": "api-1",
        "label": "보건복지예산",
        "source_label": "보건복지예산",
        "unit": "조원",
        "points": [
          {
            "period": "2016",
            "raw": "33.1",
            "value": 33.1,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "34.1",
            "value": 34.1,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "37.3",
            "value": 37.3,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "44.8",
            "value": 44.8,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "54.5",
            "value": 54.5,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "55.3",
            "value": 55.3,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "61.8",
            "value": 61.8,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "66.4",
            "value": 66.4,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "72.2",
            "value": 72.2,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "70.6",
            "value": 70.6,
            "status": "VALUE"
          },
          {
            "period": "2026",
            "raw": "73.3",
            "value": 73.3,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "보건복지예산증가율",
        "source_label": "보건복지예산증가율",
        "unit": "%",
        "points": [
          {
            "period": "2016",
            "raw": "0",
            "value": 0,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "2.9",
            "value": 2.9,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "9.4",
            "value": 9.4,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "20.1",
            "value": 20.1,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "6.4",
            "value": 6.4,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1.4",
            "value": 1.4,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "11.8",
            "value": 11.8,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "7.5",
            "value": 7.5,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "8.8",
            "value": 8.8,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "-2.3",
            "value": -2.3,
            "status": "VALUE"
          },
          {
            "period": "2026",
            "raw": "3.8",
            "value": 3.8,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260220",
      "next_update": "20270129",
      "projection": false
    }
  },
  {
    "id": "stat:2758",
    "indicator_code": "2758",
    "table_code": "275801",
    "category": "보건·의료",
    "title": "기대수명(0세 기대여명) 및 유병기간 제외 기대수명(건강수명)",
    "description": "기대수명과 유병기간 제외 기대수명입니다. 건강수명은 공표 주기가 달라 결측이 있으며 0으로 해석하지 않습니다.",
    "note": "기대수명과 유병기간 제외 기대수명입니다. 건강수명은 공표 주기가 달라 결측이 있으며 0으로 해석하지 않습니다.",
    "highlight_series_id": "api-1",
    "original_unit": "년",
    "table_title": "기대수명(0세 기대여명) 및 유병기간 제외 기대수명(건강수명) 추이",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=2758&period=N&stts_cd=275801",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2758",
    "source_name": "국가데이터처,「생명표, 국가승인통계 제101035호」",
    "source_notes": "위 자료는 2025.12.3일에 수치가 변경되었음 - 평균수명 출처 : 통계청 <생명표> 매년 12월 업데이트 예정 - 건강수명 출처 :통계청 <생명표> 격년 12월 업데이트 예정",
    "periods": [
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
        "id": "api-1",
        "label": "기대수명 / 계",
        "source_label": "기대수명 / 계",
        "unit": "년",
        "points": [
          {
            "period": "2016",
            "raw": "82.4",
            "value": 82.4,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "82.7",
            "value": 82.7,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "82.7",
            "value": 82.7,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "83.3",
            "value": 83.3,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "83.5",
            "value": 83.5,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "83.6",
            "value": 83.6,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "82.7",
            "value": 82.7,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "83.5",
            "value": 83.5,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "83.7",
            "value": 83.7,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "기대수명 / 남자",
        "source_label": "기대수명 / 남자",
        "unit": "년",
        "points": [
          {
            "period": "2016",
            "raw": "79.3",
            "value": 79.3,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "79.7",
            "value": 79.7,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "79.7",
            "value": 79.7,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "80.3",
            "value": 80.3,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "80.5",
            "value": 80.5,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "80.6",
            "value": 80.6,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "79.9",
            "value": 79.9,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "80.6",
            "value": 80.6,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "80.8",
            "value": 80.8,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "기대수명 / 여자",
        "source_label": "기대수명 / 여자",
        "unit": "년",
        "points": [
          {
            "period": "2016",
            "raw": "85.4",
            "value": 85.4,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "85.7",
            "value": 85.7,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "85.7",
            "value": 85.7,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "86.3",
            "value": 86.3,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "86.5",
            "value": 86.5,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "86.6",
            "value": 86.6,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "85.6",
            "value": 85.6,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "86.4",
            "value": 86.4,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "86.6",
            "value": 86.6,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "유병기간제외 기대수명(건강수명)",
        "source_label": "유병기간제외 기대수명(건강수명)",
        "unit": "년",
        "points": [
          {
            "period": "2016",
            "raw": "64.9",
            "value": 64.9,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2018",
            "raw": "64.4",
            "value": 64.4,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2020",
            "raw": "66.3",
            "value": 66.3,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2022",
            "raw": "65.8",
            "value": 65.8,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2024",
            "raw": "65.5",
            "value": 65.5,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260710",
      "next_update": "20261225",
      "projection": false
    }
  },
  {
    "id": "stat:2764",
    "indicator_code": "2764",
    "table_code": "276401",
    "category": "사회보장",
    "title": "국민연금 재정현황",
    "description": "국민연금 기금 조성·지출·운용 현황입니다. 단위는 억원이며 운용수익 등에 음수가 수록될 수 있습니다.",
    "note": "국민연금 기금 조성·지출·운용 현황입니다. 단위는 억원이며 운용수익 등에 음수가 수록될 수 있습니다.",
    "highlight_series_id": "api-1",
    "original_unit": "억원",
    "table_title": "국민연금 재정현황",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=2764&period=N&stts_cd=276401",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2764",
    "source_name": "보건복지부 (국민연금공단 자료)",
    "source_notes": "* 1988~2024 누계 : (조성) 1,212.9조원, (지출) 383.9조원 * 운용(기타)는 공단회관취득비와 임차보증금, 기금보관분을 합한 금액임",
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
        "id": "api-1",
        "label": "국민연금 재정 / 조성",
        "source_label": "국민연금 재정 / 조성",
        "unit": "억원",
        "points": [
          {
            "period": "2016",
            "raw": "636277",
            "value": 636277,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "830505",
            "value": 830505,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "385347",
            "value": 385347,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "1213056",
            "value": 1213056,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "1234331",
            "value": 1234331,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1448668",
            "value": 1448668,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "-234328",
            "value": -234328,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "1852021",
            "value": 1852021,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "2215951",
            "value": 2215951,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "2956258",
            "value": 2956258,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "국민연금 재정 / 연금보험료",
        "source_label": "국민연금 재정 / 연금보험료",
        "unit": "억원",
        "points": [
          {
            "period": "2016",
            "raw": "390359",
            "value": 390359,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "417849",
            "value": 417849,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "443735",
            "value": 443735,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "478001",
            "value": 478001,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "512172",
            "value": 512172,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "535402",
            "value": 535402,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "559140",
            "value": 559140,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "583698",
            "value": 583698,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "617392",
            "value": 617392,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "638803",
            "value": 638803,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "국민연금 재정 / 운용수익",
        "source_label": "국민연금 재정 / 운용수익",
        "unit": "억원",
        "points": [
          {
            "period": "2016",
            "raw": "245439",
            "value": 245439,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "411941",
            "value": 411941,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "-58671",
            "value": -58671,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "734247",
            "value": 734247,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "721437",
            "value": 721437,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "912144",
            "value": 912144,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "-795518",
            "value": -795518,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "1267153",
            "value": 1267153,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "1597115",
            "value": 1597115,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "2316343",
            "value": 2316343,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "국민연금 재정 / 국고보조금 등",
        "source_label": "국민연금 재정 / 국고보조금 등",
        "unit": "억원",
        "points": [
          {
            "period": "2016",
            "raw": "479",
            "value": 479,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "715",
            "value": 715,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "284",
            "value": 284,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "809",
            "value": 809,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "722",
            "value": 722,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1122",
            "value": 1122,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "2049",
            "value": 2049,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "1170",
            "value": 1170,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "1443",
            "value": 1443,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "1112",
            "value": 1112,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-5",
        "label": "국민연금 재정 / 지출",
        "source_label": "국민연금 재정 / 지출",
        "unit": "억원",
        "points": [
          {
            "period": "2016",
            "raw": "176527",
            "value": 176527,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "197074",
            "value": 197074,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "213958",
            "value": 213958,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "234329",
            "value": 234329,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "263593",
            "value": 263593,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "298751",
            "value": 298751,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "348208",
            "value": 348208,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "398732",
            "value": 398732,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "445384",
            "value": 445384,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "504808",
            "value": 504808,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-6",
        "label": "국민연금 재정 / 연금급여지급",
        "source_label": "국민연금 재정 / 연금급여지급",
        "unit": "억원",
        "points": [
          {
            "period": "2016",
            "raw": "170682",
            "value": 170682,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "190839",
            "value": 190839,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "207527",
            "value": 207527,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "227643",
            "value": 227643,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "256541",
            "value": 256541,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "291368",
            "value": 291368,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "340201",
            "value": 340201,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "390402",
            "value": 390402,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "437048",
            "value": 437048,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "496605",
            "value": 496605,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-7",
        "label": "국민연금 재정 / 관리운영비 등",
        "source_label": "국민연금 재정 / 관리운영비 등",
        "unit": "억원",
        "points": [
          {
            "period": "2016",
            "raw": "5845",
            "value": 5845,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "6235",
            "value": 6235,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "6431",
            "value": 6431,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "6685",
            "value": 6685,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "7052",
            "value": 7052,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "7383",
            "value": 7383,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "8007",
            "value": 8007,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "8329",
            "value": 8329,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "8336",
            "value": 8336,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "8204",
            "value": 8204,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-8",
        "label": "국민연금 재정 / 기금 증가분",
        "source_label": "국민연금 재정 / 기금 증가분",
        "unit": "억원",
        "points": [
          {
            "period": "2016",
            "raw": "459750",
            "value": 459750,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "633431",
            "value": 633431,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "171389",
            "value": 171389,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "978727",
            "value": 978727,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "970738",
            "value": 970738,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1149917",
            "value": 1149917,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "-582536",
            "value": -582536,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "1453289",
            "value": 1453289,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "1770567",
            "value": 1770567,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "2451450",
            "value": 2451450,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-9",
        "label": "국민연금 재정 / 기금 운용",
        "source_label": "국민연금 재정 / 기금 운용",
        "unit": "억원",
        "points": [
          {
            "period": "2016",
            "raw": "5582991",
            "value": 5582991,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "6216422",
            "value": 6216422,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "6387811",
            "value": 6387811,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "7366538",
            "value": 7366538,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "8337276",
            "value": 8337276,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "9487194",
            "value": 9487194,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "8904657",
            "value": 8904657,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "10537946",
            "value": 10537946,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "12128513",
            "value": 12128513,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "14579963",
            "value": 14579963,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-10",
        "label": "국민연금 재정 / 공공부문",
        "source_label": "국민연금 재정 / 공공부문",
        "unit": "억원",
        "points": [
          {
            "period": "2016",
            "raw": "0",
            "value": 0,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "0",
            "value": 0,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "0",
            "value": 0,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "0",
            "value": 0,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "0",
            "value": 0,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "0",
            "value": 0,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "0",
            "value": 0,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "0",
            "value": 0,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "0",
            "value": 0,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "0",
            "value": 0,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-11",
        "label": "국민연금 재정 / 복지부문",
        "source_label": "국민연금 재정 / 복지부문",
        "unit": "억원",
        "points": [
          {
            "period": "2016",
            "raw": "1396",
            "value": 1396,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "1433",
            "value": 1433,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "1446",
            "value": 1446,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "1663",
            "value": 1663,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "1800",
            "value": 1800,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "2005",
            "value": 2005,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "2036",
            "value": 2036,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "2024",
            "value": 2024,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "2051",
            "value": 2051,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "2157",
            "value": 2157,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-12",
        "label": "국민연금 재정 / 금융부문",
        "source_label": "국민연금 재정 / 금융부문",
        "unit": "억원",
        "points": [
          {
            "period": "2016",
            "raw": "5576819",
            "value": 5576819,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "6210182",
            "value": 6210182,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "6382168",
            "value": 6382168,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "7360790",
            "value": 7360790,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "8331384",
            "value": 8331384,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "9481060",
            "value": 9481060,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "8898353",
            "value": 8898353,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "10351976",
            "value": 10351976,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "12122568",
            "value": 12122568,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "14574885",
            "value": 14574885,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-13",
        "label": "국민연금 재정 / 기타",
        "source_label": "국민연금 재정 / 기타",
        "unit": "억원",
        "points": [
          {
            "period": "2016",
            "raw": "4777",
            "value": 4777,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "4806",
            "value": 4806,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "4196",
            "value": 4196,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "4085",
            "value": 4085,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "4092",
            "value": 4092,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "4128",
            "value": 4128,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "4267",
            "value": 4267,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "3946",
            "value": 3946,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "3895",
            "value": 3895,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "2920",
            "value": 2920,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260401",
      "next_update": "20270401",
      "projection": false
    }
  },
  {
    "id": "stat:2763",
    "indicator_code": "2763",
    "table_code": "276305",
    "category": "보건·의료",
    "title": "건강보험 재정 및 급여율",
    "description": "현금흐름 기준 건강보험 재정현황입니다. 금액은 조원, 수지율은 %로 구분합니다.",
    "note": "현금흐름 기준 건강보험 재정현황입니다. 금액은 조원, 수지율은 %로 구분합니다.",
    "highlight_series_id": "api-1",
    "original_unit": "조원, %",
    "table_title": "건강보험 재정현황",
    "source_url": "https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=2763&period=N&stts_cd=276305",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2763",
    "source_name": "보건복지부 (국민건강보험공단 자료)",
    "source_notes": "현금흐름기준, '보험료수입 등'은 보험료수입과 기타수입을 포함",
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
        "id": "api-1",
        "label": "건강보험 재정수지 / 수입",
        "source_label": "건강보험 재정수지 / 수입",
        "unit": "조원",
        "points": [
          {
            "period": "2016",
            "raw": "55.7",
            "value": 55.7,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "58.0",
            "value": 58,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "62.1",
            "value": 62.1,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "68.1",
            "value": 68.1,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "73.4",
            "value": 73.4,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "80.5",
            "value": 80.5,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "88.8",
            "value": 88.8,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "94.9",
            "value": 94.9,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "99.1",
            "value": 99.1,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "102.9",
            "value": 102.9,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "건강보험 재정수지 / 보험료수입 등",
        "source_label": "건강보험 재정수지 / 보험료수입 등",
        "unit": "조원",
        "points": [
          {
            "period": "2016",
            "raw": "48.6",
            "value": 48.6,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "51.2",
            "value": 51.2,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "55.0",
            "value": 55,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "60.3",
            "value": 60.3,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "64.2",
            "value": 64.2,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "70.9",
            "value": 70.9,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "78.3",
            "value": 78.3,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "83.9",
            "value": 83.9,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "86.9",
            "value": 86.9,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "90.4",
            "value": 90.4,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "건강보험 재정수지 / 정부지원",
        "source_label": "건강보험 재정수지 / 정부지원",
        "unit": "조원",
        "points": [
          {
            "period": "2016",
            "raw": "7.1",
            "value": 7.1,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "6.8",
            "value": 6.8,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "7.1",
            "value": 7.1,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "7.8",
            "value": 7.8,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "9.2",
            "value": 9.2,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "9.6",
            "value": 9.6,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "10.5",
            "value": 10.5,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "11.0",
            "value": 11,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "12.2",
            "value": 12.2,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "12.5",
            "value": 12.5,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "건강보험 재정수지 / 국고",
        "source_label": "건강보험 재정수지 / 국고",
        "unit": "조원",
        "points": [
          {
            "period": "2016",
            "raw": "5.2",
            "value": 5.2,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "4.9",
            "value": 4.9,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "5.2",
            "value": 5.2,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "6.0",
            "value": 6,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "7.3",
            "value": 7.3,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "7.7",
            "value": 7.7,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "8.7",
            "value": 8.7,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "9.1",
            "value": 9.1,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "10.3",
            "value": 10.3,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "10.7",
            "value": 10.7,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-5",
        "label": "건강보험 재정수지 / 국민증진기금",
        "source_label": "건강보험 재정수지 / 국민증진기금",
        "unit": "조원",
        "points": [
          {
            "period": "2016",
            "raw": "1.9",
            "value": 1.9,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "1.9",
            "value": 1.9,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "1.9",
            "value": 1.9,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "1.8",
            "value": 1.8,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "1.9",
            "value": 1.9,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1.9",
            "value": 1.9,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "1.8",
            "value": 1.8,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "1.8",
            "value": 1.8,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "1.9",
            "value": 1.9,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "1.8",
            "value": 1.8,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-6",
        "label": "건강보험 재정수지 / 지출",
        "source_label": "건강보험 재정수지 / 지출",
        "unit": "조원",
        "points": [
          {
            "period": "2016",
            "raw": "52.6",
            "value": 52.6,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "57.3",
            "value": 57.3,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "62.3",
            "value": 62.3,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "70.9",
            "value": 70.9,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "73.8",
            "value": 73.8,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "77.7",
            "value": 77.7,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "85.1",
            "value": 85.1,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "90.8",
            "value": 90.8,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "97.4",
            "value": 97.4,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "102.4",
            "value": 102.4,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-7",
        "label": "건강보험 재정수지 / 보험급여비",
        "source_label": "건강보험 재정수지 / 보험급여비",
        "unit": "조원",
        "points": [
          {
            "period": "2016",
            "raw": "51.1",
            "value": 51.1,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "55.5",
            "value": 55.5,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "60.6",
            "value": 60.6,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "69",
            "value": 69,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "71.0",
            "value": 71,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "76.6",
            "value": 76.6,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "83.2",
            "value": 83.2,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "88.8",
            "value": 88.8,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "95.3",
            "value": 95.3,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "100.2",
            "value": 100.2,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-8",
        "label": "건강보험 재정수지 / 관리운영비 등",
        "source_label": "건강보험 재정수지 / 관리운영비 등",
        "unit": "조원",
        "points": [
          {
            "period": "2016",
            "raw": "1.6",
            "value": 1.6,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "1.8",
            "value": 1.8,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "1.7",
            "value": 1.7,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "1.8",
            "value": 1.8,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "1.9",
            "value": 1.9,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1.9",
            "value": 1.9,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "1.9",
            "value": 1.9,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "2.0",
            "value": 2,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "2.1",
            "value": 2.1,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "2.2",
            "value": 2.2,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-9",
        "label": "건강보험 재정수지 / 당기수지",
        "source_label": "건강보험 재정수지 / 당기수지",
        "unit": "조원",
        "points": [
          {
            "period": "2016",
            "raw": "3.1",
            "value": 3.1,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "0.7",
            "value": 0.7,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "-0.2",
            "value": -0.2,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "-2.8",
            "value": -2.8,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "-0.4",
            "value": -0.4,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "2.8",
            "value": 2.8,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "3.6",
            "value": 3.6,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "4.1",
            "value": 4.1,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "1.7",
            "value": 1.7,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "0.5",
            "value": 0.5,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-10",
        "label": "건강보험 재정수지 / 누적수지",
        "source_label": "건강보험 재정수지 / 누적수지",
        "unit": "조원",
        "points": [
          {
            "period": "2016",
            "raw": "20.1",
            "value": 20.1,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "20.8",
            "value": 20.8,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "20.6",
            "value": 20.6,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "17.8",
            "value": 17.8,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "17.4",
            "value": 17.4,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "20.2",
            "value": 20.2,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "23.9",
            "value": 23.9,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "28.0",
            "value": 28,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "29.7",
            "value": 29.7,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "30.2",
            "value": 30.2,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-11",
        "label": "건강보험 재정수지 / 수지율(지출/수입)",
        "source_label": "건강보험 재정수지 / 수지율(지출/수입)",
        "unit": "%",
        "points": [
          {
            "period": "2016",
            "raw": "94.4",
            "value": 94.4,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "98.8",
            "value": 98.8,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "100.3",
            "value": 100.3,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "104.1",
            "value": 104.1,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "100.5",
            "value": 100.5,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "96.6",
            "value": 96.6,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "95.9",
            "value": 95.9,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "95.7",
            "value": 95.7,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "98.3",
            "value": 98.3,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "99.5",
            "value": 99.5,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260921",
      "next_update": "20270430",
      "projection": false
    }
  }
];

const INDEX_BASE_SERIES: Readonly<Record<string, readonly { id: string; key: string; label: string; table_code?: string }[]>> = {
  "stat:2760": [
    {
      "id": "row-1",
      "key": "|T01|||",
      "label": "수급자 수"
    },
    {
      "id": "row-2",
      "key": "|T02|||",
      "label": "수급률"
    }
  ],
  "stat:1406": [
    {
      "id": "row-1",
      "key": "|T01|||",
      "label": "의료급여 수급자수"
    },
    {
      "id": "row-2",
      "key": "|T02|||",
      "label": "수급률"
    }
  ],
  "stat:3053": [
    {
      "id": "row-1",
      "key": "|T01|||",
      "label": "총 인구수"
    },
    {
      "id": "row-2",
      "key": "|T03|||",
      "label": "아동 인구수"
    },
    {
      "id": "row-3",
      "key": "|T04|||",
      "label": "비율(구성비)"
    }
  ],
  "stat:2709": [
    {
      "id": "row-1",
      "key": "|T01|||",
      "label": "계"
    },
    {
      "id": "row-2",
      "key": "|T02|||",
      "label": "노령연금수급자"
    },
    {
      "id": "row-3",
      "key": "|T03|||",
      "label": "장애연금수급자"
    },
    {
      "id": "row-4",
      "key": "|T04|||",
      "label": "유족연금수급자"
    }
  ],
  "stat:2766": [
    {
      "id": "row-1",
      "key": "G01|T01|||",
      "label": "노인주거복지시설 / 소계"
    },
    {
      "id": "row-2",
      "key": "G01|T02|||",
      "label": "노인주거복지시설 / 양로시설"
    },
    {
      "id": "row-3",
      "key": "G01|T03|||",
      "label": "노인주거복지시설 / 노인공동생활가정"
    },
    {
      "id": "row-4",
      "key": "G01|T04|||",
      "label": "노인주거복지시설 / 노인복지주택"
    },
    {
      "id": "row-5",
      "key": "G02|T05|||",
      "label": "노인의료복지시설 / 소계"
    },
    {
      "id": "row-6",
      "key": "G02|T06|||",
      "label": "노인의료복지시설 / 노인요양시설"
    },
    {
      "id": "row-7",
      "key": "G02|T07|||",
      "label": "노인의료복지시설 / 노인요양공동생활가정"
    },
    {
      "id": "row-8",
      "key": "G03|T09|||",
      "label": "노인여가복지시설 / 소계"
    },
    {
      "id": "row-9",
      "key": "G03|T10|||",
      "label": "노인여가복지시설 / 노인복지관"
    },
    {
      "id": "row-10",
      "key": "G03|T11|||",
      "label": "노인여가복지시설 / 경로당"
    },
    {
      "id": "row-11",
      "key": "G03|T12|||",
      "label": "노인여가복지시설 / 노인교실"
    },
    {
      "id": "row-12",
      "key": "G04|T14|||",
      "label": "재가노인복지시설 / 소계"
    },
    {
      "id": "row-13",
      "key": "G04|T15|||",
      "label": "재가노인복지시설 / 방문요양서비스"
    },
    {
      "id": "row-14",
      "key": "G04|T16|||",
      "label": "재가노인복지시설 / 주야간보호서비스"
    },
    {
      "id": "row-15",
      "key": "G04|T17|||",
      "label": "재가노인복지시설 / 단기보호서비스"
    },
    {
      "id": "row-16",
      "key": "G04|T18|||",
      "label": "재가노인복지시설 / 방문목욕서비스"
    },
    {
      "id": "row-17",
      "key": "G04|T25|||",
      "label": "재가노인복지시설 / 방문간호서비스"
    },
    {
      "id": "row-18",
      "key": "G04|T26|||",
      "label": "재가노인복지시설 / 복지용구지원서비스"
    },
    {
      "id": "row-19",
      "key": "G04|T20|||",
      "label": "재가노인복지시설 / 재가지원서비스"
    },
    {
      "id": "row-20",
      "key": "G05|T23|||",
      "label": "노인보호전문기관"
    },
    {
      "id": "row-21",
      "key": "G06|T24|||",
      "label": "노인일자리지원기관"
    },
    {
      "id": "row-22",
      "key": "G07|T27|||",
      "label": "학대피해노인 전용쉼터"
    },
    {
      "id": "row-23",
      "key": "|T19|||",
      "label": "합계"
    }
  ],
  "stat:1431": [
    {
      "id": "row-1",
      "key": "|T01|002||",
      "label": "의료비 / 경상의료비"
    },
    {
      "id": "row-2",
      "key": "|T01|002001||",
      "label": "의료비 / 경상의료(GDP대비, %)"
    },
    {
      "id": "row-3",
      "key": "|T01|003||",
      "label": "의료비 / 정부,의무가입제도"
    },
    {
      "id": "row-4",
      "key": "|T01|003001||",
      "label": "의료비 / 정부,의무가입제도(구성비, %)"
    },
    {
      "id": "row-5",
      "key": "|T01|004||",
      "label": "의료비 / 민간의료비"
    },
    {
      "id": "row-6",
      "key": "|T01|004001||",
      "label": "의료비 / 민간의료(구성비, %)"
    }
  ],
  "stat:2767": [
    {
      "id": "row-1",
      "key": "|T01|||",
      "label": "노인공익활동사업"
    },
    {
      "id": "row-2",
      "key": "|T02|||",
      "label": "노인역량활용사업"
    },
    {
      "id": "row-3",
      "key": "|T03|||",
      "label": "민간형(공동체사업단)"
    },
    {
      "id": "row-4",
      "key": "|T04|||",
      "label": "민간형(취업지원(알선)형)"
    },
    {
      "id": "row-5",
      "key": "|T05|||",
      "label": "민간형(현장실습 훈련(시니어인턴십))"
    },
    {
      "id": "row-6",
      "key": "|T06|||",
      "label": "민간형(노인친화기업·기관)"
    },
    {
      "id": "row-7",
      "key": "|T07|||",
      "label": "민간형(기업연계형)"
    },
    {
      "id": "row-8",
      "key": "|T08|||",
      "label": "재능나눔"
    }
  ],
  "stat:2762": [
    {
      "id": "api-1",
      "key": "|T01|001||",
      "label": "기준중위소득 / 1인가구"
    },
    {
      "id": "api-2",
      "key": "|T01|002||",
      "label": "기준중위소득 / 2인가구"
    },
    {
      "id": "api-3",
      "key": "|T01|003||",
      "label": "기준중위소득 / 3인가구"
    },
    {
      "id": "api-4",
      "key": "|T01|004||",
      "label": "기준중위소득 / 4인가구"
    },
    {
      "id": "api-5",
      "key": "|T01|005||",
      "label": "기준중위소득 / 5인가구"
    },
    {
      "id": "api-6",
      "key": "|T01|006||",
      "label": "기준중위소득 / 6인가구"
    }
  ],
  "stat:2759": [
    {
      "id": "api-1",
      "key": "|T01|||",
      "label": "사회복지지출(C=A+B)"
    },
    {
      "id": "api-2",
      "key": "|T02|||",
      "label": "공공부문(A)"
    },
    {
      "id": "api-3",
      "key": "|T03|||",
      "label": "법정민간부문(B)"
    }
  ],
  "stat:1430": [
    {
      "id": "api-1",
      "key": "|T01|||",
      "label": "부양비"
    }
  ],
  "stat:2707": [
    {
      "id": "api-1",
      "key": "|T01|||",
      "label": "인원"
    }
  ],
  "stat:2768": [
    {
      "id": "api-1",
      "key": "|T01|000||",
      "label": "등록 장애인수 / 계"
    },
    {
      "id": "api-2",
      "key": "|T01|001||",
      "label": "등록 장애인수 / 지체장애"
    },
    {
      "id": "api-3",
      "key": "|T01|002||",
      "label": "등록 장애인수 / 시각장애"
    },
    {
      "id": "api-4",
      "key": "|T01|003||",
      "label": "등록 장애인수 / 청각,언어"
    },
    {
      "id": "api-5",
      "key": "|T01|004||",
      "label": "등록 장애인수 / 지적장애"
    },
    {
      "id": "api-6",
      "key": "|T01|005||",
      "label": "등록 장애인수 / 뇌병변장애"
    },
    {
      "id": "api-7",
      "key": "|T01|006||",
      "label": "등록 장애인수 / 자폐성장애"
    },
    {
      "id": "api-8",
      "key": "|T01|007||",
      "label": "등록 장애인수 / 정신장애"
    },
    {
      "id": "api-9",
      "key": "|T01|008||",
      "label": "등록 장애인수 / 신장장애"
    },
    {
      "id": "api-10",
      "key": "|T01|009||",
      "label": "등록 장애인수 / 심장장애"
    },
    {
      "id": "api-11",
      "key": "|T01|010||",
      "label": "등록 장애인수 / 호흡기장애"
    },
    {
      "id": "api-12",
      "key": "|T01|011||",
      "label": "등록 장애인수 / 간장애"
    },
    {
      "id": "api-13",
      "key": "|T01|012||",
      "label": "등록 장애인수 / 안면장애"
    },
    {
      "id": "api-14",
      "key": "|T01|013||",
      "label": "등록 장애인수 / 장루,요루장애"
    },
    {
      "id": "api-15",
      "key": "|T01|014||",
      "label": "등록 장애인수 / 뇌전증장애"
    }
  ],
  "stat:2773": [
    {
      "id": "api-1",
      "key": "|T01|||",
      "label": "장애인거주시설"
    },
    {
      "id": "api-2",
      "key": "|T02|||",
      "label": "장애인직업재활시설"
    },
    {
      "id": "api-3",
      "key": "|T03|||",
      "label": "장애인지역사회재활시설"
    },
    {
      "id": "api-4",
      "key": "|T05|||",
      "label": "장애인생산품판매시설"
    },
    {
      "id": "api-5",
      "key": "|T04|||",
      "label": "장애인의료재활시설"
    }
  ],
  "stat:1404": [
    {
      "id": "api-1",
      "key": "|T03|||",
      "label": "보건복지예산"
    },
    {
      "id": "api-2",
      "key": "|T04|||",
      "label": "보건복지예산증가율"
    }
  ],
  "stat:2758": [
    {
      "id": "api-1",
      "key": "|T01|000||",
      "label": "기대수명 / 계"
    },
    {
      "id": "api-2",
      "key": "|T01|001||",
      "label": "기대수명 / 남자"
    },
    {
      "id": "api-3",
      "key": "|T01|002||",
      "label": "기대수명 / 여자"
    },
    {
      "id": "api-4",
      "key": "|T02|||",
      "label": "유병기간제외 기대수명(건강수명)"
    }
  ],
  "stat:2764": [
    {
      "id": "api-1",
      "key": "|T01|001||",
      "label": "국민연금 재정 / 조성"
    },
    {
      "id": "api-2",
      "key": "|T01|001001||",
      "label": "국민연금 재정 / 연금보험료"
    },
    {
      "id": "api-3",
      "key": "|T01|001002||",
      "label": "국민연금 재정 / 운용수익"
    },
    {
      "id": "api-4",
      "key": "|T01|001003||",
      "label": "국민연금 재정 / 국고보조금 등"
    },
    {
      "id": "api-5",
      "key": "|T01|002||",
      "label": "국민연금 재정 / 지출"
    },
    {
      "id": "api-6",
      "key": "|T01|002001||",
      "label": "국민연금 재정 / 연금급여지급"
    },
    {
      "id": "api-7",
      "key": "|T01|002002||",
      "label": "국민연금 재정 / 관리운영비 등"
    },
    {
      "id": "api-8",
      "key": "|T01|003||",
      "label": "국민연금 재정 / 기금 증가분"
    },
    {
      "id": "api-9",
      "key": "|T01|004||",
      "label": "국민연금 재정 / 기금 운용"
    },
    {
      "id": "api-10",
      "key": "|T01|004001||",
      "label": "국민연금 재정 / 공공부문"
    },
    {
      "id": "api-11",
      "key": "|T01|004002||",
      "label": "국민연금 재정 / 복지부문"
    },
    {
      "id": "api-12",
      "key": "|T01|004003||",
      "label": "국민연금 재정 / 금융부문"
    },
    {
      "id": "api-13",
      "key": "|T01|004999||",
      "label": "국민연금 재정 / 기타"
    }
  ],
  "stat:2763": [
    {
      "id": "api-1",
      "key": "|T01|001||",
      "label": "건강보험 재정수지 / 수입"
    },
    {
      "id": "api-2",
      "key": "|T01|001001||",
      "label": "건강보험 재정수지 / 보험료수입 등"
    },
    {
      "id": "api-3",
      "key": "|T01|001002||",
      "label": "건강보험 재정수지 / 정부지원"
    },
    {
      "id": "api-4",
      "key": "|T01|001002001||",
      "label": "건강보험 재정수지 / 국고"
    },
    {
      "id": "api-5",
      "key": "|T01|001002002||",
      "label": "건강보험 재정수지 / 국민증진기금"
    },
    {
      "id": "api-6",
      "key": "|T01|002||",
      "label": "건강보험 재정수지 / 지출"
    },
    {
      "id": "api-7",
      "key": "|T01|002001||",
      "label": "건강보험 재정수지 / 보험급여비"
    },
    {
      "id": "api-8",
      "key": "|T01|002002||",
      "label": "건강보험 재정수지 / 관리운영비 등"
    },
    {
      "id": "api-9",
      "key": "|T01|003||",
      "label": "건강보험 재정수지 / 당기수지"
    },
    {
      "id": "api-10",
      "key": "|T01|004||",
      "label": "건강보험 재정수지 / 누적수지"
    },
    {
      "id": "api-11",
      "key": "|T01|005||",
      "label": "건강보험 재정수지 / 수지율(지출/수입)"
    }
  ]
};

// 운영자 지시(2026-10-12)로 서비스에서 뺀 통계. 2021년 1개 연도뿐이라 추이 통계로 의미가 없다(stat:1441 정신장애 유병률).
export const RETIRED_STATISTICS_IDS: ReadonlySet<string> = new Set(["stat:1441"]);
export const INDEX_ADDITIONAL_DATASETS: readonly StatisticsDataset[] = [...INDEX_BASE_DATASETS, ...INDEX_EXPANDED_DATASETS].filter((dataset) => !RETIRED_STATISTICS_IDS.has(dataset.id));
export const INDEX_API_SERIES: Readonly<Record<string, readonly { id: string; key: string; label: string; table_code?: string }[]>> = Object.fromEntries(
  Object.entries({ ...INDEX_BASE_SERIES, ...INDEX_EXPANDED_SERIES }).filter(([id]) => !RETIRED_STATISTICS_IDS.has(id)));
