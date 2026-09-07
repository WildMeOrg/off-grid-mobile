# EleBook

Offline-first wildlife identification and field review, built on the WildMe mobile fork of Off Grid. This branch focuses on photographic observations and replaces the original general-purpose chat and media-generation workflows.

*Updated: 2026-09-07 - Documents the field application and configurable deployment.*

## Field workflow

1. While connected, sign in and download the shared embedding model and a compatible project pack.
2. Capture a photo or select gallery photos. Detection, cropping, embedding extraction, and candidate ranking run locally.
3. Review candidates, record notes, and save observations. Saved observations and their upload queue persist locally.
4. When connected, explicitly start Upload or Upload All for reviewed observations. Inspect per-detection receipts and retry incomplete transfers.

MiewID is a feature extractor, not an identity classifier. Its raw 2152-dimensional embeddings are compared using cosine similarity; candidate scores are not calibrated probabilities. Human review is required. "Received by EleBook" means acknowledgement from the configured API, not confirmed identity or downstream Wildbook ingestion.

Gallery imports currently store the import timestamp and current device GPS, not the photograph's EXIF time and location. Review the [privacy policy](docs/PRIVACY_POLICY.md) before collecting or uploading sensitive field evidence.

## Build from source

The app uses React Native 0.83.1, React 19.2, and TypeScript. Android requires Node.js 20+, JDK 17, SDK 36, and an ARM64 target. Follow [setup](docs/setup.md) to select an explicit deployment configuration before running:

```sh
npm ci
npm run configure
npm run start
```

Then run `npm run android` from a second terminal using the same configuration source. Android debug uses `org.ganesha.elebook.dev`; release uses `org.ganesha.elebook`. iOS setup and its unresolved toolchain requirements are documented separately in the same guide.

[deployment.example.json](deployment.example.json) contains reserved, non-live values for checks and CI. A functioning sign-in/download/upload deployment needs maintainer-supplied public API and application-registration settings. Missing or invalid configuration stops bundling. Public tenant/client IDs and API URLs remain visible in a configured APK; no client secret, access token, or signing credential belongs in this configuration.

Do not reconfigure a populated installation for another deployment. Token storage is deployment-specific, but local observations, packs, profiles, and SQLite data are not isolated or migrated by that setting.

## Checks and platform limits

With configuration selected:

```sh
npm run typecheck
npx jest --coverage --forceExit
npm run test:android
npm run lint:android
```

The full `npm test` also invokes iOS tests and requires macOS with both native toolchains. Local unit checks do not establish physical-device or field acceptance. See [CI](.github/workflows/ci.yml) for the native jobs.

- Android builds currently target `arm64-v8a` only. API 24 is the declared minimum, not a tested device-support guarantee.
- Detection uses ONNX CPU. Optional Android LiteRT acceleration affects embeddings only; runtime failures do not have a complete automatic fallback chain.
- iOS sources are included, but clean macOS build, signing, and device validation remain required. Android results do not establish iOS support.
- Downloads require a trusted, controlled artifact publisher. File hashes detect mismatched content; they do not establish publisher trust.
- App locking is not encryption of observation files or SQLite. Device and backend security remain necessary.

## Documentation

| Guide | Scope |
| --- | --- |
| [Setup](docs/setup.md) | Public configuration, Android/iOS prerequisites, checks, and release signing |
| [Mobile API](docs/api.md) | Authentication, downloads, observation uploads, receipts, and retry limits |
| [Embedding pack format](docs/EMBEDDING_PACK_FORMAT.md) | Version 1 archive structure and current mobile compatibility |
| [Privacy policy](docs/PRIVACY_POLICY.md) | Local data, metadata, network transfers, and deletion limits |

Older documents elsewhere in this repository may describe the original general-purpose application or earlier design work. These guides describe the field build. Model weights, private field data, signing keys, and tester APKs are not source-code dependencies to commit.

## Contributing and attribution

Follow the [repository conventions](CLAUDE.md) and [PR template](.github/pull_request_template.md). Report the exact platforms and workflows tested; leave unperformed checks unchecked. Keep private photos, precise locations, credentials, and signed URLs out of public issues and PRs.

This application derives from [Off Grid](https://github.com/alichherawalla/off-grid-mobile) through [WildMe's wildlife-reid fork](https://github.com/WildMeOrg/off-grid-mobile/tree/wildlife-reid). The [MIT license](LICENSE) and original contributor attribution are retained.

Upstream acknowledgments: [llama.cpp](https://github.com/ggerganov/llama.cpp), [whisper.cpp](https://github.com/ggerganov/whisper.cpp), [llama.rn](https://github.com/mybigday/llama.rn), [whisper.rn](https://github.com/mybigday/whisper.rn), [local-dream](https://github.com/nicenemo/local-dream), [ml-stable-diffusion](https://github.com/apple/ml-stable-diffusion), [MNN](https://github.com/alibaba/MNN), and [Hugging Face](https://huggingface.co). These acknowledge the original application, not the current mobile dependency list.
