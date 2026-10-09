-- 행정구 보건소 부서 범위 보완(2026-10-09, 운영자 지시: 과 단위 보건소 부서가 빠지지 않게).
-- 행정구는 상위 시 세출의 부서코드 앞자리로 고르는데, 구 이름이 붙은 보건소의 과(11xx 등)는 앞자리가 달라 구를 고르면 빠졌다.
-- 근거: 행정안전부 행정표준코드 기관코드 전체자료(2026-10-08) 현존 조직의 구 보건소(예: 3740031 경기도 수원시 장안구보건소).
-- 보건소 하나가 행정구 하나에만 대응할 때만 넣는다. 창원보건소·마산보건소(각 2개 구)와 전주시보건소 보건행정과(시 전체)는 시 단위로 둔다.
-- 7자리 전체 코드는 그 부서 하나만 고른다. 현재 값이 예상과 같을 때만 바꾼다.
-- 창원시 진해구: 1115005 진해보건소보건행정과 [5670071]
UPDATE fiscal_admin_unit SET dept_prefix = '7,1115005' WHERE unit_id = 'admin:4811000:7' AND dept_prefix = '7';
-- 수원시 장안구: 1105010 장안구보건소보건행정과 [3740031], 1105056 장안구보건소건강관리과 [3740031], 1105060 장안구보건소감염병관리과 [3740031]
UPDATE fiscal_admin_unit SET dept_prefix = '3,1105010,1105056,1105060' WHERE unit_id = 'admin:4111000:3' AND dept_prefix = '3';
-- 수원시 권선구: 1105020 권선구보건소보건행정과 [3740032], 1105057 권선구보건소건강관리과 [3740032]
UPDATE fiscal_admin_unit SET dept_prefix = '4,1105020,1105057' WHERE unit_id = 'admin:4111000:4' AND dept_prefix = '4';
-- 수원시 팔달구: 1105030 팔달구보건소보건행정과 [3740033], 1105058 팔달구보건소건강관리과 [3740033]
UPDATE fiscal_admin_unit SET dept_prefix = '5,1105030,1105058' WHERE unit_id = 'admin:4111000:5' AND dept_prefix = '5';
-- 수원시 영통구: 1105040 영통구보건소보건행정과 [3740106], 1105059 영통구보건소건강관리과 [3740106]
UPDATE fiscal_admin_unit SET dept_prefix = '6,1105040,1105059' WHERE unit_id = 'admin:4111000:6' AND dept_prefix = '6';
-- 성남시 수정구: 1105010 수정구보건소보건행정과 [3780062], 1106002 수정구보건소건강증진과 [3780062]
UPDATE fiscal_admin_unit SET dept_prefix = '3,1105010,1106002' WHERE unit_id = 'admin:4112000:3' AND dept_prefix = '3';
-- 성남시 중원구: 1105020 중원구보건소보건행정과 [3780063], 1107003 중원구보건소건강증진과 [3780063]
UPDATE fiscal_admin_unit SET dept_prefix = '4,1105020,1107003' WHERE unit_id = 'admin:4112000:4' AND dept_prefix = '4';
-- 성남시 분당구: 1105030 분당구보건소보건행정과 [3780064], 1108004 분당구보건소건강증진과 [3780064], 1108005 분당구보건소감염병관리센터 [3780064]
UPDATE fiscal_admin_unit SET dept_prefix = '5,1105030,1108004,1108005' WHERE unit_id = 'admin:4112000:5' AND dept_prefix = '5';
-- 안양시 동안구: 1103004 동안보건정책과 [3830263]
UPDATE fiscal_admin_unit SET dept_prefix = '4,1103004' WHERE unit_id = 'admin:4114000:4' AND dept_prefix = '4';
-- 안양시 만안구: 1105021 만안보건정책과 [3830262]
UPDATE fiscal_admin_unit SET dept_prefix = '3,1105021' WHERE unit_id = 'admin:4114000:3' AND dept_prefix = '3';
-- 안산시 상록구: 1105010 상록보건정책과 [3930162]
UPDATE fiscal_admin_unit SET dept_prefix = '3,1105010' WHERE unit_id = 'admin:4119000:3' AND dept_prefix = '3';
-- 안산시 단원구: 1105020 단원보건정책과 [3930154]
UPDATE fiscal_admin_unit SET dept_prefix = '4,1105020' WHERE unit_id = 'admin:4119000:4' AND dept_prefix = '4';
-- 고양시 덕양구: 1105010 덕양구보건소보건행정과 [3940138], 1105047 덕양구보건소건강증진과 [3940138]
UPDATE fiscal_admin_unit SET dept_prefix = '3,1105010,1105047' WHERE unit_id = 'admin:4120000:3' AND dept_prefix = '3';
-- 고양시 일산동구: 1105020 일산동구보건소보건행정과 [3940139], 1105048 일산동구보건소건강증진과 [3940139]
UPDATE fiscal_admin_unit SET dept_prefix = '4,1105020,1105048' WHERE unit_id = 'admin:4120000:4' AND dept_prefix = '4';
-- 고양시 일산서구: 1105030 일산서구보건소보건행정과 [3940140], 1105049 일산서구보건소건강증진과 [3940140]
UPDATE fiscal_admin_unit SET dept_prefix = '5,1105030,1105049' WHERE unit_id = 'admin:4120000:5' AND dept_prefix = '5';
-- 용인시 처인구: 1110013 처인구보건소보건정책과 [4050147], 1110014 처인구보건소건강증진과 [4050147]
UPDATE fiscal_admin_unit SET dept_prefix = '3,1110013,1110014' WHERE unit_id = 'admin:4129000:3' AND dept_prefix = '3';
-- 용인시 기흥구: 1115011 기흥구보건소보건행정과 [4050148], 1115012 기흥구보건소건강증진과 [4050148]
UPDATE fiscal_admin_unit SET dept_prefix = '4,1115011,1115012' WHERE unit_id = 'admin:4129000:4' AND dept_prefix = '4';
-- 용인시 수지구: 1120011 수지구보건소보건행정과 [4050149], 1120012 수지구보건소건강증진과 [4050149]
UPDATE fiscal_admin_unit SET dept_prefix = '5,1120011,1120012' WHERE unit_id = 'admin:4129000:5' AND dept_prefix = '5';
-- 부천시 소사구: 2115010 소사보건소 [3860577]
UPDATE fiscal_admin_unit SET dept_prefix = '2010,2115010' WHERE unit_id = 'admin:4115000:2010' AND dept_prefix = '2010';
-- 부천시 오정구: 2120010 오정보건소 [3860578]
UPDATE fiscal_admin_unit SET dept_prefix = '2011,2120010' WHERE unit_id = 'admin:4115000:2011' AND dept_prefix = '2011';
-- 화성시 효행구: 1105001 효행구보건행정과 [5530659]
UPDATE fiscal_admin_unit SET dept_prefix = '2004,1105001' WHERE unit_id = 'admin:4134000:2004' AND dept_prefix = '2004';
-- 화성시 만세구: 1110010 만세구보건정책과 [5530658]
UPDATE fiscal_admin_unit SET dept_prefix = '2003,1110010' WHERE unit_id = 'admin:4134000:2003' AND dept_prefix = '2003';
-- 화성시 병점구: 1110020 병점구보건행정과 [5530660]
UPDATE fiscal_admin_unit SET dept_prefix = '2005,2120,1110020' WHERE unit_id = 'admin:4134000:2005' AND dept_prefix = '2005,2120';
-- 화성시 동탄구: 2127001 동탄구보건행정과 [5530506]
UPDATE fiscal_admin_unit SET dept_prefix = '2006,2103,2127001' WHERE unit_id = 'admin:4134000:2006' AND dept_prefix = '2006,2103';
-- 청주시 상당구: 1004800 상당보건소보건정책과 [5710106], 1101001 상당보건소감염병대응과 [5710106], 1105034 상당보건소건강증진과 [5710106]
UPDATE fiscal_admin_unit SET dept_prefix = '200,1004800,1101001,1105034' WHERE unit_id = 'admin:4314000:200' AND dept_prefix = '200';
-- 청주시 서원구: 1004900 서원보건소 [5710107]
UPDATE fiscal_admin_unit SET dept_prefix = '250,1004900' WHERE unit_id = 'admin:4314000:250' AND dept_prefix = '250';
-- 청주시 흥덕구: 1005100 흥덕보건소 [5710108]
UPDATE fiscal_admin_unit SET dept_prefix = '300,1005100' WHERE unit_id = 'admin:4314000:300' AND dept_prefix = '300';
-- 청주시 청원구: 1005200 청원보건소 [5710109]
UPDATE fiscal_admin_unit SET dept_prefix = '350,1005200' WHERE unit_id = 'admin:4314000:350' AND dept_prefix = '350';
-- 천안시 동남구: 1101001 동남구보건소 [4490260]
UPDATE fiscal_admin_unit SET dept_prefix = '2006,1101001' WHERE unit_id = 'admin:4411000:2006' AND dept_prefix = '2006';
-- 전주시 덕진구: 1105025 덕진보건소 [4641062]
UPDATE fiscal_admin_unit SET dept_prefix = '4,1105025' WHERE unit_id = 'admin:4511000:4' AND dept_prefix = '4';
-- 포항시 남구: 1102002 남구보건소보건정책과 [5020055], 1102003 남구보건소건강관리과 [5020055]
UPDATE fiscal_admin_unit SET dept_prefix = '3,1102002,1102003' WHERE unit_id = 'admin:4711000:3' AND dept_prefix = '3';
-- 포항시 북구: 1104001 북구보건소보건정책과 [5020056], 1104002 북구보건소건강관리과 [5020056]
UPDATE fiscal_admin_unit SET dept_prefix = '4,1104001,1104002' WHERE unit_id = 'admin:4711000:4' AND dept_prefix = '4';
-- 천안시 서북구: 1102001 보건정책과 [4490361]
UPDATE fiscal_admin_unit SET dept_prefix = '2007,1102001' WHERE unit_id = 'admin:4411000:2007' AND dept_prefix = '2007';
