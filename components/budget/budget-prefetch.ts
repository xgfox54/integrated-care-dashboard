interface PrefetchOptions {
  readonly settled: boolean;
  readonly saveData: () => boolean;
  readonly targets: readonly string[];
  readonly schedule: (run: () => void) => () => void;
  readonly load: (path: string) => Promise<unknown>;
}

export function scheduleBudgetPrefetch(options: PrefetchOptions): () => void {
  if (!options.settled || options.saveData()) return () => {};
  let active = true;
  let cancel = () => {};
  let index = 0;
  const next = () => {
    if (!active || options.saveData() || index >= options.targets.length) return;
    cancel = options.schedule(() => {
      if (!active || options.saveData()) return;
      const target = options.targets[index++];
      // 선택 전 미리받기 실패는 현재 결과를 바꾸지 않는다. 실제 조회에서 다시 요청한다.
      void options.load(target).then(next, next);
    });
  };
  next();
  return () => { active = false; cancel(); };
}
