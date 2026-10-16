import type { StatisticsDataset } from "./types.ts";

export const INDEX_EXPANDED_DATASETS: readonly StatisticsDataset[] = [
  {
    "id": "stat:1440",
    "indicator_code": "1440",
    "table_code": "144001",
    "category": "보건·의료",
    "title": "국가 암검진 수검률",
    "description": "국가 암검진 사업 수검률",
    "note": "지표누리 공식 API에서 확인한 1개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다.",
    "highlight_series_id": "api-1",
    "original_unit": "천명, %",
    "table_title": "국가 암검진 사업 수검률",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440",
    "source_name": "국민건강보험공단 DW시스템(매년 3월말 기준)",
    "source_notes": "국가 암검진 사업 수검률: * 이 통계는 주민등록번호 오류, 중복검진 등을 정리한 자료로 보건소 실적보고 자료와 다소 차이날 수 있음 * 대상자 : 의료급여수급자 + 건강보험 가입자 하위 50% * 2005년~ : 익년도 3.31일 기준 작성 * 2002-2004년 건강보험가입자 중 자궁경부암 검진대상자 및 수검자 미포함 * 2019년부터 폐암 검진대상자 및 수검자 포함",
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
        "label": "암 검진 수검자 수 / 전체",
        "source_label": "암 검진 수검자 수 / 전체",
        "unit": "천명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
        "points": [
          {
            "period": "2016",
            "raw": "12012",
            "value": 12012,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "12424",
            "value": 12424,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "12942",
            "value": 12942,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "13897",
            "value": 13897,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "11925",
            "value": 11925,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "14076",
            "value": 14076,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "14184",
            "value": 14184,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "13988",
            "value": 13988,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "14184",
            "value": 14184,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "13889",
            "value": 13889,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "암 검진 수검자 수 / 위암",
        "source_label": "암 검진 수검자 수 / 위암",
        "unit": "천명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
        "points": [
          {
            "period": "2016",
            "raw": "3758",
            "value": 3758,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "3801",
            "value": 3801,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "3922",
            "value": 3922,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "4189",
            "value": 4189,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "3559",
            "value": 3559,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "4268",
            "value": 4268,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "4338",
            "value": 4338,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "4265",
            "value": 4265,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "4379",
            "value": 4379,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "4356",
            "value": 4356,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "암 검진 수검자 수 / 간암",
        "source_label": "암 검진 수검자 수 / 간암",
        "unit": "천명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
        "points": [
          {
            "period": "2016",
            "raw": "245",
            "value": 245,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "241",
            "value": 241,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "287",
            "value": 287,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "309",
            "value": 309,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "293",
            "value": 293,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "342",
            "value": 342,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "344",
            "value": 344,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "330",
            "value": 330,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "348",
            "value": 348,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "348",
            "value": 348,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "암 검진 수검자 수 / 대장암",
        "source_label": "암 검진 수검자 수 / 대장암",
        "unit": "천명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
        "points": [
          {
            "period": "2016",
            "raw": "3105",
            "value": 3105,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "3327",
            "value": 3327,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "3557",
            "value": 3557,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "3755",
            "value": 3755,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "3190",
            "value": 3190,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "3642",
            "value": 3642,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "3687",
            "value": 3687,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "3594",
            "value": 3594,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "3533",
            "value": 3533,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "3224",
            "value": 3224,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-5",
        "label": "암 검진 수검자 수 / 유방암",
        "source_label": "암 검진 수검자 수 / 유방암",
        "unit": "천명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
        "points": [
          {
            "period": "2016",
            "raw": "2202",
            "value": 2202,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "2243",
            "value": 2243,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "2287",
            "value": 2287,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "2454",
            "value": 2454,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "2072",
            "value": 2072,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "2517",
            "value": 2517,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "2518",
            "value": 2518,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "2504",
            "value": 2504,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "2555",
            "value": 2555,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "2571",
            "value": 2571,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-6",
        "label": "암 검진 수검자 수 / 자궁경부암",
        "source_label": "암 검진 수검자 수 / 자궁경부암",
        "unit": "천명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
        "points": [
          {
            "period": "2016",
            "raw": "2702",
            "value": 2702,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "2812",
            "value": 2812,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "2889",
            "value": 2889,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "3141",
            "value": 3141,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "2756",
            "value": 2756,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "3239",
            "value": 3239,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "3213",
            "value": 3213,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "3201",
            "value": 3201,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "3266",
            "value": 3266,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "3273",
            "value": 3273,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-7",
        "label": "암 검진 수검자 수 / 폐암",
        "source_label": "암 검진 수검자 수 / 폐암",
        "unit": "천명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
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
            "raw": "49",
            "value": 49,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "55",
            "value": 55,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "69",
            "value": 69,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "84",
            "value": 84,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "93",
            "value": 93,
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
            "raw": "106",
            "value": 106,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-8",
        "label": "수검률 / 전체",
        "source_label": "수검률 / 전체",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
        "points": [
          {
            "period": "2016",
            "raw": "51.5",
            "value": 51.5,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "52.7",
            "value": 52.7,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "55",
            "value": 55,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "55.6",
            "value": 55.6,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "49.2",
            "value": 49.2,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "55.1",
            "value": 55.1,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "54.9",
            "value": 54.9,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "55.9",
            "value": 55.9,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "55.7",
            "value": 55.7,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "56.8",
            "value": 56.8,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-9",
        "label": "수검률 / 위암",
        "source_label": "수검률 / 위암",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
        "points": [
          {
            "period": "2016",
            "raw": "59",
            "value": 59,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "59.9",
            "value": 59.9,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "61.9",
            "value": 61.9,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "62.2",
            "value": 62.2,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "55.4",
            "value": 55.4,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "62.6",
            "value": 62.6,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "62.3",
            "value": 62.3,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "62.9",
            "value": 62.9,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "62.5",
            "value": 62.5,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "61.3",
            "value": 61.3,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-10",
        "label": "수검률 / 간암",
        "source_label": "수검률 / 간암",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
        "points": [
          {
            "period": "2016",
            "raw": "66.4",
            "value": 66.4,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "68.7",
            "value": 68.7,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "71.9",
            "value": 71.9,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "73.1",
            "value": 73.1,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "68.4",
            "value": 68.4,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "72.9",
            "value": 72.9,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "72.5",
            "value": 72.5,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "74.8",
            "value": 74.8,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "75",
            "value": 75,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "74.2",
            "value": 74.2,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-11",
        "label": "수검률 / 대장암",
        "source_label": "수검률 / 대장암",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
        "points": [
          {
            "period": "2016",
            "raw": "38.6",
            "value": 38.6,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "40.2",
            "value": 40.2,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "43",
            "value": 43,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "43",
            "value": 43,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "36.9",
            "value": 36.9,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "40.3",
            "value": 40.3,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "40.4",
            "value": 40.4,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "41.6",
            "value": 41.6,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "41.1",
            "value": 41.1,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "44.4",
            "value": 44.4,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-12",
        "label": "수검률 / 유방암",
        "source_label": "수검률 / 유방암",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
        "points": [
          {
            "period": "2016",
            "raw": "63.8",
            "value": 63.8,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "64.5",
            "value": 64.5,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "65.8",
            "value": 65.8,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "66",
            "value": 66,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "58.5",
            "value": 58.5,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "65.9",
            "value": 65.9,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "65.4",
            "value": 65.4,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "65.7",
            "value": 65.7,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "65.2",
            "value": 65.2,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "64.2",
            "value": 64.2,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-13",
        "label": "수검률 / 자궁경부암",
        "source_label": "수검률 / 자궁경부암",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
        "points": [
          {
            "period": "2016",
            "raw": "52.8",
            "value": 52.8,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "54.6",
            "value": 54.6,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "57.3",
            "value": 57.3,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "59.8",
            "value": 59.8,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "54.8",
            "value": 54.8,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "61.7",
            "value": 61.7,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "61.0",
            "value": 61,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "61.9",
            "value": 61.9,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "61.7",
            "value": 61.7,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "60.6",
            "value": 60.6,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-14",
        "label": "수검률 / 폐암",
        "source_label": "수검률 / 폐암",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001",
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
            "raw": "33.1",
            "value": 33.1,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "36.6",
            "value": 36.6,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "47.9",
            "value": 47.9,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "52.6",
            "value": 52.6,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "54.8",
            "value": 54.8,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "55.0",
            "value": 55,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "53.1",
            "value": 53.1,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260709",
      "next_update": "20270430",
      "projection": false,
      "frequency": "Y",
      "tables": [
        {
          "table_code": "144001",
          "table_title": "국가 암검진 사업 수검률",
          "original_unit": "천명, %",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1440&stts_cd=144001"
        }
      ]
    }
  },
  {
    "id": "stat:1451",
    "indicator_code": "1451",
    "table_code": "145101",
    "category": "보건·의료",
    "title": "뇌사자 장기기증 현황",
    "description": "뇌사자 장기기증 현황",
    "note": "지표누리 공식 API에서 확인한 1개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다.",
    "highlight_series_id": "api-1",
    "original_unit": "명",
    "table_title": "뇌사자 장기기증 현황",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1451&stts_cd=145101",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1451",
    "source_name": "국립장기조직혈액관리원「장기기증 및 이식 통계연보」",
    "source_notes": "뇌사자 장기기증 현황: 뇌사자 장기기증 현황",
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
        "label": "뇌사 기증자 수",
        "source_label": "뇌사 기증자 수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1451&stts_cd=145101",
        "points": [
          {
            "period": "2016",
            "raw": "573",
            "value": 573,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "515",
            "value": 515,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "449",
            "value": 449,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "450",
            "value": 450,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "478",
            "value": 478,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "442",
            "value": 442,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "405",
            "value": 405,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "483",
            "value": 483,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "397",
            "value": 397,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "370",
            "value": 370,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20261007",
      "next_update": "20270202",
      "projection": false,
      "frequency": "Y",
      "tables": [
        {
          "table_code": "145101",
          "table_title": "뇌사자 장기기증 현황",
          "original_unit": "명",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1451&stts_cd=145101"
        }
      ]
    }
  },
  {
    "id": "stat:1425",
    "indicator_code": "1425",
    "table_code": "142501",
    "category": "보건·의료",
    "title": "세대당 건강보험료 부담액",
    "description": "세대당 건강보험료 부담액",
    "note": "지표누리 공식 API에서 확인한 1개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다.",
    "highlight_series_id": "api-1",
    "original_unit": "원",
    "table_title": "세대당 건강보험료 부담액",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1425&stts_cd=142501",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1425",
    "source_name": "국민건강보험공단, 건강보험 주요통계",
    "source_notes": "세대당 건강보험료 부담액: ",
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
        "label": "계(세대당 부담액)",
        "source_label": "계(세대당 부담액)",
        "unit": "원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1425&stts_cd=142501",
        "points": [
          {
            "period": "2016",
            "raw": "98128",
            "value": 98128,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "101178",
            "value": 101178,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "104201",
            "value": 104201,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "109558",
            "value": 109558,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "114069",
            "value": 114069,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "122201",
            "value": 122201,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "129832",
            "value": 129832,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "134010",
            "value": 134010,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "134124",
            "value": 134124,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "138308",
            "value": 138308,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "지역가입자 부담액",
        "source_label": "지역가입자 부담액",
        "unit": "원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1425&stts_cd=142501",
        "points": [
          {
            "period": "2016",
            "raw": "84531",
            "value": 84531,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "87458",
            "value": 87458,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "85546",
            "value": 85546,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "86160",
            "value": 86160,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "90864",
            "value": 90864,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "97221",
            "value": 97221,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "95221",
            "value": 95221,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "87579",
            "value": 87579,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "82186",
            "value": 82186,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "86357",
            "value": 86357,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "직장가입자 부담액",
        "source_label": "직장가입자 부담액",
        "unit": "원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1425&stts_cd=142501",
        "points": [
          {
            "period": "2016",
            "raw": "104507",
            "value": 104507,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "107449",
            "value": 107449,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "112635",
            "value": 112635,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "120152",
            "value": 120152,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "124629",
            "value": 124629,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "133591",
            "value": 133591,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "145553",
            "value": 145553,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "155760",
            "value": 155760,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "159184",
            "value": 159184,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "164223",
            "value": 164223,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260428",
      "next_update": "20270430",
      "projection": false,
      "frequency": "Y",
      "tables": [
        {
          "table_code": "142501",
          "table_title": "세대당 건강보험료 부담액",
          "original_unit": "원",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1425&stts_cd=142501"
        }
      ]
    }
  },
  {
    "id": "stat:A0007",
    "indicator_code": "A0007",
    "table_code": "A000701",
    "category": "보건·의료",
    "title": "병상 수 추이",
    "description": "인구 천명당 병상수 추이",
    "note": "지표누리 공식 API에서 확인한 1개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다.",
    "highlight_series_id": "api-1",
    "original_unit": "병상",
    "table_title": "인구 천명당 병상수 추이",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=A0007&stts_cd=A000701",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=A0007",
    "source_name": "보건복지부「보건복지통계연보」, 국가데이터처「장래인구추계」",
    "source_notes": "인구 천명당 병상수 추이: ",
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
        "label": "병상수",
        "source_label": "병상수",
        "unit": "인구 1천 명당 병상",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=A0007&stts_cd=A000701",
        "points": [
          {
            "period": "2016",
            "raw": "13.5",
            "value": 13.5,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "13.7",
            "value": 13.7,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "13.7",
            "value": 13.7,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "13.6",
            "value": 13.6,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "13.8",
            "value": 13.8,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "14.0",
            "value": 14,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "14.0",
            "value": 14,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2024",
            "raw": "13.9",
            "value": 13.9,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20250109",
      "next_update": "20261231",
      "projection": false,
      "frequency": "Y",
      "tables": [
        {
          "table_code": "A000701",
          "table_title": "인구 천명당 병상수 추이",
          "original_unit": "병상",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=A0007&stts_cd=A000701"
        }
      ]
    }
  },
  {
    "id": "stat:2770",
    "indicator_code": "2770",
    "table_code": "277002",
    "category": "보건·의료",
    "title": "암 발생 및 사망 현황",
    "description": "암사망자수 및 암사망률 · 암발생자수 및 암발생률",
    "note": "지표누리 공식 API에서 확인한 2개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다.",
    "highlight_series_id": "api-1",
    "original_unit": "명, 명/10만 명",
    "table_title": "암사망자수 및 암사망률",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770",
    "source_name": "국가데이터처 사망원인통계(국가승인통계 제101054호)",
    "source_notes": "암사망자수 및 암사망률: 대장암에 항문암이 포함됨(C18-C21) 2023년 사망원인통계(2024년 10월 발표)가 최근 자료이며, 2024년 자료는 2025년 10월에 공표예정(통계청)\n암발생자수 및 암발생률: 2023년 암발생률 통계(2026년 1월 발표)가 최근 자료이며, 2024년 자료는 2026년 12월 공표예정임",
    "periods": [
      "2016",
      "2017",
      "2018",
      "2019",
      "2020",
      "2021",
      "2022",
      "2023"
    ],
    "series": [
      {
        "id": "api-1",
        "label": "모든 암(C00-C97) / 사망자수",
        "source_label": "모든 암(C00-C97) / 사망자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "78194",
            "value": 78194,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "78863",
            "value": 78863,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "79153",
            "value": 79153,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "81203",
            "value": 81203,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "82204",
            "value": 82204,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "82688",
            "value": 82688,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "83378",
            "value": 83378,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "85271",
            "value": 85271,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "모든 암(C00-C97) / 조사망률",
        "source_label": "모든 암(C00-C97) / 조사망률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "153.0",
            "value": 153,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "153.9",
            "value": 153.9,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "154.3",
            "value": 154.3,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "158.2",
            "value": 158.2,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "160.1",
            "value": 160.1,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "161.1",
            "value": 161.1,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "162.7",
            "value": 162.7,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "166.7",
            "value": 166.7,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "위암(C16) / 사망자수",
        "source_label": "위암(C16) / 사망자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "8264",
            "value": 8264,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "8034",
            "value": 8034,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "7746",
            "value": 7746,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "7624",
            "value": 7624,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "7510",
            "value": 7510,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "7249",
            "value": 7249,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "7147",
            "value": 7147,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "7229",
            "value": 7229,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "위암(C16) / 조사망률",
        "source_label": "위암(C16) / 조사망률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "16.2",
            "value": 16.2,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "15.7",
            "value": 15.7,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "15.1",
            "value": 15.1,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "14.9",
            "value": 14.9,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "14.6",
            "value": 14.6,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "14.1",
            "value": 14.1,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "13.9",
            "value": 13.9,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "14.1",
            "value": 14.1,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-5",
        "label": "대장암(C18-C21) / 사망자수",
        "source_label": "대장암(C18-C21) / 사망자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "8432",
            "value": 8432,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "8766",
            "value": 8766,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "8786",
            "value": 8786,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "8966",
            "value": 8966,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "8944",
            "value": 8944,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "8984",
            "value": 8984,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "9164",
            "value": 9164,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "9348",
            "value": 9348,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-6",
        "label": "대장암(C18-C21) / 조사망률",
        "source_label": "대장암(C18-C21) / 조사망률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "16.5",
            "value": 16.5,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "17.1",
            "value": 17.1,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "17.1",
            "value": 17.1,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "17.5",
            "value": 17.5,
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
            "raw": "17.5",
            "value": 17.5,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "17.9",
            "value": 17.9,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "18.3",
            "value": 18.3,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-7",
        "label": "간암(C22) / 사망자수",
        "source_label": "간암(C22) / 사망자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "11001",
            "value": 11001,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "10721",
            "value": 10721,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "10611",
            "value": 10611,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "10586",
            "value": 10586,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "10565",
            "value": 10565,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "10255",
            "value": 10255,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "10212",
            "value": 10212,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "10136",
            "value": 10136,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-8",
        "label": "간암(C22) / 조사망률",
        "source_label": "간암(C22) / 조사망률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "21.5",
            "value": 21.5,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "20.9",
            "value": 20.9,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "20.7",
            "value": 20.7,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "20.6",
            "value": 20.6,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "20.6",
            "value": 20.6,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "20.0",
            "value": 20,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "19.9",
            "value": 19.9,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "19.8",
            "value": 19.8,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-9",
        "label": "폐암(C33-C34) / 사망자수",
        "source_label": "폐암(C33-C34) / 사망자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "17963",
            "value": 17963,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "17980",
            "value": 17980,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "17852",
            "value": 17852,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "18574",
            "value": 18574,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "18673",
            "value": 18673,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "18902",
            "value": 18902,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "18584",
            "value": 18584,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "18646",
            "value": 18646,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-10",
        "label": "폐암(C33-C34) / 조사망률",
        "source_label": "폐암(C33-C34) / 조사망률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "35.1",
            "value": 35.1,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "35.1",
            "value": 35.1,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "34.8",
            "value": 34.8,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "36.2",
            "value": 36.2,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "36.4",
            "value": 36.4,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "36.8",
            "value": 36.8,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "36.3",
            "value": 36.3,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "36.5",
            "value": 36.5,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-11",
        "label": "유방암(C50) / 사망자수",
        "source_label": "유방암(C50) / 사망자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "2472",
            "value": 2472,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "2517",
            "value": 2517,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "2473",
            "value": 2473,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "2643",
            "value": 2643,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "2745",
            "value": 2745,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "2744",
            "value": 2744,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "2878",
            "value": 2878,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "2849",
            "value": 2849,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-12",
        "label": "유방암(C50) / 조사망률",
        "source_label": "유방암(C50) / 조사망률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "4.8",
            "value": 4.8,
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
            "raw": "4.8",
            "value": 4.8,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "5.1",
            "value": 5.1,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "5.3",
            "value": 5.3,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "5.3",
            "value": 5.3,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "5.6",
            "value": 5.6,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "5.6",
            "value": 5.6,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-13",
        "label": "자궁암(C53-C55) / 사망자수",
        "source_label": "자궁암(C53-C55) / 사망자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "1300",
            "value": 1300,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "1279",
            "value": 1279,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "1268",
            "value": 1268,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "1341",
            "value": 1341,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "1284",
            "value": 1284,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1364",
            "value": 1364,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "1304",
            "value": 1304,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "1411",
            "value": 1411,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-14",
        "label": "자궁암(C53-C55) / 조사망률",
        "source_label": "자궁암(C53-C55) / 조사망률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "2.5",
            "value": 2.5,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "2.5",
            "value": 2.5,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "2.5",
            "value": 2.5,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "2.6",
            "value": 2.6,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "2.5",
            "value": 2.5,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "2.7",
            "value": 2.7,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "2.5",
            "value": 2.5,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "2.7",
            "value": 2.7,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-15",
        "label": "기타암(Re.C00-C97) / 사망자수",
        "source_label": "기타암(Re.C00-C97) / 사망자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "28762",
            "value": 28762,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "29566",
            "value": 29566,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "30417",
            "value": 30417,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "31469",
            "value": 31469,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "32483",
            "value": 32483,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "33190",
            "value": 33190,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "34089",
            "value": 34089,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "35652",
            "value": 35652,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-16",
        "label": "기타암(Re.C00-C97) / 조사망률",
        "source_label": "기타암(Re.C00-C97) / 조사망률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002",
        "points": [
          {
            "period": "2016",
            "raw": "56.3",
            "value": 56.3,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "57.7",
            "value": 57.7,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "59.3",
            "value": 59.3,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "61.3",
            "value": 61.3,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "63.3",
            "value": 63.3,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "64.7",
            "value": 64.7,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "66.6",
            "value": 66.6,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "69.7",
            "value": 69.7,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-17",
        "label": "모든 암(C00-C96) / 발생자수",
        "source_label": "모든 암(C00-C96) / 발생자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "233276",
            "value": 233276,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "237089",
            "value": 237089,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "247509",
            "value": 247509,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "258629",
            "value": 258629,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "251329",
            "value": 251329,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "280042",
            "value": 280042,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "281317",
            "value": 281317,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "288613",
            "value": 288613,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-18",
        "label": "모든 암(C00-C96) / 조발생률",
        "source_label": "모든 암(C00-C96) / 조발생률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "456.4",
            "value": 456.4,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "462.8",
            "value": 462.8,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "482.5",
            "value": 482.5,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "503.8",
            "value": 503.8,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "489.5",
            "value": 489.5,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "545.5",
            "value": 545.5,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "548.8",
            "value": 548.8,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "564.3",
            "value": 564.3,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-19",
        "label": "위암(C16) / 발생자수",
        "source_label": "위암(C16) / 발생자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "30859",
            "value": 30859,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "30206",
            "value": 30206,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "29606",
            "value": 29606,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "29861",
            "value": 29861,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "26919",
            "value": 26919,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "29535",
            "value": 29535,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "29196",
            "value": 29196,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "28943",
            "value": 28943,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-20",
        "label": "위암(C16) / 조발생률",
        "source_label": "위암(C16) / 조발생률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "60.4",
            "value": 60.4,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "59.0",
            "value": 59,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "57.7",
            "value": 57.7,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "58.2",
            "value": 58.2,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "52.4",
            "value": 52.4,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "57.5",
            "value": 57.5,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "57.0",
            "value": 57,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "56.6",
            "value": 56.6,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-21",
        "label": "대장암(C18-C20) / 발생자수",
        "source_label": "대장암(C18-C20) / 발생자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "28693",
            "value": 28693,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "28822",
            "value": 28822,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "28517",
            "value": 28517,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "29787",
            "value": 29787,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "28467",
            "value": 28467,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "33225",
            "value": 33225,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "33205",
            "value": 33205,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "32610",
            "value": 32610,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-22",
        "label": "대장암(C18-C20) / 조발생률",
        "source_label": "대장암(C18-C20) / 조발생률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "56.1",
            "value": 56.1,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "56.3",
            "value": 56.3,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "55.6",
            "value": 55.6,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "58.0",
            "value": 58,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "55.4",
            "value": 55.4,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "64.7",
            "value": 64.7,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "64.8",
            "value": 64.8,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "63.8",
            "value": 63.8,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-23",
        "label": "간암(C22) / 발생자수",
        "source_label": "간암(C22) / 발생자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "15748",
            "value": 15748,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "15439",
            "value": 15439,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "15582",
            "value": 15582,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "15565",
            "value": 15565,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "15092",
            "value": 15092,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "15040",
            "value": 15040,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "14782",
            "value": 14782,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "14707",
            "value": 14707,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-24",
        "label": "간암(C22) / 조발생률",
        "source_label": "간암(C22) / 조발생률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "30.8",
            "value": 30.8,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "30.1",
            "value": 30.1,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "30.4",
            "value": 30.4,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "30.3",
            "value": 30.3,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "29.4",
            "value": 29.4,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "29.3",
            "value": 29.3,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "28.8",
            "value": 28.8,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "28.8",
            "value": 28.8,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-25",
        "label": "폐암(C33-C34) / 발생자수",
        "source_label": "폐암(C33-C34) / 발생자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "26289",
            "value": 26289,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "27471",
            "value": 27471,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "29046",
            "value": 29046,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "30377",
            "value": 30377,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "29288",
            "value": 29288,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "31777",
            "value": 31777,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "32085",
            "value": 32085,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "32953",
            "value": 32953,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-26",
        "label": "폐암(C33-C34) / 조발생률",
        "source_label": "폐암(C33-C34) / 조발생률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "51.4",
            "value": 51.4,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "53.6",
            "value": 53.6,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "56.6",
            "value": 56.6,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "59.2",
            "value": 59.2,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "57.0",
            "value": 57,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "61.9",
            "value": 61.9,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "62.6",
            "value": 62.6,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "64.4",
            "value": 64.4,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-27",
        "label": "유방암(C50) / 발생자수",
        "source_label": "유방암(C50) / 발생자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "22052",
            "value": 22052,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "22746",
            "value": 22746,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "23840",
            "value": 23840,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "25138",
            "value": 25138,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "25137",
            "value": 25137,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "29027",
            "value": 29027,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "29274",
            "value": 29274,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "29871",
            "value": 29871,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-28",
        "label": "유방암(C50) / 조발생률",
        "source_label": "유방암(C50) / 조발생률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "43.1",
            "value": 43.1,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "44.4",
            "value": 44.4,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "46.5",
            "value": 46.5,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "49.0",
            "value": 49,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "49.0",
            "value": 49,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "56.5",
            "value": 56.5,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "57.1",
            "value": 57.1,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "58.4",
            "value": 58.4,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-29",
        "label": "자궁경부암(C53) / 발생자수",
        "source_label": "자궁경부암(C53) / 발생자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "3644",
            "value": 3644,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "3554",
            "value": 3554,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "3578",
            "value": 3578,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "3335",
            "value": 3335,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "3060",
            "value": 3060,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "3251",
            "value": 3251,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "3161",
            "value": 3161,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "3144",
            "value": 3144,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-30",
        "label": "자궁경부암(C53) / 조발생률",
        "source_label": "자궁경부암(C53) / 조발생률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "7.1",
            "value": 7.1,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "6.9",
            "value": 6.9,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "7.0",
            "value": 7,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "6.5",
            "value": 6.5,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "6.0",
            "value": 6,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "6.3",
            "value": 6.3,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "6.2",
            "value": 6.2,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "6.1",
            "value": 6.1,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-31",
        "label": "기타암(Re.C00-C96) / 발생자수",
        "source_label": "기타암(Re.C00-C96) / 발생자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "105991",
            "value": 105991,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "108851",
            "value": 108851,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "117340",
            "value": 117340,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "124566",
            "value": 124566,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "123366",
            "value": 123366,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "138187",
            "value": 138187,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "137614",
            "value": 137614,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "146385",
            "value": 146385,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-32",
        "label": "기타암(Re.C00-C96) / 조발생률",
        "source_label": "기타암(Re.C00-C96) / 조발생률",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003",
        "points": [
          {
            "period": "2016",
            "raw": "207.4",
            "value": 207.4,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "212.5",
            "value": 212.5,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "228.7",
            "value": 228.7,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "242.6",
            "value": 242.6,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "240.2",
            "value": 240.2,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "269.2",
            "value": 269.2,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "272.4",
            "value": 272.4,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "286.2",
            "value": 286.2,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260224",
      "next_update": "20270226",
      "projection": false,
      "frequency": "Y",
      "tables": [
        {
          "table_code": "277002",
          "table_title": "암사망자수 및 암사망률",
          "original_unit": "명, 명/10만 명",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277002"
        },
        {
          "table_code": "277003",
          "table_title": "암발생자수 및 암발생률",
          "original_unit": "명, 명/10만 명",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2770&stts_cd=277003"
        }
      ]
    }
  },
  {
    "id": "stat:2769",
    "indicator_code": "2769",
    "table_code": "276901",
    "category": "보건·의료",
    "title": "영아/모성 사망",
    "description": "모성사망추이 · 영아사망추이",
    "note": "지표누리 공식 API에서 확인한 2개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다. 사망비·사망률은 원문 해설의 분모를 적용한 단위로 표시합니다.",
    "highlight_series_id": "api-2",
    "original_unit": "명,%",
    "table_title": "모성사망추이",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2769&stts_cd=276901",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2769",
    "source_name": "2008년 이전:보건복지부 영아모성사망조사(국가승인통계 제11733호), 2009년 이후:사망원인통계조사(국가승인통계 제101054호)",
    "source_notes": "모성사망추이: * 모성사망비(출생아 10만명당) : (모성사망자 수/출생아수)*100,000 * 모성사망률(가임기여성 10만명당) : (모성사망자 수/ 15~49세 가임기 여성수) * 100,000 * 통계청으로 통합된 이후 첫 조사 (2012년 실시, 2009~2011년 대상) 이후 매년 작성\n영아사망추이: * 영아사망률 : (당해연도 0세 사망아수/당해연도 연간출생아수)*1,000 * 통계청으로 통합된 이후 첫 조사 (2012년 실시, 2009~2011년 대상) 이후 매년 작성",
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
        "label": "모성사망수",
        "source_label": "모성사망수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2769&stts_cd=276901",
        "points": [
          {
            "period": "2016",
            "raw": "34",
            "value": 34,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "28",
            "value": 28,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "37",
            "value": 37,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "30",
            "value": 30,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "32",
            "value": 32,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "23",
            "value": 23,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "21",
            "value": 21,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "23",
            "value": 23,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "24",
            "value": 24,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "모성사망비",
        "source_label": "모성사망비",
        "unit": "출생아 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2769&stts_cd=276901",
        "points": [
          {
            "period": "2016",
            "raw": "8.4",
            "value": 8.4,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "7.8",
            "value": 7.8,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "11.3",
            "value": 11.3,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "9.9",
            "value": 9.9,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "11.8",
            "value": 11.8,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "8.8",
            "value": 8.8,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "8.4",
            "value": 8.4,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "10.0",
            "value": 10,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "10.1",
            "value": 10.1,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "모성사망률",
        "source_label": "모성사망률",
        "unit": "15–49세 여성 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2769&stts_cd=276901",
        "points": [
          {
            "period": "2016",
            "raw": "0.27",
            "value": 0.27,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "0.22",
            "value": 0.22,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "0.3",
            "value": 0.3,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "0.25",
            "value": 0.25,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "0.27",
            "value": 0.27,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "0.20",
            "value": 0.2,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "0.18",
            "value": 0.18,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "0.21",
            "value": 0.21,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "0.22",
            "value": 0.22,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "신생아 사망률",
        "source_label": "신생아 사망률",
        "unit": "출생아 1천 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2769&stts_cd=276902",
        "points": [
          {
            "period": "2016",
            "raw": "1.6",
            "value": 1.6,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "1.5",
            "value": 1.5,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "1.6",
            "value": 1.6,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "1.5",
            "value": 1.5,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "1.3",
            "value": 1.3,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1.3",
            "value": 1.3,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "1.2",
            "value": 1.2,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "1.2",
            "value": 1.2,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "1.2",
            "value": 1.2,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-5",
        "label": "신생아 후기 사망률",
        "source_label": "신생아 후기 사망률",
        "unit": "출생아 1천 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2769&stts_cd=276902",
        "points": [
          {
            "period": "2016",
            "raw": "1.2",
            "value": 1.2,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "1.3",
            "value": 1.3,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "1.2",
            "value": 1.2,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "1.2",
            "value": 1.2,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "1.2",
            "value": 1.2,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1.2",
            "value": 1.2,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "1.1",
            "value": 1.1,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "1.2",
            "value": 1.2,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "1.2",
            "value": 1.2,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-6",
        "label": "영아사망률",
        "source_label": "영아사망률",
        "unit": "출생아 1천 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2769&stts_cd=276902",
        "points": [
          {
            "period": "2016",
            "raw": "2.8",
            "value": 2.8,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "2.8",
            "value": 2.8,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "2.8",
            "value": 2.8,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "2.7",
            "value": 2.7,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "2.5",
            "value": 2.5,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "2.4",
            "value": 2.4,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "2.3",
            "value": 2.3,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "2.5",
            "value": 2.5,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "2.4",
            "value": 2.4,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260112",
      "next_update": "20261231",
      "projection": false,
      "frequency": "Y",
      "tables": [
        {
          "table_code": "276901",
          "table_title": "모성사망추이",
          "original_unit": "명,%",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2769&stts_cd=276901"
        },
        {
          "table_code": "276902",
          "table_title": "영아사망추이",
          "original_unit": "%",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2769&stts_cd=276902"
        }
      ]
    }
  },
  {
    "id": "stat:A0006",
    "indicator_code": "A0006",
    "table_code": "A000601",
    "category": "보건·의료",
    "title": "의료인력 추이",
    "description": "인구 10만명당 의료인수 추이",
    "note": "지표누리 공식 API에서 확인한 1개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다.",
    "highlight_series_id": "api-1",
    "original_unit": "명",
    "table_title": "인구 10만명당 의료인수 추이",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=A0006&stts_cd=A000601",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=A0006",
    "source_name": "보건복지부「보건복지통계연보」, 국가데이터처「장래인구추계」",
    "source_notes": "인구 10만명당 의료인수 추이: ※ 2004년 이후는 사망자 및 취소자를 제외한 수치임",
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
        "label": "인구 10만명당 의료인 수 / 계",
        "source_label": "인구 10만명당 의료인 수 / 계",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=A0006&stts_cd=A000601",
        "points": [
          {
            "period": "2016",
            "raw": "1046",
            "value": 1046,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "1081",
            "value": 1081,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "1124",
            "value": 1124,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "1174",
            "value": 1174,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "1220",
            "value": 1220,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1274",
            "value": 1274,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "1326",
            "value": 1326,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "1377",
            "value": 1377,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "1429",
            "value": 1429,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "인구 10만명당 의료인 수 / 의사",
        "source_label": "인구 10만명당 의료인 수 / 의사",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=A0006&stts_cd=A000601",
        "points": [
          {
            "period": "2016",
            "raw": "232",
            "value": 232,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "235",
            "value": 235,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "239",
            "value": 239,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "245",
            "value": 245,
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
            "raw": "256",
            "value": 256,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "261",
            "value": 261,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "266",
            "value": 266,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "271",
            "value": 271,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "인구 10만명당 의료인 수 / 한의사",
        "source_label": "인구 10만명당 의료인 수 / 한의사",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=A0006&stts_cd=A000601",
        "points": [
          {
            "period": "2016",
            "raw": "47",
            "value": 47,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "47",
            "value": 47,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "48",
            "value": 48,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "49",
            "value": 49,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "50",
            "value": 50,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "52",
            "value": 52,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "53",
            "value": 53,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "55",
            "value": 55,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "56",
            "value": 56,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "인구 10만명당 의료인 수 / 치과의사",
        "source_label": "인구 10만명당 의료인 수 / 치과의사",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=A0006&stts_cd=A000601",
        "points": [
          {
            "period": "2016",
            "raw": "58",
            "value": 58,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "59",
            "value": 59,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "60",
            "value": 60,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "61",
            "value": 61,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "62",
            "value": 62,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "64",
            "value": 64,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "65",
            "value": 65,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "66",
            "value": 66,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "68",
            "value": 68,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-5",
        "label": "인구 10만명당 의료인 수 / 조산사",
        "source_label": "인구 10만명당 의료인 수 / 조산사",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=A0006&stts_cd=A000601",
        "points": [
          {
            "period": "2016",
            "raw": "16",
            "value": 16,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "16",
            "value": 16,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "16",
            "value": 16,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "16",
            "value": 16,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "16",
            "value": 16,
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
            "raw": "16",
            "value": 16,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "16",
            "value": 16,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-6",
        "label": "인구 10만명당 의료인 수 / 간호사",
        "source_label": "인구 10만명당 의료인 수 / 간호사",
        "unit": "인구 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=A0006&stts_cd=A000601",
        "points": [
          {
            "period": "2016",
            "raw": "694",
            "value": 694,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "724",
            "value": 724,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "761",
            "value": 761,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "803",
            "value": 803,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "842",
            "value": 842,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "887",
            "value": 887,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "931",
            "value": 931,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "974",
            "value": 974,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "1018",
            "value": 1018,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260514",
      "next_update": "20270226",
      "projection": false,
      "frequency": "Y",
      "tables": [
        {
          "table_code": "A000601",
          "table_title": "인구 10만명당 의료인수 추이",
          "original_unit": "명",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=A0006&stts_cd=A000601"
        }
      ]
    }
  },
  {
    "id": "stat:1441",
    "indicator_code": "1441",
    "table_code": "144102",
    "category": "보건·의료",
    "title": "정신장애 유병률",
    "description": "정신장애 평생 유병률(성인)",
    "note": "지표누리 공식 API에서 확인한 1개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다. 조사 실시 연도만 제공하며 조사 사이 연도는 보간하지 않습니다.",
    "highlight_series_id": "api-1",
    "original_unit": "%",
    "table_title": "정신장애 평생 유병률(성인)",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441",
    "source_name": "보건복지부, 「정신건강실태조사」, 국가승인통계(정신건강실태조사)",
    "source_notes": "정신장애 평생 유병률(성인): 주석1) 알코올 사용장애, 니코틴 사용장애, 우울장애, 불안장애 : 알코올 사용장애, 니코틴 사용장애, 우울장애, 불안장애 중 어느 하나라도 해당되는 경우 주석2) 우울장애 : 21년도 조사 항목에서는 양극성장애 항목이 제외되어, 주요우울장애와 기분부전장애를 합친 진단군을 우울장애라고 구분함",
    "periods": [
      "2021"
    ],
    "series": [
      {
        "id": "api-1",
        "label": "정신장애 유병률 / 알코올 사용장애, 니코틴 사용장애, 우울장애, 불안장애 / 계",
        "source_label": "정신장애 유병률 / 알코올 사용장애, 니코틴 사용장애, 우울장애, 불안장애 / 계",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "27.8",
            "value": 27.8,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "정신장애 유병률 / 알코올 사용장애, 니코틴 사용장애, 우울장애, 불안장애 / 남",
        "source_label": "정신장애 유병률 / 알코올 사용장애, 니코틴 사용장애, 우울장애, 불안장애 / 남",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "32.7",
            "value": 32.7,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "정신장애 유병률 / 알코올 사용장애, 니코틴 사용장애, 우울장애, 불안장애 / 여",
        "source_label": "정신장애 유병률 / 알코올 사용장애, 니코틴 사용장애, 우울장애, 불안장애 / 여",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "22.9",
            "value": 22.9,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "정신장애 유병률 / 알코올 사용장애 / 계",
        "source_label": "정신장애 유병률 / 알코올 사용장애 / 계",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "11.6",
            "value": 11.6,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-5",
        "label": "정신장애 유병률 / 알코올 사용장애 / 남",
        "source_label": "정신장애 유병률 / 알코올 사용장애 / 남",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "17.6",
            "value": 17.6,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-6",
        "label": "정신장애 유병률 / 알코올 사용장애 / 여",
        "source_label": "정신장애 유병률 / 알코올 사용장애 / 여",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "5.4",
            "value": 5.4,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-7",
        "label": "정신장애 유병률 / 니코틴 사용장애 / 계",
        "source_label": "정신장애 유병률 / 니코틴 사용장애 / 계",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "9.5",
            "value": 9.5,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-8",
        "label": "정신장애 유병률 / 니코틴 사용장애 / 남",
        "source_label": "정신장애 유병률 / 니코틴 사용장애 / 남",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "17.7",
            "value": 17.7,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-9",
        "label": "정신장애 유병률 / 니코틴 사용장애 / 여",
        "source_label": "정신장애 유병률 / 니코틴 사용장애 / 여",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "1.1",
            "value": 1.1,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-10",
        "label": "정신장애 유병률 / 우울장애 / 계",
        "source_label": "정신장애 유병률 / 우울장애 / 계",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "7.7",
            "value": 7.7,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-11",
        "label": "정신장애 유병률 / 우울장애 / 남",
        "source_label": "정신장애 유병률 / 우울장애 / 남",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "5.7",
            "value": 5.7,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-12",
        "label": "정신장애 유병률 / 우울장애 / 여",
        "source_label": "정신장애 유병률 / 우울장애 / 여",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "9.8",
            "value": 9.8,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-13",
        "label": "정신장애 유병률 / 불안장애 / 계",
        "source_label": "정신장애 유병률 / 불안장애 / 계",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "9.3",
            "value": 9.3,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-14",
        "label": "정신장애 유병률 / 불안장애 / 남",
        "source_label": "정신장애 유병률 / 불안장애 / 남",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "5.4",
            "value": 5.4,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-15",
        "label": "정신장애 유병률 / 불안장애 / 여",
        "source_label": "정신장애 유병률 / 불안장애 / 여",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102",
        "points": [
          {
            "period": "2021",
            "raw": "13.4",
            "value": 13.4,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20220405",
      "next_update": "20270131",
      "projection": false,
      "frequency": "R",
      "tables": [
        {
          "table_code": "144102",
          "table_title": "정신장애 평생 유병률(성인)",
          "original_unit": "%",
          "frequency": "R",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1441&stts_cd=144102"
        }
      ]
    }
  },
  {
    "id": "stat:1449",
    "indicator_code": "1449",
    "table_code": "144902",
    "category": "보건·의료",
    "title": "항생제 및 주사제 처방률",
    "description": "항생제 및 주사제 처방률",
    "note": "지표누리 공식 API에서 확인한 1개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다.",
    "highlight_series_id": "api-1",
    "original_unit": "%",
    "table_title": "항생제 및 주사제 처방률",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1449&stts_cd=144902",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1449",
    "source_name": "보건복지부 (건강보험심사평가원 자료)",
    "source_notes": "항생제 및 주사제 처방률: * 위 자료는 건강보험심사평가원의 자료로 의료기관의 처방률임 * 연간단위 처방률 현황(검강보험 기준)임, 항생제 처방률 : 전체상병 대상 * 평가대상 항생제 범위 - 외래 원내에서 투여된 주사용 항생제 및 원외 처방된 경구.주사용 항생제 - 항생제 범위 : 약효분류번호 611-615,618,619,621(sulfasalazine 제외),625 및 629(Quinolone 계열만 해당), 641(metronidazole 만 해당)",
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
        "label": "항생제 처방률",
        "source_label": "항생제 처방률",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1449&stts_cd=144902",
        "points": [
          {
            "period": "2016",
            "raw": "22.07",
            "value": 22.07,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "21.01",
            "value": 21.01,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "20.51",
            "value": 20.51,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "19.98",
            "value": 19.98,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "15.68",
            "value": 15.68,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "12.71",
            "value": 12.71,
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
            "raw": "19.22",
            "value": 19.22,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "20.1",
            "value": 20.1,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "주사제 처방률",
        "source_label": "주사제 처방률",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1449&stts_cd=144902",
        "points": [
          {
            "period": "2016",
            "raw": "17.22",
            "value": 17.22,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "16.33",
            "value": 16.33,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "16.20",
            "value": 16.2,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "14.99",
            "value": 14.99,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "14.10",
            "value": 14.1,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "12.1",
            "value": 12.1,
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
            "raw": "12.6",
            "value": 12.6,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "13.2",
            "value": 13.2,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20251015",
      "next_update": "20261001",
      "projection": false,
      "frequency": "Y",
      "tables": [
        {
          "table_code": "144902",
          "table_title": "항생제 및 주사제 처방률",
          "original_unit": "%",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1449&stts_cd=144902"
        }
      ]
    }
  },
  {
    "id": "stat:1450",
    "indicator_code": "1450",
    "table_code": "145001",
    "category": "보건·의료",
    "title": "헌혈인구 및 개인헌혈 비율",
    "description": "헌혈인구 및 개인헌혈 비율",
    "note": "지표누리 공식 API에서 확인한 1개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다. 연헌혈인구는 헌혈 건수(천건)이며 고유 인원 수와 다릅니다.",
    "highlight_series_id": "api-2",
    "original_unit": "천건, %",
    "table_title": "헌혈인구 및 개인헌혈 비율",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1450&stts_cd=145001",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1450",
    "source_name": "대한적십자사「혈액사업통계연보」",
    "source_notes": "헌혈인구 및 개인헌혈 비율: 헌혈인구 및 개인헌혈 비율",
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
        "label": "총인구",
        "source_label": "총인구",
        "unit": "천명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1450&stts_cd=145001",
        "points": [
          {
            "period": "2016",
            "raw": "50801",
            "value": 50801,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "51446",
            "value": 51446,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "51635",
            "value": 51635,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "51849",
            "value": 51849,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "51829",
            "value": 51829,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "51639",
            "value": 51639,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "51439",
            "value": 51439,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "51325",
            "value": 51325,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "51217",
            "value": 51217,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "51117",
            "value": 51117,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "연 헌혈인구 / 계",
        "source_label": "연 헌혈인구 / 계",
        "unit": "천건",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1450&stts_cd=145001",
        "points": [
          {
            "period": "2016",
            "raw": "2866",
            "value": 2866,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "2929",
            "value": 2929,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "2883",
            "value": 2883,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "2791",
            "value": 2791,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "2611",
            "value": 2611,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "2604",
            "value": 2604,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "2649",
            "value": 2649,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "2776",
            "value": 2776,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "2856",
            "value": 2856,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "2839.6",
            "value": 2839.6,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "연 헌혈인구 / 헌혈률",
        "source_label": "연 헌혈인구 / 헌혈률",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1450&stts_cd=145001",
        "points": [
          {
            "period": "2016",
            "raw": "5.6",
            "value": 5.6,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "5.7",
            "value": 5.7,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "5.6",
            "value": 5.6,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "5.4",
            "value": 5.4,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "5.0",
            "value": 5,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "5.0",
            "value": 5,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "5.1",
            "value": 5.1,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "5.4",
            "value": 5.4,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "5.6",
            "value": 5.6,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "5.6",
            "value": 5.6,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "연 헌혈인구 / 단체헌혈",
        "source_label": "연 헌혈인구 / 단체헌혈",
        "unit": "천건",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1450&stts_cd=145001",
        "points": [
          {
            "period": "2016",
            "raw": "953",
            "value": 953,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "954",
            "value": 954,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "900",
            "value": 900,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "874",
            "value": 874,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "659",
            "value": 659,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "650",
            "value": 650,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "641",
            "value": 641,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "716",
            "value": 716,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "750",
            "value": 750,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "756",
            "value": 756,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-5",
        "label": "연 헌혈인구 / 단체비중",
        "source_label": "연 헌혈인구 / 단체비중",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1450&stts_cd=145001",
        "points": [
          {
            "period": "2016",
            "raw": "33.3",
            "value": 33.3,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "32.6",
            "value": 32.6,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "31.2",
            "value": 31.2,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "31.3",
            "value": 31.3,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "25.2",
            "value": 25.2,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "24.9",
            "value": 24.9,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "24.2",
            "value": 24.2,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "25.8",
            "value": 25.8,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "26.3",
            "value": 26.3,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "26.6",
            "value": 26.6,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-6",
        "label": "연 헌혈인구 / 개인헌혈",
        "source_label": "연 헌혈인구 / 개인헌혈",
        "unit": "천건",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1450&stts_cd=145001",
        "points": [
          {
            "period": "2016",
            "raw": "1913",
            "value": 1913,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "1975",
            "value": 1975,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "1983",
            "value": 1983,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "1916",
            "value": 1916,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "1953",
            "value": 1953,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "1954",
            "value": 1954,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "2008",
            "value": 2008,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "2060",
            "value": 2060,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "2106",
            "value": 2106,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "2083",
            "value": 2083,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-7",
        "label": "연 헌혈인구 / 개인비중",
        "source_label": "연 헌혈인구 / 개인비중",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1450&stts_cd=145001",
        "points": [
          {
            "period": "2016",
            "raw": "66.7",
            "value": 66.7,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "67.4",
            "value": 67.4,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "68.8",
            "value": 68.8,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "68.7",
            "value": 68.7,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "74.8",
            "value": 74.8,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "75.0",
            "value": 75,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "75.8",
            "value": 75.8,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "74.2",
            "value": 74.2,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "73.7",
            "value": 73.7,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "73.4",
            "value": 73.4,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260331",
      "next_update": "20270430",
      "projection": false,
      "frequency": "Y",
      "tables": [
        {
          "table_code": "145001",
          "table_title": "헌혈인구 및 개인헌혈 비율",
          "original_unit": "천건, %",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1450&stts_cd=145001"
        }
      ]
    }
  },
  {
    "id": "stat:2708",
    "indicator_code": "2708",
    "table_code": "270801",
    "category": "아동",
    "title": "국내 입양아 수 및 입양 비율",
    "description": "입양 아동수 · 입양아동비율",
    "note": "지표누리 공식 API에서 확인한 2개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다.",
    "highlight_series_id": "api-3",
    "original_unit": "명",
    "table_title": "입양 아동수",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2708&stts_cd=270801",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2708",
    "source_name": "보건복지부 내부자료",
    "source_notes": "입양 아동수: 「아동복지법」제3조제4호*에 따른 보호대상아동 중 「입양특례법」, 「국내입양에 관한 특별법」「국제입양에 관한 법률」에 따라 국내 또는 국외 입양된 아동 연도별 현황\n입양아동비율: 「아동복지법」제3조제4호*에 따른 보호대상아동 중 「입양특례법」, 「국내입양에 관한 특별법」「국제입양에 관한 법률」에 따라 국내 또는 국외로 입양된 아동",
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
        "label": "입양 아동수 / 국내",
        "source_label": "입양 아동수 / 국내",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2708&stts_cd=270801",
        "points": [
          {
            "period": "2016",
            "raw": "546",
            "value": 546,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "465",
            "value": 465,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "378",
            "value": 378,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "387",
            "value": 387,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "260",
            "value": 260,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "226",
            "value": 226,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "182",
            "value": 182,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "150",
            "value": 150,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "154",
            "value": 154,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "116",
            "value": 116,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "입양 아동수 / 국외",
        "source_label": "입양 아동수 / 국외",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2708&stts_cd=270801",
        "points": [
          {
            "period": "2016",
            "raw": "334",
            "value": 334,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "398",
            "value": 398,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "303",
            "value": 303,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "317",
            "value": 317,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "232",
            "value": 232,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "189",
            "value": 189,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "142",
            "value": 142,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "79",
            "value": 79,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "58",
            "value": 58,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "24",
            "value": 24,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "입양 아동수 / 계",
        "source_label": "입양 아동수 / 계",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2708&stts_cd=270801",
        "points": [
          {
            "period": "2016",
            "raw": "880",
            "value": 880,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "863",
            "value": 863,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "681",
            "value": 681,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "704",
            "value": 704,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "492",
            "value": 492,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "415",
            "value": 415,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "324",
            "value": 324,
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
            "raw": "212",
            "value": 212,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "140",
            "value": 140,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "입양아동비율 / 국내",
        "source_label": "입양아동비율 / 국내",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2708&stts_cd=270802",
        "points": [
          {
            "period": "2016",
            "raw": "62.0",
            "value": 62,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "53.9",
            "value": 53.9,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "55.5",
            "value": 55.5,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "55.0",
            "value": 55,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "52.9",
            "value": 52.9,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "54.5",
            "value": 54.5,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "56.2",
            "value": 56.2,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "65.5",
            "value": 65.5,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "72.6",
            "value": 72.6,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "82.9",
            "value": 82.9,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-5",
        "label": "입양아동비율 / 국외",
        "source_label": "입양아동비율 / 국외",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2708&stts_cd=270802",
        "points": [
          {
            "period": "2016",
            "raw": "38.0",
            "value": 38,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "46.1",
            "value": 46.1,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "44.5",
            "value": 44.5,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "45",
            "value": 45,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "47.1",
            "value": 47.1,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "45.5",
            "value": 45.5,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "43.8",
            "value": 43.8,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "34.5",
            "value": 34.5,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "27.4",
            "value": 27.4,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "17.1",
            "value": 17.1,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-6",
        "label": "입양아동비율 / 계",
        "source_label": "입양아동비율 / 계",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2708&stts_cd=270802",
        "points": [
          {
            "period": "2016",
            "raw": "100",
            "value": 100,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "100",
            "value": 100,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "100",
            "value": 100,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "100",
            "value": 100,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "100",
            "value": 100,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "100",
            "value": 100,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "100",
            "value": 100,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "100",
            "value": 100,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "100",
            "value": 100,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "100",
            "value": 100,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260511",
      "next_update": "20270511",
      "projection": false,
      "frequency": "Y",
      "tables": [
        {
          "table_code": "270801",
          "table_title": "입양 아동수",
          "original_unit": "명",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2708&stts_cd=270801"
        },
        {
          "table_code": "270802",
          "table_title": "입양아동비율",
          "original_unit": "%",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2708&stts_cd=270802"
        }
      ]
    }
  },
  {
    "id": "stat:1409",
    "indicator_code": "1409",
    "table_code": "140901",
    "category": "노인",
    "title": "노인 취업률 현황",
    "description": "노인 취업상태 현황",
    "note": "지표누리 공식 API에서 확인한 1개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다. 조사 실시 연도만 제공하며 조사 사이 연도는 보간하지 않습니다.",
    "highlight_series_id": "api-1",
    "original_unit": "%",
    "table_title": "노인 취업상태 현황",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1409&stts_cd=140901",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1409",
    "source_name": "「노인실태조사 : 전국노인생활실태 및 복지욕구조사」",
    "source_notes": "노인 취업상태 현황: 2008년부터 3년주기로 통계를 제공합니다.",
    "periods": [
      "2017",
      "2020",
      "2023"
    ],
    "series": [
      {
        "id": "api-1",
        "label": "노인 취업상태별 구성비 / 계",
        "source_label": "노인 취업상태별 구성비 / 계",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1409&stts_cd=140901",
        "points": [
          {
            "period": "2017",
            "raw": "100",
            "value": 100,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "100",
            "value": 100,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "100",
            "value": 100,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "노인 취업상태별 구성비 / 취업중",
        "source_label": "노인 취업상태별 구성비 / 취업중",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1409&stts_cd=140901",
        "points": [
          {
            "period": "2017",
            "raw": "30.9",
            "value": 30.9,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "36.9",
            "value": 36.9,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "39.0",
            "value": 39,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "노인 취업상태별 구성비 / 비취업",
        "source_label": "노인 취업상태별 구성비 / 비취업",
        "unit": "%",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1409&stts_cd=140901",
        "points": [
          {
            "period": "2017",
            "raw": "69.1",
            "value": 69.1,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "63.1",
            "value": 63.1,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "61.0",
            "value": 61,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20250401",
      "next_update": "20271130",
      "projection": false,
      "frequency": "U",
      "tables": [
        {
          "table_code": "140901",
          "table_title": "노인 취업상태 현황",
          "original_unit": "%",
          "frequency": "U",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1409&stts_cd=140901"
        }
      ]
    }
  },
  {
    "id": "stat:2711",
    "indicator_code": "2711",
    "table_code": "271101",
    "category": "아동",
    "title": "아동 안전사고 현황",
    "description": "아동 안전사고 사망자수",
    "note": "지표누리 공식 API에서 확인한 1개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다.",
    "highlight_series_id": "api-1",
    "original_unit": "명",
    "table_title": "아동 안전사고 사망자수",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2711&stts_cd=271101",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2711",
    "source_name": "국가데이터처 인구동향과,『사망원인통계, 국가승인통계 제101054호』,『인구동향조사, 국가승인통계 제101003호』",
    "source_notes": "아동 안전사고 사망자수: 18세 미만 아동 안전사고 사망자 수(국가데이터처 사망원인통계 자료 중 일부자료) 18세 미만 인구 수(국가데이터처 인구동향조사 자료 중 일부자료)",
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
        "label": "사망자수 / 18세 미만 인구(천명)",
        "source_label": "사망자수 / 18세 미만 인구(천명)",
        "unit": "천명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2711&stts_cd=271101",
        "points": [
          {
            "period": "2016",
            "raw": "8838",
            "value": 8838,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "8597",
            "value": 8597,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "8318",
            "value": 8318,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "8042",
            "value": 8042,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "7810",
            "value": 7810,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "7589",
            "value": 7589,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "7370",
            "value": 7370,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "7168",
            "value": 7168,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "6970",
            "value": 6970,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "사망자수 / 아동안전사고 사망자수",
        "source_label": "사망자수 / 아동안전사고 사망자수",
        "unit": "명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2711&stts_cd=271101",
        "points": [
          {
            "period": "2016",
            "raw": "281",
            "value": 281,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "283",
            "value": 283,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "229",
            "value": 229,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "221",
            "value": 221,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "221",
            "value": 221,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "183",
            "value": 183,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "187",
            "value": 187,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "181",
            "value": 181,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "150",
            "value": 150,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "사망자수 / 아동10만명당 안전사고 사망자수",
        "source_label": "사망자수 / 아동10만명당 안전사고 사망자수",
        "unit": "아동 10만 명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2711&stts_cd=271101",
        "points": [
          {
            "period": "2016",
            "raw": "3.18",
            "value": 3.18,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "3.29",
            "value": 3.29,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "2.75",
            "value": 2.75,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "2.75",
            "value": 2.75,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "2.83",
            "value": 2.83,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "2.41",
            "value": 2.41,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "2.54",
            "value": 2.54,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "2.53",
            "value": 2.53,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "2.15",
            "value": 2.15,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20251217",
      "next_update": "20261218",
      "projection": false,
      "frequency": "Y",
      "tables": [
        {
          "table_code": "271101",
          "table_title": "아동 안전사고 사망자수",
          "original_unit": "명",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2711&stts_cd=271101"
        }
      ]
    }
  },
  {
    "id": "stat:2710",
    "indicator_code": "2710",
    "table_code": "271002",
    "category": "장애인",
    "title": "취업장애인 월평균 소득",
    "description": "취업장애인 월평균 소득",
    "note": "지표누리 공식 API에서 확인한 1개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다. 조사 실시 연도만 제공하며 조사 사이 연도는 보간하지 않습니다.",
    "highlight_series_id": "api-1",
    "original_unit": "만원",
    "table_title": "취업장애인 월평균 소득",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710",
    "source_name": "「장애인 실태조사」(승인번호 117032호), 『사업체임금근로시간조사』(~2014), 경제활동인구조사 근로형태별 부가조사(2017~)",
    "source_notes": "취업장애인 월평균 소득: 2005년 상용근로자 임금 - 사업체 노동력조사(고용노동부), 2005. 연평균 2008년 상용근로자 임금 - 사업체 노동력조사(고용노동부), 2008. 연평균 2011년 상용근로자 임금 - 사업체 노동력조사(고용노동부), 2011. 3/4분기 2014년 상용근로자 임금 - 사업체 노동력조사(고용노동부), 2014.6. 경제활동인구조사 근로형태별 부가조사, 통계청(2017.8) 경제활동인구조사 근로형태별 부가조사, 통계청(2020.8)",
    "periods": [
      "2017",
      "2020",
      "2023"
    ],
    "series": [
      {
        "id": "api-1",
        "label": "장애인 월평균 소득 / 전국 임금근로자",
        "source_label": "장애인 월평균 소득 / 전국 임금근로자",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "243.0",
            "value": 243,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "268.10",
            "value": 268.1,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "300.7",
            "value": 300.7,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "장애인 월평균 소득 / 전체장애인",
        "source_label": "장애인 월평균 소득 / 전체장애인",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "171.04",
            "value": 171.04,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "187.5",
            "value": 187.5,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "214.6",
            "value": 214.6,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "장애인 월평균 소득 / 지체장애",
        "source_label": "장애인 월평균 소득 / 지체장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "188.92",
            "value": 188.92,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "203.2",
            "value": 203.2,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "239.3",
            "value": 239.3,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "장애인 월평균 소득 / 뇌병변장애",
        "source_label": "장애인 월평균 소득 / 뇌병변장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "124.01",
            "value": 124.01,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "165.1",
            "value": 165.1,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "195.9",
            "value": 195.9,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-5",
        "label": "장애인 월평균 소득 / 시각장애",
        "source_label": "장애인 월평균 소득 / 시각장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "196.43",
            "value": 196.43,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "190.8",
            "value": 190.8,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "244.1",
            "value": 244.1,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-6",
        "label": "장애인 월평균 소득 / 청각장애",
        "source_label": "장애인 월평균 소득 / 청각장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "125.20",
            "value": 125.2,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "149.3",
            "value": 149.3,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "133.7",
            "value": 133.7,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-7",
        "label": "장애인 월평균 소득 / 언어장애",
        "source_label": "장애인 월평균 소득 / 언어장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "154.71",
            "value": 154.71,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "192.9",
            "value": 192.9,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "176.6",
            "value": 176.6,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-8",
        "label": "장애인 월평균 소득 / 지적장애",
        "source_label": "장애인 월평균 소득 / 지적장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "70.50",
            "value": 70.5,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "91.6",
            "value": 91.6,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "113.5",
            "value": 113.5,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-9",
        "label": "장애인 월평균 소득 / 자폐성장애",
        "source_label": "장애인 월평균 소득 / 자폐성장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "34.54",
            "value": 34.54,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "121.4",
            "value": 121.4,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "97.6",
            "value": 97.6,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-10",
        "label": "장애인 월평균 소득 / 정신장애",
        "source_label": "장애인 월평균 소득 / 정신장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "86.91",
            "value": 86.91,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "95.9",
            "value": 95.9,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "98.9",
            "value": 98.9,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-11",
        "label": "장애인 월평균 소득 / 신장장애",
        "source_label": "장애인 월평균 소득 / 신장장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "175.74",
            "value": 175.74,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "240.4",
            "value": 240.4,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "292.1",
            "value": 292.1,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-12",
        "label": "장애인 월평균 소득 / 심장장애",
        "source_label": "장애인 월평균 소득 / 심장장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "64.68",
            "value": 64.68,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "187.8",
            "value": 187.8,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "215.5",
            "value": 215.5,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-13",
        "label": "장애인 월평균 소득 / 호흡기장애",
        "source_label": "장애인 월평균 소득 / 호흡기장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "100.69",
            "value": 100.69,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "222.5",
            "value": 222.5,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "195.4",
            "value": 195.4,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-14",
        "label": "장애인 월평균 소득 / 간장애",
        "source_label": "장애인 월평균 소득 / 간장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "277.81",
            "value": 277.81,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "260.7",
            "value": 260.7,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "338.0",
            "value": 338,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-15",
        "label": "장애인 월평균 소득 / 안면장애",
        "source_label": "장애인 월평균 소득 / 안면장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "120.35",
            "value": 120.35,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "214.5",
            "value": 214.5,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "265.3",
            "value": 265.3,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-16",
        "label": "장애인 월평균 소득 / 장루.요루장애",
        "source_label": "장애인 월평균 소득 / 장루.요루장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "187.72",
            "value": 187.72,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "197.1",
            "value": 197.1,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "206.3",
            "value": 206.3,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-17",
        "label": "장애인 월평균 소득 / 뇌전증장애",
        "source_label": "장애인 월평균 소득 / 뇌전증장애",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "90.11",
            "value": 90.11,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "118.6",
            "value": 118.6,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "157.5",
            "value": 157.5,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-18",
        "label": "장애인 월평균 소득 / 상용근로자",
        "source_label": "장애인 월평균 소득 / 상용근로자",
        "unit": "만원",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002",
        "points": [
          {
            "period": "2017",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2020",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2023",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20241212",
      "next_update": "20271201",
      "projection": false,
      "frequency": "R",
      "tables": [
        {
          "table_code": "271002",
          "table_title": "취업장애인 월평균 소득",
          "original_unit": "만원",
          "frequency": "R",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=2710&stts_cd=271002"
        }
      ]
    }
  },
  {
    "id": "stat:1422",
    "indicator_code": "1422",
    "table_code": "142201",
    "category": "아동",
    "title": "학대피해아동 보호 건수",
    "description": "아동학대 유형별 사례",
    "note": "지표누리 공식 API에서 확인한 1개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다.",
    "highlight_series_id": "api-1",
    "original_unit": "건",
    "table_title": "아동학대 유형별 사례",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1422&stts_cd=142201",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1422",
    "source_name": "보건복지부「아동학대 주요통계」",
    "source_notes": "아동학대 유형별 사례: - 본 통계는 경찰관서 및 자치단체(아동보호전문기관)에 신고접수된 아동학대의심사례만 분석한 결과로 그밖에 타기관을 통해 신고접수된 건은 미반영되어 있어, 실제 우리나라 아동학대 실태와는 차이가 있을 수 있음. - &apos;12년부터 유기는 방임에 포함하여 집계 - &apos;20.10월 이전까지는 지역아동보호전문기관에 신고접수된 건만 분석한 것임.",
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
        "label": "아동학대 유형별 사례건수 / 계",
        "source_label": "아동학대 유형별 사례건수 / 계",
        "unit": "건",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1422&stts_cd=142201",
        "points": [
          {
            "period": "2016",
            "raw": "18700",
            "value": 18700,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "22367",
            "value": 22367,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "24604",
            "value": 24604,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "30045",
            "value": 30045,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "30905",
            "value": 30905,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "37605",
            "value": 37605,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "27971",
            "value": 27971,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "25739",
            "value": 25739,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "24492",
            "value": 24492,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "23648",
            "value": 23648,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "아동학대 유형별 사례건수 / 신체학대",
        "source_label": "아동학대 유형별 사례건수 / 신체학대",
        "unit": "건",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1422&stts_cd=142201",
        "points": [
          {
            "period": "2016",
            "raw": "2715",
            "value": 2715,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "3285",
            "value": 3285,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "3436",
            "value": 3436,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "4179",
            "value": 4179,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "3807",
            "value": 3807,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "5780",
            "value": 5780,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "4911",
            "value": 4911,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "4698",
            "value": 4698,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "4625",
            "value": 4625,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "4867",
            "value": 4867,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-3",
        "label": "아동학대 유형별 사례건수 / 정서학대",
        "source_label": "아동학대 유형별 사례건수 / 정서학대",
        "unit": "건",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1422&stts_cd=142201",
        "points": [
          {
            "period": "2016",
            "raw": "3588",
            "value": 3588,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "4728",
            "value": 4728,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "5862",
            "value": 5862,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "7622",
            "value": 7622,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "8732",
            "value": 8732,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "12351",
            "value": 12351,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "10632",
            "value": 10632,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "11094",
            "value": 11094,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "11466",
            "value": 11466,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "11820",
            "value": 11820,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-4",
        "label": "아동학대 유형별 사례건수 / 성학대",
        "source_label": "아동학대 유형별 사례건수 / 성학대",
        "unit": "건",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1422&stts_cd=142201",
        "points": [
          {
            "period": "2016",
            "raw": "493",
            "value": 493,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "692",
            "value": 692,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "910",
            "value": 910,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "883",
            "value": 883,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "695",
            "value": 695,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "655",
            "value": 655,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "609",
            "value": 609,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "585",
            "value": 585,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "619",
            "value": 619,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "565",
            "value": 565,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-5",
        "label": "아동학대 유형별 사례건수 / 방임",
        "source_label": "아동학대 유형별 사례건수 / 방임",
        "unit": "건",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1422&stts_cd=142201",
        "points": [
          {
            "period": "2016",
            "raw": "2924",
            "value": 2924,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "2787",
            "value": 2787,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "2604",
            "value": 2604,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "2885",
            "value": 2885,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "2737",
            "value": 2737,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "2793",
            "value": 2793,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "2044",
            "value": 2044,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "1979",
            "value": 1979,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "1800",
            "value": 1800,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "1635",
            "value": 1635,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-6",
        "label": "아동학대 유형별 사례건수 / 유기",
        "source_label": "아동학대 유형별 사례건수 / 유기",
        "unit": "건",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1422&stts_cd=142201",
        "points": [
          {
            "period": "2016",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2017",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2018",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2019",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2020",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2021",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2022",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2023",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2024",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          },
          {
            "period": "2025",
            "raw": "-",
            "value": null,
            "status": "MISSING"
          }
        ]
      },
      {
        "id": "api-7",
        "label": "아동학대 유형별 사례건수 / 중복학대",
        "source_label": "아동학대 유형별 사례건수 / 중복학대",
        "unit": "건",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1422&stts_cd=142201",
        "points": [
          {
            "period": "2016",
            "raw": "8980",
            "value": 8980,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "10875",
            "value": 10875,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "11792",
            "value": 11792,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "14476",
            "value": 14476,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "14934",
            "value": 14934,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "16026",
            "value": 16026,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "9775",
            "value": 9775,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "7383",
            "value": 7383,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "5982",
            "value": 5982,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "4761",
            "value": 4761,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260928",
      "next_update": "20270906",
      "projection": false,
      "frequency": "Y",
      "tables": [
        {
          "table_code": "142201",
          "table_title": "아동학대 유형별 사례",
          "original_unit": "건",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1422&stts_cd=142201"
        }
      ]
    }
  },
  {
    "id": "stat:1428",
    "indicator_code": "1428",
    "table_code": "142801",
    "category": "아동",
    "title": "합계출산율",
    "description": "합계 출산율",
    "note": "지표누리 공식 API에서 확인한 1개 통계표의 연결 항목입니다. 수치가 제공되지 않은 시점은 빈 값으로 표시합니다.",
    "highlight_series_id": "api-2",
    "original_unit": "천명, 가임여자 1명당 명",
    "table_title": "합계 출산율",
    "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1428&stts_cd=142801",
    "indicator_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1428",
    "source_name": "국가데이터처, 『2024년 출생통계(확정), 국가승인통계 제101003호 출생통계』",
    "source_notes": "합계 출산율: * 합계 출산율 (TFR, Total Fertility Rate) : 여성 1명이 평생동안 낳을 것으로 예상되는 평균 출생아 수를 나타낸 지표로서 연령별 출산율(ASFR)의 총합이며, 출산력 수준을 나타내는 대표적 지표임",
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
        "label": "출생아 수",
        "source_label": "출생아 수",
        "unit": "천명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1428&stts_cd=142801",
        "points": [
          {
            "period": "2016",
            "raw": "406.2",
            "value": 406.2,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "357.8",
            "value": 357.8,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "326.8",
            "value": 326.8,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "302.7",
            "value": 302.7,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "272.3",
            "value": 272.3,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "260.6",
            "value": 260.6,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "249.2",
            "value": 249.2,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "230.0",
            "value": 230,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "238.3",
            "value": 238.3,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "254.341",
            "value": 254.341,
            "status": "VALUE"
          }
        ]
      },
      {
        "id": "api-2",
        "label": "합계 출산율",
        "source_label": "합계 출산율",
        "unit": "가임여성 1명당 명",
        "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1428&stts_cd=142801",
        "points": [
          {
            "period": "2016",
            "raw": "1.172",
            "value": 1.172,
            "status": "VALUE"
          },
          {
            "period": "2017",
            "raw": "1.052",
            "value": 1.052,
            "status": "VALUE"
          },
          {
            "period": "2018",
            "raw": "0.977",
            "value": 0.977,
            "status": "VALUE"
          },
          {
            "period": "2019",
            "raw": "0.918",
            "value": 0.918,
            "status": "VALUE"
          },
          {
            "period": "2020",
            "raw": "0.837",
            "value": 0.837,
            "status": "VALUE"
          },
          {
            "period": "2021",
            "raw": "0.808",
            "value": 0.808,
            "status": "VALUE"
          },
          {
            "period": "2022",
            "raw": "0.778",
            "value": 0.778,
            "status": "VALUE"
          },
          {
            "period": "2023",
            "raw": "0.721",
            "value": 0.721,
            "status": "VALUE"
          },
          {
            "period": "2024",
            "raw": "0.748",
            "value": 0.748,
            "status": "VALUE"
          },
          {
            "period": "2025",
            "raw": "0.80",
            "value": 0.8,
            "status": "VALUE"
          }
        ]
      }
    ],
    "index_api": {
      "updated_at": "20260928",
      "next_update": "20270225",
      "projection": false,
      "frequency": "Y",
      "tables": [
        {
          "table_code": "142801",
          "table_title": "합계 출산율",
          "original_unit": "천명, 가임여자 1명당 명",
          "frequency": "Y",
          "source_url": "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=1428&stts_cd=142801"
        }
      ]
    }
  }
];

export const INDEX_EXPANDED_SERIES = {
  "stat:1440": [
    {
      "id": "api-1",
      "key": "|T01|000||",
      "label": "암 검진 수검자 수 / 전체",
      "table_code": "144001"
    },
    {
      "id": "api-2",
      "key": "|T01|001||",
      "label": "암 검진 수검자 수 / 위암",
      "table_code": "144001"
    },
    {
      "id": "api-3",
      "key": "|T01|002||",
      "label": "암 검진 수검자 수 / 간암",
      "table_code": "144001"
    },
    {
      "id": "api-4",
      "key": "|T01|003||",
      "label": "암 검진 수검자 수 / 대장암",
      "table_code": "144001"
    },
    {
      "id": "api-5",
      "key": "|T01|004||",
      "label": "암 검진 수검자 수 / 유방암",
      "table_code": "144001"
    },
    {
      "id": "api-6",
      "key": "|T01|005||",
      "label": "암 검진 수검자 수 / 자궁경부암",
      "table_code": "144001"
    },
    {
      "id": "api-7",
      "key": "|T01|006||",
      "label": "암 검진 수검자 수 / 폐암",
      "table_code": "144001"
    },
    {
      "id": "api-8",
      "key": "|T02|000||",
      "label": "수검률 / 전체",
      "table_code": "144001"
    },
    {
      "id": "api-9",
      "key": "|T02|001||",
      "label": "수검률 / 위암",
      "table_code": "144001"
    },
    {
      "id": "api-10",
      "key": "|T02|002||",
      "label": "수검률 / 간암",
      "table_code": "144001"
    },
    {
      "id": "api-11",
      "key": "|T02|003||",
      "label": "수검률 / 대장암",
      "table_code": "144001"
    },
    {
      "id": "api-12",
      "key": "|T02|004||",
      "label": "수검률 / 유방암",
      "table_code": "144001"
    },
    {
      "id": "api-13",
      "key": "|T02|005||",
      "label": "수검률 / 자궁경부암",
      "table_code": "144001"
    },
    {
      "id": "api-14",
      "key": "|T02|006||",
      "label": "수검률 / 폐암",
      "table_code": "144001"
    }
  ],
  "stat:1451": [
    {
      "id": "api-1",
      "key": "|T01|||",
      "label": "뇌사 기증자 수",
      "table_code": "145101"
    }
  ],
  "stat:1425": [
    {
      "id": "api-1",
      "key": "|T03|||",
      "label": "계(세대당 부담액)",
      "table_code": "142501"
    },
    {
      "id": "api-2",
      "key": "|T01|||",
      "label": "지역가입자 부담액",
      "table_code": "142501"
    },
    {
      "id": "api-3",
      "key": "|T02|||",
      "label": "직장가입자 부담액",
      "table_code": "142501"
    }
  ],
  "stat:A0007": [
    {
      "id": "api-1",
      "key": "|T01|||",
      "label": "병상수",
      "table_code": "A000701"
    }
  ],
  "stat:2770": [
    {
      "id": "api-1",
      "key": "|T01|001||",
      "label": "모든 암(C00-C97) / 사망자수",
      "table_code": "277002"
    },
    {
      "id": "api-2",
      "key": "|T01|002||",
      "label": "모든 암(C00-C97) / 조사망률",
      "table_code": "277002"
    },
    {
      "id": "api-3",
      "key": "|T02|001||",
      "label": "위암(C16) / 사망자수",
      "table_code": "277002"
    },
    {
      "id": "api-4",
      "key": "|T02|002||",
      "label": "위암(C16) / 조사망률",
      "table_code": "277002"
    },
    {
      "id": "api-5",
      "key": "|T05|001||",
      "label": "대장암(C18-C21) / 사망자수",
      "table_code": "277002"
    },
    {
      "id": "api-6",
      "key": "|T05|002||",
      "label": "대장암(C18-C21) / 조사망률",
      "table_code": "277002"
    },
    {
      "id": "api-7",
      "key": "|T04|001||",
      "label": "간암(C22) / 사망자수",
      "table_code": "277002"
    },
    {
      "id": "api-8",
      "key": "|T04|002||",
      "label": "간암(C22) / 조사망률",
      "table_code": "277002"
    },
    {
      "id": "api-9",
      "key": "|T03|001||",
      "label": "폐암(C33-C34) / 사망자수",
      "table_code": "277002"
    },
    {
      "id": "api-10",
      "key": "|T03|002||",
      "label": "폐암(C33-C34) / 조사망률",
      "table_code": "277002"
    },
    {
      "id": "api-11",
      "key": "|T06|001||",
      "label": "유방암(C50) / 사망자수",
      "table_code": "277002"
    },
    {
      "id": "api-12",
      "key": "|T06|002||",
      "label": "유방암(C50) / 조사망률",
      "table_code": "277002"
    },
    {
      "id": "api-13",
      "key": "|T07|001||",
      "label": "자궁암(C53-C55) / 사망자수",
      "table_code": "277002"
    },
    {
      "id": "api-14",
      "key": "|T07|002||",
      "label": "자궁암(C53-C55) / 조사망률",
      "table_code": "277002"
    },
    {
      "id": "api-15",
      "key": "|T08|001||",
      "label": "기타암(Re.C00-C97) / 사망자수",
      "table_code": "277002"
    },
    {
      "id": "api-16",
      "key": "|T08|002||",
      "label": "기타암(Re.C00-C97) / 조사망률",
      "table_code": "277002"
    },
    {
      "id": "api-17",
      "key": "|T01|001||",
      "label": "모든 암(C00-C96) / 발생자수",
      "table_code": "277003"
    },
    {
      "id": "api-18",
      "key": "|T01|002||",
      "label": "모든 암(C00-C96) / 조발생률",
      "table_code": "277003"
    },
    {
      "id": "api-19",
      "key": "|T02|001||",
      "label": "위암(C16) / 발생자수",
      "table_code": "277003"
    },
    {
      "id": "api-20",
      "key": "|T02|002||",
      "label": "위암(C16) / 조발생률",
      "table_code": "277003"
    },
    {
      "id": "api-21",
      "key": "|T05|001||",
      "label": "대장암(C18-C20) / 발생자수",
      "table_code": "277003"
    },
    {
      "id": "api-22",
      "key": "|T05|002||",
      "label": "대장암(C18-C20) / 조발생률",
      "table_code": "277003"
    },
    {
      "id": "api-23",
      "key": "|T04|001||",
      "label": "간암(C22) / 발생자수",
      "table_code": "277003"
    },
    {
      "id": "api-24",
      "key": "|T04|002||",
      "label": "간암(C22) / 조발생률",
      "table_code": "277003"
    },
    {
      "id": "api-25",
      "key": "|T03|001||",
      "label": "폐암(C33-C34) / 발생자수",
      "table_code": "277003"
    },
    {
      "id": "api-26",
      "key": "|T03|002||",
      "label": "폐암(C33-C34) / 조발생률",
      "table_code": "277003"
    },
    {
      "id": "api-27",
      "key": "|T06|001||",
      "label": "유방암(C50) / 발생자수",
      "table_code": "277003"
    },
    {
      "id": "api-28",
      "key": "|T06|002||",
      "label": "유방암(C50) / 조발생률",
      "table_code": "277003"
    },
    {
      "id": "api-29",
      "key": "|T07|001||",
      "label": "자궁경부암(C53) / 발생자수",
      "table_code": "277003"
    },
    {
      "id": "api-30",
      "key": "|T07|002||",
      "label": "자궁경부암(C53) / 조발생률",
      "table_code": "277003"
    },
    {
      "id": "api-31",
      "key": "|T08|001||",
      "label": "기타암(Re.C00-C96) / 발생자수",
      "table_code": "277003"
    },
    {
      "id": "api-32",
      "key": "|T08|002||",
      "label": "기타암(Re.C00-C96) / 조발생률",
      "table_code": "277003"
    }
  ],
  "stat:2769": [
    {
      "id": "api-1",
      "key": "|T01|||",
      "label": "모성사망수",
      "table_code": "276901"
    },
    {
      "id": "api-2",
      "key": "|T02|||",
      "label": "모성사망비",
      "table_code": "276901"
    },
    {
      "id": "api-3",
      "key": "|T03|||",
      "label": "모성사망률",
      "table_code": "276901"
    },
    {
      "id": "api-4",
      "key": "|T01|||",
      "label": "신생아 사망률",
      "table_code": "276902"
    },
    {
      "id": "api-5",
      "key": "|T02|||",
      "label": "신생아 후기 사망률",
      "table_code": "276902"
    },
    {
      "id": "api-6",
      "key": "|T03|||",
      "label": "영아사망률",
      "table_code": "276902"
    }
  ],
  "stat:A0006": [
    {
      "id": "api-1",
      "key": "|T01|000||",
      "label": "인구 10만명당 의료인 수 / 계",
      "table_code": "A000601"
    },
    {
      "id": "api-2",
      "key": "|T01|001||",
      "label": "인구 10만명당 의료인 수 / 의사",
      "table_code": "A000601"
    },
    {
      "id": "api-3",
      "key": "|T01|002||",
      "label": "인구 10만명당 의료인 수 / 한의사",
      "table_code": "A000601"
    },
    {
      "id": "api-4",
      "key": "|T01|003||",
      "label": "인구 10만명당 의료인 수 / 치과의사",
      "table_code": "A000601"
    },
    {
      "id": "api-5",
      "key": "|T01|004||",
      "label": "인구 10만명당 의료인 수 / 조산사",
      "table_code": "A000601"
    },
    {
      "id": "api-6",
      "key": "|T01|005||",
      "label": "인구 10만명당 의료인 수 / 간호사",
      "table_code": "A000601"
    }
  ],
  "stat:1441": [
    {
      "id": "api-1",
      "key": "|T01|000|000|",
      "label": "정신장애 유병률 / 알코올 사용장애, 니코틴 사용장애, 우울장애, 불안장애 / 계",
      "table_code": "144102"
    },
    {
      "id": "api-2",
      "key": "|T01|000|001|",
      "label": "정신장애 유병률 / 알코올 사용장애, 니코틴 사용장애, 우울장애, 불안장애 / 남",
      "table_code": "144102"
    },
    {
      "id": "api-3",
      "key": "|T01|000|002|",
      "label": "정신장애 유병률 / 알코올 사용장애, 니코틴 사용장애, 우울장애, 불안장애 / 여",
      "table_code": "144102"
    },
    {
      "id": "api-4",
      "key": "|T01|002|000|",
      "label": "정신장애 유병률 / 알코올 사용장애 / 계",
      "table_code": "144102"
    },
    {
      "id": "api-5",
      "key": "|T01|002|001|",
      "label": "정신장애 유병률 / 알코올 사용장애 / 남",
      "table_code": "144102"
    },
    {
      "id": "api-6",
      "key": "|T01|002|002|",
      "label": "정신장애 유병률 / 알코올 사용장애 / 여",
      "table_code": "144102"
    },
    {
      "id": "api-7",
      "key": "|T01|001|000|",
      "label": "정신장애 유병률 / 니코틴 사용장애 / 계",
      "table_code": "144102"
    },
    {
      "id": "api-8",
      "key": "|T01|001|001|",
      "label": "정신장애 유병률 / 니코틴 사용장애 / 남",
      "table_code": "144102"
    },
    {
      "id": "api-9",
      "key": "|T01|001|002|",
      "label": "정신장애 유병률 / 니코틴 사용장애 / 여",
      "table_code": "144102"
    },
    {
      "id": "api-10",
      "key": "|T01|003|000|",
      "label": "정신장애 유병률 / 우울장애 / 계",
      "table_code": "144102"
    },
    {
      "id": "api-11",
      "key": "|T01|003|001|",
      "label": "정신장애 유병률 / 우울장애 / 남",
      "table_code": "144102"
    },
    {
      "id": "api-12",
      "key": "|T01|003|002|",
      "label": "정신장애 유병률 / 우울장애 / 여",
      "table_code": "144102"
    },
    {
      "id": "api-13",
      "key": "|T01|004|000|",
      "label": "정신장애 유병률 / 불안장애 / 계",
      "table_code": "144102"
    },
    {
      "id": "api-14",
      "key": "|T01|004|001|",
      "label": "정신장애 유병률 / 불안장애 / 남",
      "table_code": "144102"
    },
    {
      "id": "api-15",
      "key": "|T01|004|002|",
      "label": "정신장애 유병률 / 불안장애 / 여",
      "table_code": "144102"
    }
  ],
  "stat:1449": [
    {
      "id": "api-1",
      "key": "|T01|||",
      "label": "항생제 처방률",
      "table_code": "144902"
    },
    {
      "id": "api-2",
      "key": "|T02|||",
      "label": "주사제 처방률",
      "table_code": "144902"
    }
  ],
  "stat:1450": [
    {
      "id": "api-1",
      "key": "|T01|||",
      "label": "총인구",
      "table_code": "145001"
    },
    {
      "id": "api-2",
      "key": "|T02|000||",
      "label": "연 헌혈인구 / 계",
      "table_code": "145001"
    },
    {
      "id": "api-3",
      "key": "|T02|000001||",
      "label": "연 헌혈인구 / 헌혈률",
      "table_code": "145001"
    },
    {
      "id": "api-4",
      "key": "|T02|001||",
      "label": "연 헌혈인구 / 단체헌혈",
      "table_code": "145001"
    },
    {
      "id": "api-5",
      "key": "|T02|001001||",
      "label": "연 헌혈인구 / 단체비중",
      "table_code": "145001"
    },
    {
      "id": "api-6",
      "key": "|T02|002||",
      "label": "연 헌혈인구 / 개인헌혈",
      "table_code": "145001"
    },
    {
      "id": "api-7",
      "key": "|T02|002001||",
      "label": "연 헌혈인구 / 개인비중",
      "table_code": "145001"
    }
  ],
  "stat:2708": [
    {
      "id": "api-1",
      "key": "|T01|001||",
      "label": "입양 아동수 / 국내",
      "table_code": "270801"
    },
    {
      "id": "api-2",
      "key": "|T01|002||",
      "label": "입양 아동수 / 국외",
      "table_code": "270801"
    },
    {
      "id": "api-3",
      "key": "|T01|000||",
      "label": "입양 아동수 / 계",
      "table_code": "270801"
    },
    {
      "id": "api-4",
      "key": "|T01|001||",
      "label": "입양아동비율 / 국내",
      "table_code": "270802"
    },
    {
      "id": "api-5",
      "key": "|T01|002||",
      "label": "입양아동비율 / 국외",
      "table_code": "270802"
    },
    {
      "id": "api-6",
      "key": "|T01|000||",
      "label": "입양아동비율 / 계",
      "table_code": "270802"
    }
  ],
  "stat:1409": [
    {
      "id": "api-1",
      "key": "|T01|000||",
      "label": "노인 취업상태별 구성비 / 계",
      "table_code": "140901"
    },
    {
      "id": "api-2",
      "key": "|T01|001||",
      "label": "노인 취업상태별 구성비 / 취업중",
      "table_code": "140901"
    },
    {
      "id": "api-3",
      "key": "|T01|002||",
      "label": "노인 취업상태별 구성비 / 비취업",
      "table_code": "140901"
    }
  ],
  "stat:2711": [
    {
      "id": "api-1",
      "key": "|T01|002||",
      "label": "사망자수 / 18세 미만 인구(천명)",
      "table_code": "271101"
    },
    {
      "id": "api-2",
      "key": "|T01|003||",
      "label": "사망자수 / 아동안전사고 사망자수",
      "table_code": "271101"
    },
    {
      "id": "api-3",
      "key": "|T01|004||",
      "label": "사망자수 / 아동10만명당 안전사고 사망자수",
      "table_code": "271101"
    }
  ],
  "stat:2710": [
    {
      "id": "api-1",
      "key": "|T01|018||",
      "label": "장애인 월평균 소득 / 전국 임금근로자",
      "table_code": "271002"
    },
    {
      "id": "api-2",
      "key": "|T01|002||",
      "label": "장애인 월평균 소득 / 전체장애인",
      "table_code": "271002"
    },
    {
      "id": "api-3",
      "key": "|T01|003||",
      "label": "장애인 월평균 소득 / 지체장애",
      "table_code": "271002"
    },
    {
      "id": "api-4",
      "key": "|T01|004||",
      "label": "장애인 월평균 소득 / 뇌병변장애",
      "table_code": "271002"
    },
    {
      "id": "api-5",
      "key": "|T01|005||",
      "label": "장애인 월평균 소득 / 시각장애",
      "table_code": "271002"
    },
    {
      "id": "api-6",
      "key": "|T01|006||",
      "label": "장애인 월평균 소득 / 청각장애",
      "table_code": "271002"
    },
    {
      "id": "api-7",
      "key": "|T01|007||",
      "label": "장애인 월평균 소득 / 언어장애",
      "table_code": "271002"
    },
    {
      "id": "api-8",
      "key": "|T01|008||",
      "label": "장애인 월평균 소득 / 지적장애",
      "table_code": "271002"
    },
    {
      "id": "api-9",
      "key": "|T01|009||",
      "label": "장애인 월평균 소득 / 자폐성장애",
      "table_code": "271002"
    },
    {
      "id": "api-10",
      "key": "|T01|010||",
      "label": "장애인 월평균 소득 / 정신장애",
      "table_code": "271002"
    },
    {
      "id": "api-11",
      "key": "|T01|011||",
      "label": "장애인 월평균 소득 / 신장장애",
      "table_code": "271002"
    },
    {
      "id": "api-12",
      "key": "|T01|012||",
      "label": "장애인 월평균 소득 / 심장장애",
      "table_code": "271002"
    },
    {
      "id": "api-13",
      "key": "|T01|013||",
      "label": "장애인 월평균 소득 / 호흡기장애",
      "table_code": "271002"
    },
    {
      "id": "api-14",
      "key": "|T01|014||",
      "label": "장애인 월평균 소득 / 간장애",
      "table_code": "271002"
    },
    {
      "id": "api-15",
      "key": "|T01|015||",
      "label": "장애인 월평균 소득 / 안면장애",
      "table_code": "271002"
    },
    {
      "id": "api-16",
      "key": "|T01|016||",
      "label": "장애인 월평균 소득 / 장루.요루장애",
      "table_code": "271002"
    },
    {
      "id": "api-17",
      "key": "|T01|017||",
      "label": "장애인 월평균 소득 / 뇌전증장애",
      "table_code": "271002"
    },
    {
      "id": "api-18",
      "key": "|T01|001||",
      "label": "장애인 월평균 소득 / 상용근로자",
      "table_code": "271002"
    }
  ],
  "stat:1422": [
    {
      "id": "api-1",
      "key": "|T01|000||",
      "label": "아동학대 유형별 사례건수 / 계",
      "table_code": "142201"
    },
    {
      "id": "api-2",
      "key": "|T01|001||",
      "label": "아동학대 유형별 사례건수 / 신체학대",
      "table_code": "142201"
    },
    {
      "id": "api-3",
      "key": "|T01|002||",
      "label": "아동학대 유형별 사례건수 / 정서학대",
      "table_code": "142201"
    },
    {
      "id": "api-4",
      "key": "|T01|003||",
      "label": "아동학대 유형별 사례건수 / 성학대",
      "table_code": "142201"
    },
    {
      "id": "api-5",
      "key": "|T01|004||",
      "label": "아동학대 유형별 사례건수 / 방임",
      "table_code": "142201"
    },
    {
      "id": "api-6",
      "key": "|T01|005||",
      "label": "아동학대 유형별 사례건수 / 유기",
      "table_code": "142201"
    },
    {
      "id": "api-7",
      "key": "|T01|006||",
      "label": "아동학대 유형별 사례건수 / 중복학대",
      "table_code": "142201"
    }
  ],
  "stat:1428": [
    {
      "id": "api-1",
      "key": "|T01|||",
      "label": "출생아 수",
      "table_code": "142801"
    },
    {
      "id": "api-2",
      "key": "|T02|||",
      "label": "합계 출산율",
      "table_code": "142801"
    }
  ]
};

