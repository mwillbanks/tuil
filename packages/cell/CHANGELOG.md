# Changelog

## [1.0.1](https://github.com/mwillbanks/tuil/compare/tuil-cell-v1.0.0...tuil-cell-v1.0.1) (2026-08-05)


### Bug Fixes

* repair main-screen renderer repaint ([#15](https://github.com/mwillbanks/tuil/issues/15)) ([9c1d2a8](https://github.com/mwillbanks/tuil/commit/9c1d2a8c6d4dccd44efdbb7e6f3d661dec05bc48))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @mwillbanks/tuil-renderer bumped to 1.0.1

## [1.0.0](https://github.com/mwillbanks/tuil/compare/tuil-cell-v0.2.0...tuil-cell-v1.0.0) (2026-08-02)


### ⚠ BREAKING CHANGES

* LogViewerModel now requires explicit query-editor ownership. Production record sources must stream abortable bounded batches. PasswordInput rejects pre-created masked sessions. Protocol and Story boundaries reject malformed or unbounded input.

### Features

* platform expansion ([1fd494f](https://github.com/mwillbanks/tuil/commit/1fd494fe4ff23d6d58c60a6eb249d288107ebd71))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @mwillbanks/tuil-core bumped to 1.0.0
    * @mwillbanks/tuil-renderer bumped to 1.0.0
