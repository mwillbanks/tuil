# Changelog

## [1.0.0](https://github.com/mwillbanks/tuil/compare/tuil-log-viewer-v0.2.0...tuil-log-viewer-v1.0.0) (2026-08-02)


### ⚠ BREAKING CHANGES

* LogViewerModel now requires explicit query-editor ownership. Production record sources must stream abortable bounded batches. PasswordInput rejects pre-created masked sessions. Protocol and Story boundaries reject malformed or unbounded input.

### Features

* platform expansion ([1fd494f](https://github.com/mwillbanks/tuil/commit/1fd494fe4ff23d6d58c60a6eb249d288107ebd71))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @mwillbanks/tuil-editor bumped to 1.0.0
    * @mwillbanks/tuil-focus bumped to 0.2.1
    * @mwillbanks/tuil-logging bumped to 1.0.0
    * @mwillbanks/tuil-scroll bumped to 1.0.0
    * @mwillbanks/tuil-ink bumped to 1.0.0
  * devDependencies
    * @mwillbanks/tuil-testing-ink bumped to 1.0.0
