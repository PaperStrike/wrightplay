export type TestDoneEventName = `__wrightplay_${string}_done__`;

declare global {
  interface WindowEventMap {
    [name: TestDoneEventName]: TestDoneEvent;
  }
}

export default class TestDoneEvent extends Event {
  static getName(uuid: string): TestDoneEventName {
    return `__wrightplay_${uuid}_done__`;
  }

  declare type: TestDoneEventName;

  declare exitCode: number;

  constructor(uuid: string, exitCode: number) {
    super(TestDoneEvent.getName(uuid));
    this.exitCode = exitCode;
  }
}
