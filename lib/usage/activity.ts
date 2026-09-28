// 측정 활동시간 계산. 화면이 보이고, 마지막 상호작용 뒤 60초 안일 때만 시간을 더한다.
// 시간은 performance.now() 같은 단조 증가 시각으로 받는다. 입력 내용은 읽지 않고 상호작용이 있었는지만 쓴다.
import { IDLE_LIMIT_MS } from "./codes.ts";

export class ActivityClock {
  private lastInteraction: number;
  private accountedUntil: number;
  private visible: boolean;

  constructor(now: number, visible: boolean) {
    this.lastInteraction = now;
    this.accountedUntil = now;
    this.visible = visible;
  }

  /** 지난 계산 뒤로 더할 활동시간(ms). 숨김 구간과 유휴 구간은 0이다. */
  accrue(now: number): number {
    if (!this.visible) {
      this.accountedUntil = Math.max(this.accountedUntil, now);
      return 0;
    }
    const activeUntil = Math.min(now, this.lastInteraction + IDLE_LIMIT_MS);
    const delta = Math.max(0, activeUntil - this.accountedUntil);
    this.accountedUntil = Math.max(this.accountedUntil, now);
    return delta;
  }

  /** 상호작용(누르기·키 입력·스크롤). 유휴 뒤라면 이때부터 다시 센다. */
  interact(now: number): number {
    const delta = this.accrue(now);
    this.lastInteraction = now;
    return delta;
  }

  /** 화면 표시·숨김 변경. 다시 보여도 실제 상호작용이 있어야 시간을 더한다. */
  setVisible(now: number, visible: boolean): number {
    const delta = this.accrue(now);
    this.visible = visible;
    this.accountedUntil = now;
    return delta;
  }
}
