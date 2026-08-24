/**
 * Result の失敗ではなく、interpreter の外へ抜ける制御合図の基底 class。
 * downstream runtime はこれを継承して固有の signal を定義できる。
 */
export class ControlSignal extends Error {
  constructor(message = '') {
    super(message);
    this.name = new.target.name;
  }
}
