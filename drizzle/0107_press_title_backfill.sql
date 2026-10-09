-- 2026-10-09 운영자 요청: 목록에서 줄여 저장된 공개 보도자료 제목을 원문 화면의 전체 제목으로 바꾼다(데스크톱에서 원문 확인). 그 사이 제목이 바뀐 글은 건드리지 않는다.
UPDATE press_item SET title = '2026년 10월 5일_달성군, 국가유공자 예우 강화 올해 ‘보훈단체 복지 지원 사업’ 첫 시행', title_hash = '600da0d316776428865d47bc9710c6c5', title_version = title_version + 1 WHERE item_id = 'src:www.dalseong.daegu.kr:press:0a4da69605d560d9a58313b62e418809' AND title = '2026년 10월 5일_달성군, 국가유공자 예우 강화 올해 ...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.dalseong.daegu.kr:press:0a4da69605d560d9a58313b62e418809', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '2026년 10월 8일_달성군, 비슬청춘대학 어르신들과 함께 경북 안동으로 가을 문화 탐방 떠나다', title_hash = 'de7cca2499f1e9c98c8bb70aaeb76ac8', title_version = title_version + 1 WHERE item_id = 'src:www.dalseong.daegu.kr:press:6223bf3a06801272e9c2f3c94374fcd9' AND title = '2026년 10월 8일_달성군, 비슬청춘대학 어르신들과 함께 경...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.dalseong.daegu.kr:press:6223bf3a06801272e9c2f3c94374fcd9', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '2026년 10월 5일_달성군청소년문화의집 청소년방과후아카데미 ‘청소년 학습전략 검사’ 실시', title_hash = 'c65628db186662a8127f2d040f5b6aea', title_version = title_version + 1 WHERE item_id = 'src:www.dalseong.daegu.kr:press:b4e6cdaa3872c277e2877d25713c1b93' AND title = '2026년 10월 5일_달성군청소년문화의집 청소년방과후아카데미 ...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.dalseong.daegu.kr:press:b4e6cdaa3872c277e2877d25713c1b93', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '해운대구, 1인 가구 청년들의 특별한 ‘함께 한 끼’', title_hash = '548258b1134672dc4c63c296d2dd5593', title_version = title_version + 1 WHERE item_id = 'src:eminwon.haeundae.go.kr:press:10e4770a00126b522d2ee7fa9c994296' AND title = '해운대구, 1인 가구 청년들의 특별한 ‘함께 ...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:eminwon.haeundae.go.kr:press:10e4770a00126b522d2ee7fa9c994296', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '서대신1동 지역사회보장협의체, 『어서와∼고분도리는 처음이지』 안부확인 실시', title_hash = 'c2b692d9ac7decae6e7ef05b0a5ded75', title_version = title_version + 1 WHERE item_id = 'src:www.bsseogu.go.kr:press:43b4c8b2bd8584510c916d089a8a6bb2' AND title = '서대신1동 지역사회보장협의체, 『어서와∼고분도리는 처음이지』 안부확인 실..';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.bsseogu.go.kr:press:43b4c8b2bd8584510c916d089a8a6bb2', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '괴산군, 18개 보건진료소 독감 예방접종 재개… ‘군민 건강 밀착 보호’', title_hash = '2e952fd96872784563d28a8c42dc60c1', title_version = title_version + 1 WHERE item_id = 'src:www.goesan.go.kr:press:3a621d034e7c90f698694ebbb77c13da' AND title = '괴산군, 18개 보건진료소 독감 예방접종 재개… ‘군민...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.goesan.go.kr:press:3a621d034e7c90f698694ebbb77c13da', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '괴산군 불정면 자치봉사회, 관내 경로당 34곳에 ‘사랑의 쌀·국수’ 나눔', title_hash = 'd9d399370c1dee0543877ec32a3fff91', title_version = title_version + 1 WHERE item_id = 'src:www.goesan.go.kr:press:6b893aad25d8b0b8a35a45a12c3d9912' AND title = '괴산군 불정면 자치봉사회, 관내 경로당 34곳에 ‘사랑...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.goesan.go.kr:press:6b893aad25d8b0b8a35a45a12c3d9912', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '괴산군, ''임신부 걷기 챌린지'' 운영… ‘건강한 출산 응원해요’', title_hash = '5b0cfbbe033d553edb30c9defb5d130c', title_version = title_version + 1 WHERE item_id = 'src:www.goesan.go.kr:press:c4dde782eafe193e59081623ce101f39' AND title = '괴산군, ''임신부 걷기 챌린지'' 운영… ‘건강한 출산 ...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.goesan.go.kr:press:c4dde782eafe193e59081623ce101f39', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '‘배움이 일자리로, 일자리가 어르신 돌봄으로’ 태안군, 청․장년 재취업과 어르신 치매 예방 두 마리 토끼 잡았다', title_hash = 'd2025823dc26893b6fa3445034e11790', title_version = title_version + 1 WHERE item_id = 'src:www.taean.go.kr:press:c1b4fe4159871b1971386a5cc37dced2' AND title = '‘배움이 일자리로, 일자리가 어르신 돌봄으로’ 태안군, 청․장년 재취업과 어르신 치매 예방...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.taean.go.kr:press:c1b4fe4159871b1971386a5cc37dced2', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '행복한 동행, 완산지사협『마실 파트너』지원 사업 추진', title_hash = '9142a29a678d38f666749cb883e7befe', title_version = title_version + 1 WHERE item_id = 'src:www.yc.go.kr:press:c7284e4ba80265494ec7144c78693e91' AND title = '행복한 동행, 완산지사협『마실 파트너』지원...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.yc.go.kr:press:c7284e4ba80265494ec7144c78693e91', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '“같이 걸으니 더 가까워졌어요” 해운대 다문화가족축제', title_hash = '8f60990512736bc92da33a0daf179f17', title_version = title_version + 1 WHERE item_id = 'src:eminwon.haeundae.go.kr:press:f56fced342900084906963b8976d40f3' AND title = '“같이 걸으니 더 가까워졌어요” 해운대 다문화...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:eminwon.haeundae.go.kr:press:f56fced342900084906963b8976d40f3', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '해운대구 드림스타트, 2026년 사업운영 평가 ‘우수기관’ 선정', title_hash = '6c90218c387d69ed5e06d78771446b68', title_version = title_version + 1 WHERE item_id = 'src:eminwon.haeundae.go.kr:press:fde3c4ed9f149e14129249716f51cf58' AND title = '해운대구 드림스타트, 2026년 사업운영 평가...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:eminwon.haeundae.go.kr:press:fde3c4ed9f149e14129249716f51cf58', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '달서구 용산2동, 저소득 노인·장애인 가정에 주택용 소방시설 전달', title_hash = '8f2ca49737980eff9800d7875c6f370f', title_version = title_version + 1 WHERE item_id = 'src:www.dalseo.daegu.kr:press:1594b56459ed1ea3f9921963721519a0' AND title = '달서구 용산2동, 저소득 노인·장애인 가정에 주택용 소방시설 전...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.dalseo.daegu.kr:press:1594b56459ed1ea3f9921963721519a0', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '달서구, 출산‧육아 정책정보를 생활 가까이 잇는다 「출산BooM 달서 함께온(ON)」참여공간 30개소 지정', title_hash = '09ffa5a77f0834b85a09ea4c4e7adec1', title_version = title_version + 1 WHERE item_id = 'src:www.dalseo.daegu.kr:press:ba06e71fc92da3ba874486bb1ce51d8c' AND title = '달서구, 출산‧육아 정책정보를 생활 가까이 잇는다 「출산BooM...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.dalseo.daegu.kr:press:ba06e71fc92da3ba874486bb1ce51d8c', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '화촌면 지역사회 보장협의체, 거동불편 어르신 방문목욕서비스 지역특화사업 추진', title_hash = '2655fd7c0e4fdfb0eedf4f050a8c0ae3', title_version = title_version + 1 WHERE item_id = 'src:www.hongcheon.go.kr:press:2f4dfff7d8ff32c4a5bcc753b3217205' AND title = '화촌면 지역사회 보장협의체, 거동불편 어르신 방문목욕서비스 지역특화사업 ...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.hongcheon.go.kr:press:2f4dfff7d8ff32c4a5bcc753b3217205', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '신안군, 주간재활 회원 대상 정신건강 힐링 프로그램 운영..주간재활 프로그램 ‘어울림’ 회원 9명, 사회적응훈련 참여', title_hash = '124cc6439b63cb8f72daf8d6f53d0cd7', title_version = title_version + 1 WHERE item_id = 'src:www.shinan.go.kr:press:4da9f3afad5402dbfa5324d037ea46b5' AND title = '신안군, 주간재활 회원 대상 정신건강 힐링 프로그램...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.shinan.go.kr:press:4da9f3afad5402dbfa5324d037ea46b5', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '학산농협, 양산면 어르신들을 위한 ‘보행보조기 기탁’으로 나눔 실천', title_hash = 'cbe6c65eefc83b16729a874bb18b1125', title_version = title_version + 1 WHERE item_id = 'src:www.yd21.go.kr:press:45a57d4e639180407ce7efc63f7ee0e7' AND title = '학산농협, 양산면 어르신들을 위한 ‘보행보조기 기탁’으로 나눔...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.yd21.go.kr:press:45a57d4e639180407ce7efc63f7ee0e7', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '영동군정신건강복지센터, 자살예방 및 정신건강의 날 맞아 잇따른 수상 성과', title_hash = '2c76bb43c8e51fce29610bf4f3a2c324', title_version = title_version + 1 WHERE item_id = 'src:www.yd21.go.kr:press:defcb9e8ed298588ef72db0946dd86a1' AND title = '영동군정신건강복지센터, 자살예방 및 정신건강의 날 맞아 잇따른...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.yd21.go.kr:press:defcb9e8ed298588ef72db0946dd86a1', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '해운대구 새마을며느리봉사대, 결연 어르신과 가을 나들이', title_hash = 'a204cd0d6947efb3f8727c4bd9b5600e', title_version = title_version + 1 WHERE item_id = 'src:eminwon.haeundae.go.kr:press:239be8283904928026da543c145838e4' AND title = '해운대구 새마을며느리봉사대, 결연 어르신과 가...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:eminwon.haeundae.go.kr:press:239be8283904928026da543c145838e4', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '대구 남구보건소 주민과 함께 걷는 ''이천동 오늘도 걷는Day'' 운영', title_hash = '3dbb10be9c8c6e5b10012c47cc082575', title_version = title_version + 1 WHERE item_id = 'src:nam.daegu.kr:press:ca58d7f2a6af38ae826fa27ce807b640' AND title = '대구 남구보건소 주민과 함께 걷는 ''이천동 오늘도 걷는Day'' ...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:nam.daegu.kr:press:ca58d7f2a6af38ae826fa27ce807b640', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '북방면 건강생활지원센터‘씬(thin)나는 요가 교실’야외 요가 프로그램 성료', title_hash = 'fd3481da31454d5ba31cd58ee59f2b40', title_version = title_version + 1 WHERE item_id = 'src:www.hongcheon.go.kr:press:7d5b6e69b9b45bbc4863013ef57ed161' AND title = '북방면 건강생활지원센터‘씬(thin)나는 요가 교실’야외 요가 프로그램 ...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.hongcheon.go.kr:press:7d5b6e69b9b45bbc4863013ef57ed161', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '신안군 ‘아동양육수당’ 신설 추진...최대 월 70만 원 지원..민선 9기 핵심 공약 ‘복지·의료 체계 개선’ 분야 확대 추진', title_hash = 'c318e86c1bc5605dbf6176123a22f506', title_version = title_version + 1 WHERE item_id = 'src:www.shinan.go.kr:press:40dbe9bed3b2039496fd1905742bdcea' AND title = '신안군 ‘아동양육수당’ 신설 추진...최대 월 70만 원 지원.....';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.shinan.go.kr:press:40dbe9bed3b2039496fd1905742bdcea', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '‘영농부산물 태우지 말고 파쇄하세요’ 어르신 힘든 밭 정리, 태안군 파쇄지원단이 뚝딱 해결해 드립니다!', title_hash = '2c2139e3dd6592a3d173b998aef64848', title_version = title_version + 1 WHERE item_id = 'src:www.taean.go.kr:press:2ff82836ef2861f3bec936679389ab1c' AND title = '‘영농부산물 태우지 말고 파쇄하세요’ 어르신 힘든 밭 정리, 태안군 파쇄지원단이 뚝딱 해결...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.taean.go.kr:press:2ff82836ef2861f3bec936679389ab1c', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '2026년 10월 1일_하빈면 지역사회보장협의체, ‘주방애(愛) 온기 더하기’로 따뜻한 나눔 실천', title_hash = '23d89f19faeec35852802642e6f9054a', title_version = title_version + 1 WHERE item_id = 'src:www.dalseong.daegu.kr:press:563b237ca23f38e4cf5954493e2f5656' AND title = '2026년 10월 1일_하빈면 지역사회보장협의체, ‘주방애(愛...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.dalseong.daegu.kr:press:563b237ca23f38e4cf5954493e2f5656', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '고흥군, 제30회 노인의 날 ‘통합보건사업 홍보관’ 운영', title_hash = '60b58479d984b495d49ad687f4a4bfbe', title_version = title_version + 1 WHERE item_id = 'src:www.goheung.go.kr:press:20fa3af8f149558ffcccb32195791fc8' AND title = '고흥군, 제30회 노인의 날 ‘통합보건사업 홍보관’ 운...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.goheung.go.kr:press:20fa3af8f149558ffcccb32195791fc8', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '전국 최고 장수도시 고흥군, 제30회 노인의 날 기념행사 성료', title_hash = '5bd2458a17ebda7c795735abb10a6f39', title_version = title_version + 1 WHERE item_id = 'src:www.goheung.go.kr:press:9704538eb8916fc03026b862487f6437' AND title = '전국 최고 장수도시 고흥군, 제30회 노인의 날 기념행...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.goheung.go.kr:press:9704538eb8916fc03026b862487f6437', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '“걸어오신 길에 존경을! 함께 할 날들에 행복을!”…함평군, 제30회 노인의 날 기념행사 성료', title_hash = 'ec33cc7a03bb9a6268b2ff087ef3af14', title_version = title_version + 1 WHERE item_id = 'src:www.hampyeong.go.kr:press:c99dc9a35cb90d0ddf50c0f8a50c3446' AND title = '“걸어오신 길에 존경을! 함께 할 날들에 행복을!”…함평군, 제30회 노인의 날 기념행사 ...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.hampyeong.go.kr:press:c99dc9a35cb90d0ddf50c0f8a50c3446', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '“영웅들의 달콤충전”… 영동군청소년수련관 청소년들, 중앙지구대에 수제 초코쿠키 전달', title_hash = 'c4efc99e6b1b280fcc75b5906cfbd3b0', title_version = title_version + 1 WHERE item_id = 'src:www.yd21.go.kr:press:0bab79fd899fad91bb148103435088cf' AND title = '“영웅들의 달콤충전”… 영동군청소년수련관 청소년들, 중앙지...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.yd21.go.kr:press:0bab79fd899fad91bb148103435088cf', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '행복가득노인교실 시니어모델, 대전효문화뿌리축제에서 당당한 런웨이 선보여~', title_hash = 'f5c6e0e3f8964be84bd47c16f007ec96', title_version = title_version + 1 WHERE item_id = 'src:www.yd21.go.kr:press:81175e7a10f24e2d8ebc12264e134ef5' AND title = '행복가득노인교실 시니어모델, 대전효문화뿌리축제에서 당당한 ...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.yd21.go.kr:press:81175e7a10f24e2d8ebc12264e134ef5', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '해운대구, 치매환자와 걷기동아리가 함께하는 ‘기억줍깅’', title_hash = 'b9a6b70bea53599e5932c954b66b0592', title_version = title_version + 1 WHERE item_id = 'src:eminwon.haeundae.go.kr:press:7ff694d5310a287055fe07b50d31f508' AND title = '해운대구, 치매환자와 걷기동아리가 함께하는 ‘...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:eminwon.haeundae.go.kr:press:7ff694d5310a287055fe07b50d31f508', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '2026년 9월 30일_달성군보건소, 군민 혈관건강 위해 심뇌혈관질환 안심 카페 지정', title_hash = '8f28fdc4a345c57d2167af23199b8d89', title_version = title_version + 1 WHERE item_id = 'src:www.dalseong.daegu.kr:press:94a11853313c74d5024823e1cb44119f' AND title = '2026년 9월 30일_달성군보건소, 군민 혈관건강 위해 심뇌...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.dalseong.daegu.kr:press:94a11853313c74d5024823e1cb44119f', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '홍천군, 3분기 의료 협의체 개최 의·약사회 및 관내 의료기관과 감염병 예방·지역 보건의료 현안 논의', title_hash = '6e5333da58215bd71ef6f2703bad7ed2', title_version = title_version + 1 WHERE item_id = 'src:www.hongcheon.go.kr:press:e036fde40ec0b89545a643bf70cf675f' AND title = '홍천군, 3분기 의료 협의체 개최 의·약사회 및 관내 의료기관과 감염병 ...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.hongcheon.go.kr:press:e036fde40ec0b89545a643bf70cf675f', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '노원구, ‘경로의 달’ 맞아 어르신 행사 잇달아... 노인의 날 기념행사·어르신 디지털 골든벨 개최', title_hash = '52d3d74de2a089445323636c6d1a0554', title_version = title_version + 1 WHERE item_id = 'src:www.nowon.kr:press:ac159c8700b0c10f77d43228f9d775ab' AND title = '노원구, ‘경로의 달’ 맞아 어르신 행사 잇달아... 노인의 날 기념행사·어르신 디지털 골...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.nowon.kr:press:ac159c8700b0c10f77d43228f9d775ab', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '지도읍 지역사회보장협의체, ‘지도사랑 나눔 천사 기부 릴레이’ 첫 출발..''송현중 읍장·김용범 위원장 등 5명, 각 30만 원씩 기부''', title_hash = 'e8a7b9c71e925e5ccfbeb674fc8fb030', title_version = title_version + 1 WHERE item_id = 'src:www.shinan.go.kr:press:9bb1ec51e729478dab5bbd40db370ce6' AND title = '지도읍 지역사회보장협의체, ‘지도사랑 나눔 천사 기부 릴레이’ 첫...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.shinan.go.kr:press:9bb1ec51e729478dab5bbd40db370ce6', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '울릉군, 오지마을 치매극복 인식개선 및 배회대처 모의훈련 개최', title_hash = '465f1968218bc7b847788431e1b7cdd3', title_version = title_version + 1 WHERE item_id = 'src:www.ulleung.go.kr:press:d351b53a1ad4b61af3d6e771b5de622b' AND title = '울릉군, 오지마을 치매극복 인식개선 및 배회대처 모의훈...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.ulleung.go.kr:press:d351b53a1ad4b61af3d6e771b5de622b', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '영동농협 고향주부모임, 사랑의 반찬나눔으로 따뜻한 이웃사랑 실천', title_hash = '0e74c42d0f09aff0d494d3b52ffa8289', title_version = title_version + 1 WHERE item_id = 'src:www.yd21.go.kr:press:1ff196c17d04bea96e39f0894d9f1860' AND title = '영동농협 고향주부모임, 사랑의 반찬나눔으로 따뜻한 이웃사랑 실...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.yd21.go.kr:press:1ff196c17d04bea96e39f0894d9f1860', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '월출산 달빛 아래 펼치는 나만의 무대…영암 뮤직 페스티벌 참가자 모집', title_hash = '9998ec0c7347a67ee028f13d631dd5df', title_version = title_version + 1 WHERE item_id = 'src:www.yeongam.go.kr:press:a4a98a07e5111ee901b8c6a526927038' AND title = '월출산 달빛 아래 펼치는 나만의 무대…영암 뮤직 페스티벌 참가자 모...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.yeongam.go.kr:press:a4a98a07e5111ee901b8c6a526927038', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '부산 북구 민관협력으로 취약계층 반려가구 지원 반려동물 친화문화 조성 나선다', title_hash = '7058f93d6c15624cb09db2c9439cc9cc', title_version = title_version + 1 WHERE item_id = 'src:eminwon.bsbukgu.go.kr:press:159174f88d0fcb69bdcc52a7868eb45b' AND title = '부산 북구 민관협력으로 취약계층 반려가구 지원 반려동물 친화문화 조성 나...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:eminwon.bsbukgu.go.kr:press:159174f88d0fcb69bdcc52a7868eb45b', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '울릉군 보건의료원, 물리치료실 이용 환자 39.3% 증가', title_hash = 'a03702e17ba68d3e5069f0ae5a09c7f6', title_version = title_version + 1 WHERE item_id = 'src:www.ulleung.go.kr:press:c013dd85e0350301c1cca4ac777ee33e' AND title = '울릉군 보건의료원, 물리치료실 이용 환자 39.3% 증...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.ulleung.go.kr:press:c013dd85e0350301c1cca4ac777ee33e', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '울릉군, 자살예방상담전화 ''109''홍보 앞치마 2만장 배포', title_hash = 'b6dc2e8918e9218679703e91a880a91c', title_version = title_version + 1 WHERE item_id = 'src:www.ulleung.go.kr:press:f46ad88914192ae2dd060d7d2951bd78' AND title = '울릉군, 자살예방상담전화 ''109''홍보 앞치마 2만장 ...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.ulleung.go.kr:press:f46ad88914192ae2dd060d7d2951bd78', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '부산시 최초! 독거노인 서비스 욕구 표출 장벽을 없애다! 제1사업“2026년 배산마을 취약계층 무선 도어락 설치 사업” 추진', title_hash = '7b27d202d5f5a224b35146722b42c3fa', title_version = title_version + 1 WHERE item_id = 'src:eminwon.suyeong.go.kr:press:656790099ea1c0215698ed6df4a4afd5' AND title = '부산시 최초! 독거노인 서비스 욕구 표출 장벽을 없애다! 제1사업“202...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:eminwon.suyeong.go.kr:press:656790099ea1c0215698ed6df4a4afd5', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '부산 중구 영주1동 새마을문고분회, 홀로 어르신 「사랑의 생신 롤케이크」 전달', title_hash = '449b19cb8f915e0b9544625b2d2324a5', title_version = title_version + 1 WHERE item_id = 'src:eminwon.bsjunggu.go.kr:press:1d6c90b12e5994e8149c2815d8bd3686' AND title = '부산 중구 영주1동 새마을문고분회, 홀로 어르신 「사랑의 생신 롤케이크」...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:eminwon.bsjunggu.go.kr:press:1d6c90b12e5994e8149c2815d8bd3686', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '동대신2동, 폭염 대비 어르신 건강돌봄 시원한 여름나기 수박 한 통, 안부 한 번 운영', title_hash = 'd67d5f9e1441c9bb52f71e12659981bd', title_version = title_version + 1 WHERE item_id = 'src:www.bsseogu.go.kr:press:e288b058cd9d645b3d4466b8c270e332' AND title = '동대신2동, 폭염 대비 어르신 건강돌봄 시원한 여름나기 수박 한 통, 안..';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:www.bsseogu.go.kr:press:e288b058cd9d645b3d4466b8c270e332', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET title = '광복동 지역사회보장협의체, 혹서기 취약계층을 위한‘건강한 여름 나기’보양식 지원', title_hash = '0a14605ce9c3895cd115b3050237cea9', title_version = title_version + 1 WHERE item_id = 'src:eminwon.bsjunggu.go.kr:press:a096861df102be6ef0369a3a73e3b379' AND title = '광복동 지역사회보장협의체, 혹서기 취약계층을 위한‘건강한 여름 나기’보양...';
--> statement-breakpoint
INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES ('src:eminwon.bsjunggu.go.kr:press:a096861df102be6ef0369a3a73e3b379', 1, 1791547200, 'COMPLETED') ON CONFLICT(item_id) DO NOTHING;
