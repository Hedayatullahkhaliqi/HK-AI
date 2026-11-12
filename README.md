# HK.AI — Hedayatullah Khaliqi AI

HK.AI is a multilingual AI assistant built as a Cloudflare Pages web app, with a Capacitor wrapper for Android and iOS.

## Mobile app setup

- App name: **HK.AI**
- App ID: `com.hedayatullahkhaliqi.hkai`
- Native wrapper: Capacitor 8
- Web app assets are staged into `www/` by `npm run build`.
- Packaged apps call the existing Cloudflare Pages API at `https://hk-ai.pages.dev`.

## Build locally

Requires Node.js 22 or newer, plus Android Studio/Android SDK for Android builds or Xcode and CocoaPods on macOS for iOS builds.

```sh
npm install
npm run build
npx cap add android
npx cap sync android
```

For iOS on macOS:

```sh
npx cap add ios
npx cap sync ios
```

## GitHub Actions

The workflow at `.github/workflows/mobile-build.yml` builds:
- an Android **debug APK** for testing;
- an iOS **Simulator build** for simulator testing.

Artifacts are attached to the successful GitHub Actions run. These are test builds, not signed store-release packages. Publishing on Google Play or the Apple App Store requires the relevant developer account, signing, store listing, and review.

## Backend

The mobile wrapper uses the existing Cloudflare Pages backend. Keep the Pages deployment and its required environment secrets configured.
