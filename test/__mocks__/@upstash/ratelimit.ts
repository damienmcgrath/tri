export class Ratelimit {
  constructor(_opts: any) {}
  async limit(_key: string) {
    return { success: true, remaining: 10, reset: Date.now() + 60000, limit: 10 };
  }
  static fixedWindow(_maxRequests: number, _window: string) {
    return {};
  }
}
