# SELEXIONES app

Native iOS/Android wrapper around the SELEXIONES web app, built with [Capacitor](https://capacitorjs.com/).

- `www/` — the app's actual content (copy of `../selexiones/index.html`). Edit here, then run `npm run sync`.
- `android/` — native Android project (Gradle). Open in Android Studio with `npm run open:android`.
- `ios/` — native iOS project (Xcode). Open in Xcode with `npm run open:ios`.
- App ID: `com.selexiones.app`

## CI

`.github/workflows/selexiones-android-build.yml` and `selexiones-ios-build.yml` build both
platforms on every push to this branch — Android on `ubuntu-latest`, iOS on `macos-latest`,
since this repo's dev environment has neither an Android SDK nor Xcode. Both are currently
**unsigned** builds (debug APK / simulator build) that prove the project compiles — not
store-submittable yet.

## To actually ship to the App Store / Play Store

1. **Apple Developer Program** ($99/yr, developer.apple.com) and **Google Play Console**
   ($25 one-time, play.google.com/console) — both owned by the account holder, not something
   that can be set up on their behalf.
2. **Android signing**: generate a release keystore (`keytool -genkey -v -keystore
   selexiones-release.keystore -alias selexiones -keyalg RSA -keysize 2048 -validity 10000`),
   store it + its passwords as GitHub secrets, add a signed `bundleRelease` job to the Android
   workflow, upload the `.aab` to Play Console.
3. **iOS signing**: once enrolled, create an App ID + provisioning profile (or use Xcode
   automatic signing with an App Store Connect API key stored as a secret), add an
   `xcodebuild archive` + `exportArchive` step to the iOS workflow, upload via
   `xcrun altool` or Fastlane to App Store Connect / TestFlight.
4. **Store listings**: app icons (1024×1024 source, Capacitor/`@capacitor/assets` generates
   the rest), screenshots per device size, privacy policy URL, description, age rating.
5. **Review**: Apple typically 1-3 days, Google usually faster — budget a couple weeks
   end-to-end before the first public release.
