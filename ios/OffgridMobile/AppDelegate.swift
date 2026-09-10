import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate, RNAppAuthAuthorizationFlowManager {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  // Required by RNAppAuthAuthorizationFlowManager: react-native-app-auth sets this
  // when a sign-in flow starts, and expects application(_:open:options:) to hand the
  // OAuth redirect URL back to it (Android gets the equivalent via a manifest intent-filter).
  weak var authorizationFlowManagerDelegate: RNAppAuthAuthorizationFlowManagerDelegate?

  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    if let authorizationFlowManagerDelegate = self.authorizationFlowManagerDelegate {
      return authorizationFlowManagerDelegate.resumeExternalUserAgentFlow(with: url)
    }
    return false
  }

  func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    // Pass the completion handler to RNFS so it can finalize the background
    // URL session and signal iOS that all events have been processed.
    // Without this, iOS may penalise the app for not calling the handler promptly.
    RNFSManager.setCompletionHandlerForIdentifier(identifier, completionHandler: completionHandler)
  }

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    guard Self.shouldStartReactNative(
      environment: ProcessInfo.processInfo.environment,
      testRuntimeLoaded: NSClassFromString("XCTestCase") != nil
    ) else {
      return true
    }

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "OffgridMobile",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  static func shouldStartReactNative(
    environment: [String: String],
    testRuntimeLoaded: Bool
  ) -> Bool {
#if DEBUG
    return environment["XCTestConfigurationFilePath"] == nil && !testRuntimeLoaded
#else
    return true
#endif
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
