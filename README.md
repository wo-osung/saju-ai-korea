# SajuAI Final

풀 업그레이드 버전.

- 실제 원국 계산: 천간/지지, 지장간, 십신, 십이운성, 납음, 명궁/신궁, 공망, 합·충·해·삼합·방합
- 대운/세운: lunar-javascript의 Yun/DaYun/LiuNian 계산 결과를 사용
- 출생시간 미상: 시주만 미상 처리하고 년·월·일주는 정상 분석
- AI: 계산 완료된 명리 데이터를 일반인이 이해하기 쉬운 한국어로 해설
- 비용 절감: GPT-5 mini 기본, 24시간 캐시, IP 요청 제한

## 실행

```powershell
npm install
npm start
```

`.env.example`을 `.env`로 복사하고 `OPENAI_API_KEY`를 입력하세요.

`lunar-javascript`는 npm 최신 공개 버전 1.7.7을 사용합니다.
