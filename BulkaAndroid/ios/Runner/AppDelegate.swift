import ActivityKit
import Flutter
import UIKit

@available(iOS 16.2, *)
struct BulkaOrderActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    let status: String
    let orderStatus: String
    let deliveryStatus: String
    let etaTimestamp: Double?
    let progress: Double
    let courierName: String
    let updatedAtTimestamp: Double
  }

  let orderId: String
  let orderNumber: Int
  let branch: String
  let fulfillmentType: String
}

@main
@objc class AppDelegate: FlutterAppDelegate {
  private var orderStatusChannel: FlutterMethodChannel?
  private var activityTokenTasks: [String: Task<Void, Never>] = [:]

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    if let controller = window?.rootViewController as? FlutterViewController {
      let channel = FlutterMethodChannel(
        name: "com.bulka.bonus/order_status",
        binaryMessenger: controller.binaryMessenger
      )
      channel.setMethodCallHandler { [weak self] call, result in
        guard let self else { return result(nil) }
        let payload = call.arguments as? [String: Any] ?? [:]
        switch call.method {
        case "updateOrderStatus":
          self.updateOrderActivity(payload, result: result)
        case "clearOrderStatus":
          self.endOrderActivity(payload)
          result(nil)
        default:
          result(FlutterMethodNotImplemented)
        }
      }
      orderStatusChannel = channel
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  private func updateOrderActivity(_ payload: [String: Any], result: @escaping FlutterResult) {
    guard #available(iOS 16.2, *), ActivityAuthorizationInfo().areActivitiesEnabled else {
      result(false)
      return
    }
    guard
      let orderId = payload["orderId"] as? String,
      let orderNumber = payload["orderNumber"] as? Int
    else { result(false); return }

    guard payload["paymentStatus"] as? String == "paid" else {
      var dismissal = payload
      dismissal["dismissImmediately"] = true
      endOrderActivity(dismissal)
      result(false)
      return
    }
    let content = activityContent(payload)
    if let activity = Activity<BulkaOrderActivityAttributes>.activities.first(
      where: { $0.attributes.orderId == orderId }
    ) {
      observePushToken(activity)
      Task {
        await activity.update(content)
        await MainActor.run { result(true) }
      }
      return
    }

    let attributes = BulkaOrderActivityAttributes(
      orderId: orderId,
      orderNumber: orderNumber,
      branch: payload["branch"] as? String ?? "",
      fulfillmentType: payload["fulfillmentType"] as? String ?? "pickup"
    )
    do {
      let activity = try Activity.request(
        attributes: attributes,
        content: content,
        pushType: .token
      )
      observePushToken(activity)
      result(true)
    } catch {
      NSLog("Bulka Live Activity start failed: %@", error.localizedDescription)
      result(false)
    }
  }

  private func endOrderActivity(_ payload: [String: Any]) {
    guard #available(iOS 16.2, *) else { return }
    let orderId = payload["orderId"] as? String
    let activities = Activity<BulkaOrderActivityAttributes>.activities.filter {
      orderId == nil || $0.attributes.orderId == orderId
    }
    let content = activityContent(payload)
    for activity in activities {
      activityTokenTasks.removeValue(forKey: activity.id)?.cancel()
      Task {
        await activity.end(content, dismissalPolicy: payload["dismissImmediately"] as? Bool == true ? .immediate : .after(Date().addingTimeInterval(300)))
      }
    }
  }

  @available(iOS 16.2, *)
  private func activityContent(_ payload: [String: Any]) -> ActivityContent<BulkaOrderActivityAttributes.ContentState> {
    let etaTimestamp = (payload["etaMillis"] as? NSNumber).map { $0.doubleValue / 1000 }
    let state = BulkaOrderActivityAttributes.ContentState(
      status: payload["status"] as? String ?? "",
      orderStatus: payload["orderStatus"] as? String ?? "new",
      deliveryStatus: payload["deliveryStatus"] as? String ?? "unassigned",
      etaTimestamp: etaTimestamp,
      progress: min(1, max(0, (payload["progress"] as? NSNumber)?.doubleValue ?? 0)),
      courierName: payload["courierName"] as? String ?? "",
      updatedAtTimestamp: Date().timeIntervalSince1970
    )
    return ActivityContent(
      state: state,
      staleDate: Date().addingTimeInterval(15 * 60)
    )
  }

  @available(iOS 16.2, *)
  private func observePushToken(_ activity: Activity<BulkaOrderActivityAttributes>) {
    guard activityTokenTasks[activity.id] == nil else { return }
    activityTokenTasks[activity.id] = Task { @MainActor [weak self] in
      var previousToken: Data?
      if let token = activity.pushToken {
        self?.publishActivityToken(token, activity: activity)
        previousToken = token
      }
      for await tokenData in activity.pushTokenUpdates {
        guard !Task.isCancelled else { break }
        if tokenData == previousToken { continue }
        self?.publishActivityToken(tokenData, activity: activity)
        previousToken = tokenData
      }
    }
  }

  @available(iOS 16.2, *)
  private func publishActivityToken(_ data: Data, activity: Activity<BulkaOrderActivityAttributes>) {
    orderStatusChannel?.invokeMethod("liveActivityToken", arguments: [
      "pushToken": data.map { String(format: "%02x", $0) }.joined(),
      "activityId": activity.id,
      "orderId": activity.attributes.orderId,
      "environment": activityPushEnvironment(),
    ])
  }

  private func activityPushEnvironment() -> String {
    // Profile builds can be development-signed without DEBUG. The embedded
    // provisioning profile, not the optimization mode, selects the APNs host.
    // App Store packages have no embedded profile and use production.
    guard
      let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
      let data = try? Data(contentsOf: url),
      let start = data.range(of: Data("<plist".utf8)),
      let end = data.range(of: Data("</plist>".utf8)),
      start.lowerBound < end.upperBound,
      let profile = try? PropertyListSerialization.propertyList(
        from: data.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil
      ) as? [String: Any],
      let entitlements = profile["Entitlements"] as? [String: Any]
    else { return "production" }
    return entitlements["aps-environment"] as? String == "development" ? "sandbox" : "production"
  }
}
