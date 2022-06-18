export type TestInitEventName = `__wrightplay_${string}_init__`;

declare global {
  interface WindowEventMap {
    [name: TestInitEventName]: TestInitEvent;
  }
}

export default class TestInitEvent extends Event {
  static getName(uuid: string): TestInitEventName {
    return `__wrightplay_${uuid}_init__`;
  }

  declare type: TestInitEventName;

  constructor(uuid: string) {
    super(TestInitEvent.getName(uuid));
  }
}
