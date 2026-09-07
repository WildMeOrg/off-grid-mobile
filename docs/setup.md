# Setup

Run commands from the repository root. The app uses React Native 0.83.1, React 19.2, and Node.js 20 or later; see [package.json](../package.json).

## Public deployment configuration

The app needs exactly six public strings. Start with [deployment.example.json](../deployment.example.json):

```json
{
  "apiBaseUrl": "https://api.example.invalid/api",
  "projectId": "example-project",
  "tenantId": "11111111-1111-4111-8111-111111111111",
  "mobileClientId": "22222222-2222-4222-8222-222222222222",
  "apiClientId": "33333333-3333-4333-8333-333333333333",
  "redirectUrl": "org.ganesha.elebook://oauthredirect"
}
```

| Field | Requirement |
| --- | --- |
| `apiBaseUrl` | HTTPS API base, including any `/api` prefix. No credentials, query, or fragment. Trailing slashes are removed. |
| `projectId` | 1-128 letters, digits, underscores, or hyphens; start with a letter or digit. |
| `tenantId` | Tenant UUID. |
| `mobileClientId` | Native public-client registration UUID. |
| `apiClientId` | API registration UUID. |
| `redirectUrl` | Exactly `org.ganesha.elebook://oauthredirect`, matching the native registrations. |

Pack acquisition has a narrower limit: project IDs and pack version strings must fit within 40 UTF-16 code units. For live setup, keep `projectId` within that limit even though configuration accepts up to 128 characters; see [pack candidate paths](../src/services/packDownloadService/candidate.ts).

The `.invalid` endpoint and dummy IDs are deliberately non-live. They support CI, static checks, and builds, not real sign-in, model/pack downloads, or uploads.

Select the example explicitly before installing and configuring:

```powershell
Remove-Item Env:ELEBOOK_CONFIG_JSON -ErrorAction SilentlyContinue
$env:ELEBOOK_CONFIG_FILE = "deployment.example.json"
npm ci
npm run configure
```

POSIX equivalent:

```sh
unset ELEBOOK_CONFIG_JSON
export ELEBOOK_CONFIG_FILE=deployment.example.json
npm ci
npm run configure
```

For a live development build, obtain the public settings from the deployment maintainer and put the same six fields in `deployment.local.json`. Unset both `ELEBOOK_CONFIG_FILE` and `ELEBOOK_CONFIG_JSON` to use that default file. Alternatively, set `ELEBOOK_CONFIG_FILE` to another JSON file, or set `ELEBOOK_CONFIG_JSON` to the complete JSON object. The two environment sources are mutually exclusive.

[scripts/configure-app.js](../scripts/configure-app.js) rejects missing values, extra fields, malformed IDs, and invalid URLs. Failure stops configuration and removes stale `src/config/deployment.generated.json`. Both the default local file and generated output are [git-ignored](../.gitignore). Run `npm run configure` after changing public settings. Metro also runs the generator, as do `npm run typecheck` and the `prestart`, `preandroid`, and `preios` hooks.

These values are bundled into the app and are not secrets. Do not add client secrets, tokens, passwords, or signing material to the JSON or APK. Environment variables and git-ignore rules do not make bundled values private.

## Sign-in and existing data

The native public client uses the system browser and PKCE, with no client secret. The maintainer must register the fixed redirect and allow the API scope `api://<apiClientId>/access_as_user`; the app also requests `openid`, `profile`, and `offline_access`. See [auth configuration](../src/config/entraAuth.ts).

Tokens use OS secure storage. The storage namespace incorporates all six deployment fields; legacy shared tokens are not reused, so an upgrade requires fresh sign-in. This feature does not migrate or isolate the saved profile, packs, observations, or SQLite data. Do not point a populated installation at another deployment. Protect unsynced observations and use a separate clean installation for another deployment.

See [deployment configuration](../src/config/deployment.ts) and [token handling](../src/services/entraAuthService.ts) for the implementation.

## Local passphrase locks

The local lock uses a versioned PBKDF2-HMAC-SHA-256 verifier with 600,000 iterations and a native-generated salt. `react-native-get-random-values` must be linked in the native app; salts use its native interface directly, without the JavaScript debugger fallback. Missing native randomness fails lock creation or migration rather than using a weaker source.

Existing locks migrate on successful unlock. The replacement is written to a separate Keychain/Keystore entry and read back before legacy cleanup. A current-format entry is authoritative even if malformed or legacy cleanup failed: it is never bypassed using the old hash. Storage read errors keep the lock enabled. Legacy records retain their old verification weaknesses until upgraded; change the passphrase after migration. Do not downgrade to a build that does not understand the new lock entry. Observation files and SQLite are not encrypted by this feature.

