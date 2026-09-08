# Changelog

## 0.3.0 (2026-09-08)


### ⚠ BREAKING CHANGES

* **parallel:** incompatible updates to the same path used to let the right side silently win; they now produce a merge_conflict Err. As the default for transactional workflows, an explicit failure is preferred over the silent loss of committed state. If you need right-wins behavior, select it explicitly with .reduce(Merge.deep()).

### Features

* berylx-ts v0.2.0 — Ruby berylx TS port + full darkcore substrate + phase3 (async task / toMermaid / attachRoot) ([74769ac](https://github.com/minamorl/berylx-ts/commit/74769ac805841d356bc49b8a60ac9eed263560fa))
* **ci:** automate releases and rewrite documentation in English ([#4](https://github.com/minamorl/berylx-ts/issues/4)) ([e55dd61](https://github.com/minamorl/berylx-ts/commit/e55dd611e584142930dace4f4198afe8a01d103c))
* **types:** type Focus by its state type S and its path P ([76ab854](https://github.com/minamorl/berylx-ts/commit/76ab854840c106ac437fa16e3d686e03bf6877e3))


### Bug Fixes

* **parallel:** switch the default reducer to Merge.strict, a three-way join ([272cf51](https://github.com/minamorl/berylx-ts/commit/272cf51b53fb52c00f4b3caa18a4f2579e2ba024))
