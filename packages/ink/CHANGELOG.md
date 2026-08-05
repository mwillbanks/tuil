# Changelog

## [1.0.1](https://github.com/mwillbanks/tuil/compare/tuil-ink-v1.0.0...tuil-ink-v1.0.1) (2026-08-05)


### Bug Fixes

* repair main-screen renderer repaint ([#15](https://github.com/mwillbanks/tuil/issues/15)) ([9c1d2a8](https://github.com/mwillbanks/tuil/commit/9c1d2a8c6d4dccd44efdbb7e6f3d661dec05bc48))
* stabilize terminal inputs and selections ([#17](https://github.com/mwillbanks/tuil/issues/17)) ([71bca6c](https://github.com/mwillbanks/tuil/commit/71bca6c53f3b9a1d614ddd378d0b59fecc424000))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @mwillbanks/tuil bumped to 1.0.1
    * @mwillbanks/tuil-pointer bumped to 1.0.1
    * @mwillbanks/tuil-renderer bumped to 1.0.1

## [1.0.0](https://github.com/mwillbanks/tuil/compare/tuil-ink-v0.2.0...tuil-ink-v1.0.0) (2026-08-02)


### ⚠ BREAKING CHANGES

* LogViewerModel now requires explicit query-editor ownership. Production record sources must stream abortable bounded batches. PasswordInput rejects pre-created masked sessions. Protocol and Story boundaries reject malformed or unbounded input.

### Features

* platform expansion ([1fd494f](https://github.com/mwillbanks/tuil/commit/1fd494fe4ff23d6d58c60a6eb249d288107ebd71))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @mwillbanks/tuil bumped to 1.0.0
    * @mwillbanks/tuil-core bumped to 1.0.0
    * @mwillbanks/tuil-focus bumped to 0.2.1
    * @mwillbanks/tuil-pointer bumped to 1.0.0
    * @mwillbanks/tuil-hotkeys bumped to 1.0.0
    * @mwillbanks/tuil-renderer bumped to 1.0.0
    * @mwillbanks/tuil-scroll bumped to 1.0.0
    * @mwillbanks/tuil-theme bumped to 0.2.1

## [0.2.0](https://github.com/mwillbanks/tuil/compare/tuil-ink-v0.1.0...tuil-ink-v0.2.0) (2026-07-27)


### Features

* add full-screen terminal example ([bb3f280](https://github.com/mwillbanks/tuil/commit/bb3f2805b03614a4fad159234ac9028f2f000ee7))
* enforce repository quality gates ([15d8fe0](https://github.com/mwillbanks/tuil/commit/15d8fe099ca9ee12fe55a2d016ec7687dfeb7e3f))
* harden alpha extension platform ([ce6277a](https://github.com/mwillbanks/tuil/commit/ce6277a3cd9e072b1276d7ef87b29119b6f82f0e))
* prepare tuil for release ([e8c44f2](https://github.com/mwillbanks/tuil/commit/e8c44f2debd6699d31cfd03a641307d69a259e0d))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @mwillbanks/tuil bumped to 0.2.0
    * @mwillbanks/tuil-core bumped to 0.2.0
    * @mwillbanks/tuil-focus bumped to 0.2.0
    * @mwillbanks/tuil-hotkeys bumped to 0.2.0
    * @mwillbanks/tuil-theme bumped to 0.2.0
