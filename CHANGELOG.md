# Changelog

## 0.3.0 (2026-09-08)


### ⚠ BREAKING CHANGES

* **parallel:** 同一 path への非互換な更新は、これまで黙って right が勝って いたが、以後 merge_conflict の Err になる。transactional workflow の既定として、 committed state の暗黙消失より明示的な失敗を採る。right wins が本当に必要な 場合は .reduce(Merge.deep()) で明示的に選ぶ。

### Features

* berylx-ts v0.2.0 — Ruby berylx TS port + full darkcore substrate + phase3 (async task / toMermaid / attachRoot) ([74769ac](https://github.com/minamorl/berylx-ts/commit/74769ac805841d356bc49b8a60ac9eed263560fa))
* **ci:** automate releases and rewrite documentation in English ([#4](https://github.com/minamorl/berylx-ts/issues/4)) ([e55dd61](https://github.com/minamorl/berylx-ts/commit/e55dd611e584142930dace4f4198afe8a01d103c))
* **types:** Focus を状態型 S と path P で型付ける ([76ab854](https://github.com/minamorl/berylx-ts/commit/76ab854840c106ac437fa16e3d686e03bf6877e3))


### Bug Fixes

* **parallel:** 既定 reducer を three-way join の Merge.strict へ ([272cf51](https://github.com/minamorl/berylx-ts/commit/272cf51b53fb52c00f4b3caa18a4f2579e2ba024))