`npm ci` applies the version-pinned patches in [patches](../patches), including canonical filesystem paths used by pack validation. Rebuild the native app after dependency/patch changes. On iOS, rerun `bundle exec pod install`; the resulting lockfile and build require macOS verification.

## Android development

Install JDK 17 and Android Studio's SDK tools. Set `JAVA_HOME` to the JDK and `ANDROID_HOME` to the SDK; make platform-tools available on `PATH`. Install SDK Platform 36, Build Tools 36.0.0, and NDK 27.1.12297006, as specified in [android/build.gradle](../android/build.gradle).

The checked-in [architecture setting](../android/gradle.properties) builds `arm64-v8a` only. Use an ARM64 target; an x86 emulator is not covered by this configuration. The declared minimum is API 24, but that is a manifest floor, not evidence of device acceptance or native-runtime compatibility.

After configuration, start Metro:

```sh
npm run start
```

In another terminal at the same repository root, with the same configuration source selected:

```sh
npm run android
```

The [Android app](../android/app/build.gradle) uses `org.ganesha.elebook.dev` for debug and `org.ganesha.elebook` for release. Both use the same fixed sign-in redirect. Debug and release are separate installations, not an automatic data migration path.

## iOS development

Use macOS, Xcode with command-line tools, an installed iOS simulator, Ruby, and Bundler. CI selects Ruby 3.3; the [Gemfile](../Gemfile) declares Ruby >= 2.6.10. The [Podfile](../ios/Podfile) and Xcode targets require iOS 17.0 or later.

With npm dependencies installed and a public configuration selected:

```sh
bundle install
cd ios
bundle exec pod install
cd ..
npm run ios
```

Apple toolchain compatibility is unresolved: the Gemfile pins `xcodeproj < 1.26.0`, while [Podfile.lock](../ios/Podfile.lock) records CocoaPods 1.17.0. Review that pin before adopting Xcode 16. These steps and a clean iOS build have not been verified on the Windows preparation host; do not treat them as a passing macOS build recipe.

The [Xcode project](../ios/OffgridMobile.xcodeproj/project.pbxproj) leaves `DEVELOPMENT_TEAM` empty. A maintainer must supply their own team and provisioning for real-device builds or archives. Its marketing version is still `0.0.58`, not the npm/Android `0.1.0-field.2`; iOS release metadata needs separate review.

## Local checks

Use the configuration unit test as a focused JavaScript check, then select the native checks relevant to your change:

```sh
npm run typecheck
npx jest --runInBand --runTestsByPath __tests__/unit/configureApp.test.ts
npm run test:android
npm run lint:android
```

[Jest configuration](../jest.config.js) maps generated deployment JSON to the neutral example independently of any private local configuration. The [Gradle wrapper script](../scripts/run-gradle.js) maps Android tests to `:app:testDebugUnitTest` and lint to `:app:lintDebug`; these are not phone/instrumentation tests.

For iOS tests on macOS, install Pods first, list available simulators, and substitute a simulator UUID:

```sh
xcrun simctl list devices available
export IOS_TEST_DESTINATION='platform=iOS Simulator,id=<simulator-uuid>'
npm run test:ios
```

The [Apple check wrapper](../scripts/run-apple-check.js) runs the `OffgridMobileTests` target with signing disabled. `npm test` includes JavaScript, Android, and iOS tests, so it needs macOS plus both native toolchains; it does not pass as a full suite on Windows. `npm run lint` includes ESLint, Android lint, and SwiftLint. iOS lint is skipped on non-macOS hosts or when SwiftLint is missing, so a successful command alone does not prove iOS lint ran.

## CI and release prerequisites

[CI](../.github/workflows/ci.yml) explicitly selects the neutral example. Its release-build check uses an ephemeral CI signing key; that build is not a live deployment or a field-update signing identity.

The manually dispatched [Android release workflow](../.github/workflows/release.yml) requires:

- Repository variable `ELEBOOK_CONFIG_JSON`: the same six public fields, with maintainer-approved live values rather than the `.invalid` fixture.
- Repository secret `ELEBOOK_RELEASE_KEYSTORE_BASE64`.
- Repository secret `ELEBOOK_RELEASE_STORE_PASSWORD`.
- Repository secret `ELEBOOK_RELEASE_KEY_ALIAS`.
- Repository secret `ELEBOOK_RELEASE_KEY_PASSWORD`.
- Matching npm and Android version metadata, successful release gates, and approval to publish.

Release Gradle tasks fail when signing properties or the keystore are missing; they do not fall back to debug signing. Keep the release signing identity stable for in-place updates and keep all signing material out of public configuration and version control. The workflow's presence does not establish that a release or downloadable distribution exists, and publication requires separate maintainer approval.